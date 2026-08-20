//! The MCP server's command surface, and the tools yaz provides itself.
//!
//! The tools here are chosen rather than accumulated. An agent driving an
//! editor needs to know what is open, read what is in it, and find out whether
//! it builds — so that is what there is. Anything that *writes* is deliberately
//! absent: an agent that can edit the document is a much larger decision than
//! one that can read it, and it should be taken on purpose rather than by
//! adding one more tool that seemed handy at the time.

use std::sync::Arc;

use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use yaz_mcp::Tool;

use crate::commands::{self, CommandError, Result};
use crate::mcp::{McpState, McpStatus, OpenProject, PluginTool};

/// Start the server and report where it landed.
///
/// Off until asked, always. An editor that can be driven by anything on the
/// machine is not a default anybody chose
/// ([ADR-0022](https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md)).
#[tauri::command]
pub async fn mcp_start(
    port: Option<u16>,
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
) -> Result<McpStatus> {
    install_core_tools(&state, &app).await;
    state
        .start(port.unwrap_or(0), env!("CARGO_PKG_VERSION").to_owned())
        .await
}

/// Stop answering.
#[tauri::command]
pub async fn mcp_stop(state: tauri::State<'_, McpState>) -> Result<McpStatus> {
    Ok(state.stop().await)
}

/// Whether it is running, where, and with what token.
#[tauri::command]
pub async fn mcp_status(state: tauri::State<'_, McpState>) -> Result<McpStatus> {
    Ok(state.status().await)
}

/// Tell the server which project the window has open.
///
/// The frontend owns that fact, so it is told rather than guessed at. Without
/// it every core tool would have to take a root as an argument, which would
/// mean an agent could point them anywhere on the disk.
#[tauri::command]
pub async fn mcp_set_project(
    root: Option<String>,
    state: tauri::State<'_, OpenProject>,
) -> Result<()> {
    state.set(root);
    Ok(())
}

/// Replace the tools a plugin provides.
///
/// Called by the frontend once a plugin has loaded and registered them.
///
/// **Anything the manifest did not declare is dropped here.** The runtime
/// refuses it too, at the call site where a plugin author will see it, but
/// that copy is a courtesy: the webview is not the boundary (ADR-0006) and the
/// manifest is on this side. Without this check `provides.tools` would be a
/// comment, and a registry reading manifests could not answer "what does this
/// plugin add to yaz?" without running it (ADR-0022).
#[tauri::command]
pub async fn mcp_set_plugin_tools(
    plugin_id: String,
    tools: Vec<PluginTool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, McpState>,
    host: tauri::State<'_, crate::plugin_host::PluginHost>,
) -> Result<McpStatus> {
    let handle = app.clone();

    let mut declared = Vec::new();
    for tool in tools {
        if host.declares_tool(&plugin_id, &tool.name).await {
            declared.push(tool);
        } else {
            tracing::warn!(
                plugin = %plugin_id,
                tool = %tool.name,
                "refused a tool the manifest does not declare"
            );
        }
    }
    let tools = declared;

    state
        .set_plugin_tools(&plugin_id, tools, move |owner, name, arguments| {
            let handle = handle.clone();
            let (sender, receiver) = tokio::sync::oneshot::channel();

            // The state is looked up inside the task rather than captured, so
            // this closure borrows nothing that has to outlive the command.
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<McpState>();
                let (id, reply) = state.expect_reply().await;

                let crossed = handle.emit(
                    "mcp://invoke",
                    json!({
                        "id": id,
                        "pluginId": owner,
                        "tool": name,
                        "arguments": arguments,
                    }),
                );

                if crossed.is_err() {
                    state.forget(&id).await;
                    let _ = sender.send(Err("the window is not there".to_owned()));
                    return;
                }

                let _ = sender.send(match reply.await {
                    Ok(result) => result,
                    Err(_) => Err("the plugin went away mid-call".to_owned()),
                });
            });

            receiver
        })
        .await;

    Ok(state.status().await)
}

/// A plugin's answer, on its way back to the waiting agent.
#[tauri::command]
pub async fn mcp_tool_result(
    id: String,
    result: Option<Value>,
    error: Option<String>,
    state: tauri::State<'_, McpState>,
) -> Result<()> {
    let outcome = match (result, error) {
        (_, Some(message)) => Err(message),
        (Some(value), None) => Ok(value),
        (None, None) => Ok(Value::Null),
    };
    state.deliver(&id, outcome).await;
    Ok(())
}

/// Withdraw a plugin's tools, because it has been disabled or reloaded.
#[tauri::command]
pub async fn mcp_drop_plugin_tools(
    plugin_id: String,
    state: tauri::State<'_, McpState>,
) -> Result<McpStatus> {
    state.drop_plugin_tools(&plugin_id).await;
    Ok(state.status().await)
}

/// The application's own tools.
///
/// Registered when the server starts rather than at boot, so a yaz that never
/// switches MCP on never builds them.
async fn install_core_tools(state: &McpState, app: &tauri::AppHandle) {
    let registry = state.registry();
    let mut registry = registry.write().await;

    let handle = app.clone();
    registry.insert(Tool::new(
        "project_info",
        "What project is open: its root, its entry document, and its files.",
        json!({ "type": "object", "properties": {} }),
        Arc::new(move |_| {
            let handle = handle.clone();
            Box::pin(async move {
                let root = open_root(&handle)?;
                let info = commands::open_project(root).map_err(describe)?;
                serde_json::to_value(info).map_err(|error| error.to_string())
            })
        }),
    ));

    let handle = app.clone();
    registry.insert(Tool::new(
        "read_file",
        "Read a file from the open project, by its path relative to the project root.",
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative to the project root."
                }
            },
            "required": ["path"]
        }),
        Arc::new(move |arguments| {
            let handle = handle.clone();
            Box::pin(async move {
                let path = arguments
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "a path is required".to_owned())?
                    .to_owned();
                let root = open_root(&handle)?;
                // Scoped in `read_file` itself, which refuses anything outside
                // the root — so an agent asking for `../../.ssh/id_rsa` gets
                // the same refusal a plugin would.
                // The text as a JSON string, because a tool result is
                // content an agent reads rather than a structure it walks.
                commands::read_file(root, path)
                    .map(Value::String)
                    .map_err(describe)
            })
        }),
    ));

    let handle = app.clone();
    registry.insert(Tool::new(
        "compile",
        "Compile the open project, and report whether it succeeded with any diagnostics.",
        json!({ "type": "object", "properties": {} }),
        Arc::new(move |_| {
            let handle = handle.clone();
            Box::pin(async move {
                let root = open_root(&handle)?;
                let outcome = commands::compile_project(root).map_err(describe)?;
                serde_json::to_value(outcome).map_err(|error| error.to_string())
            })
        }),
    ));
}

/// The open project's root, or a message saying there is none.
fn open_root(app: &tauri::AppHandle) -> std::result::Result<String, String> {
    app.try_state::<OpenProject>()
        .and_then(|state| state.root())
        .ok_or_else(|| "no project is open in yaz".to_owned())
}

/// A command error, as a sentence an agent can act on.
fn describe(error: CommandError) -> String {
    format!("{error:?}")
}
