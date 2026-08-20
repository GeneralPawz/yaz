//! JSON-RPC 2.0 and the slice of MCP yaz answers.
//!
//! Deliberately a slice. MCP has resources, prompts, sampling and more; yaz
//! answers `initialize`, `tools/list` and `tools/call`, because tools are what
//! an agent driving an editor needs and the rest can be added when something
//! actually wants them. A server that half-implements six things is worse than
//! one that fully implements three, because a client cannot tell which half it
//! got.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The protocol revision this speaks.
///
/// Sent back at `initialize` so a client knows what it is talking to. A client
/// asking for a version we do not have gets ours rather than an error — which
/// is what the specification asks for, and is friendlier than refusing to
/// start over a version string.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// A request as it arrives.
#[derive(Debug, Deserialize)]
pub struct Request {
    /// Always `"2.0"`, and not checked: a client that gets this wrong has
    /// bigger problems than we can report.
    #[serde(default)]
    pub jsonrpc: String,
    /// Absent for a notification, which expects no reply.
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// A reply.
#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorObject>,
}

/// A failure, in the shape JSON-RPC asks for.
#[derive(Debug, Serialize)]
pub struct ErrorObject {
    pub code: i32,
    pub message: String,
}

impl Response {
    /// A successful reply.
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    /// A failed reply.
    pub fn failed(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(ErrorObject {
                code,
                message: message.into(),
            }),
        }
    }
}

/// The codes this server uses, from the JSON-RPC range.
pub mod codes {
    /// The method is not one we answer.
    pub const METHOD_NOT_FOUND: i32 = -32601;
    /// The parameters were not what the method needs.
    pub const INVALID_PARAMS: i32 = -32602;
    /// The tool ran and failed, or could not be reached.
    pub const INTERNAL: i32 = -32603;
}

/// What `initialize` answers.
///
/// `tools.listChanged` is true because a plugin can be enabled or disabled
/// while the server is running, and a client that cached the list would
/// otherwise be wrong until it reconnected.
pub fn initialize_result(server_name: &str, server_version: &str) -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": { "listChanged": true } },
        "serverInfo": { "name": server_name, "version": server_version },
    })
}

/// Wrap a tool's return value the way MCP expects a tool result.
///
/// Text content, always: an agent reads text, and a tool that wants to return
/// structure returns it as JSON *in* the text — which is what every MCP client
/// already knows how to handle.
pub fn tool_result(value: &Value) -> Value {
    let text = match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    };
    json!({ "content": [{ "type": "text", "text": text }], "isError": false })
}

/// The same, for a tool that failed.
///
/// A failed *tool* is not a failed *call*: the agent asked a reasonable
/// question and got an answer it can act on, so this is a result with
/// `isError` rather than a JSON-RPC error, which is what the specification
/// asks for and what lets an agent retry sensibly.
pub fn tool_failure(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}
