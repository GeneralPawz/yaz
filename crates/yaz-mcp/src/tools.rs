//! What an agent may ask yaz to do.
//!
//! A tool is a name, a description, a schema for its arguments, and something
//! to run. The registry holds them; it does not know where they came from —
//! some are the application's own and some are a plugin's
//! ([ADR-0022](https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md)),
//! and from here they are the same thing.
//!
//! # Names are namespaced by whoever provided them
//!
//! `zotero.search` rather than `search`, so two plugins may both provide a
//! `search` without either having to know the other exists. The application's
//! own tools have no prefix, which is also how you can tell them apart.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{Value, json};

/// What a tool returns, once it is done.
pub type ToolFuture = Pin<Box<dyn Future<Output = Result<Value, String>> + Send>>;

/// The thing a tool actually does.
pub type ToolHandler = Arc<dyn Fn(Value) -> ToolFuture + Send + Sync>;

/// One tool.
#[derive(Clone)]
pub struct Tool {
    /// Namespaced, e.g. `zotero.search`. Unique in a registry.
    pub name: String,
    /// What it does, in the interface language — an agent reads this to decide
    /// whether to call it, so it is the most load-bearing string here.
    pub description: String,
    /// JSON Schema for the arguments.
    pub input_schema: Value,
    /// Which plugin provided it, or `None` for the application's own.
    pub provider: Option<String>,
    handler: ToolHandler,
}

impl std::fmt::Debug for Tool {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Tool")
            .field("name", &self.name)
            .field("provider", &self.provider)
            .finish_non_exhaustive()
    }
}

impl Tool {
    /// Define a tool.
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
        handler: ToolHandler,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            input_schema,
            provider: None,
            handler,
        }
    }

    /// Say which plugin provided it, which also namespaces its name.
    pub fn from_plugin(mut self, plugin_id: impl Into<String>, short_name: &str) -> Self {
        let plugin_id = plugin_id.into();
        // The last segment of the id: `com.yaz.zotero` becomes `zotero`, which
        // is what an agent will see and what a person reading a tool list can
        // make sense of.
        let prefix = plugin_id
            .rsplit('.')
            .next()
            .unwrap_or(plugin_id.as_str())
            .to_owned();
        self.name = format!("{prefix}.{short_name}");
        self.provider = Some(plugin_id);
        self
    }

    /// Run it.
    pub fn call(&self, arguments: Value) -> ToolFuture {
        (self.handler)(arguments)
    }

    /// The shape `tools/list` reports.
    pub fn describe(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
        })
    }
}

/// Every tool an agent may reach.
///
/// A `BTreeMap` so `tools/list` comes back in a stable order — an agent
/// re-reading the list should not see it shuffle, and a person diffing two
/// listings should see only what changed.
#[derive(Default, Clone, Debug)]
pub struct Registry {
    tools: BTreeMap<String, Tool>,
}

impl Registry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a tool, replacing one of the same name.
    ///
    /// Replacing rather than refusing, because the case that reaches here is a
    /// plugin being reloaded during development — and a reload that left the
    /// old handler in place would be the most confusing possible outcome.
    pub fn insert(&mut self, tool: Tool) {
        self.tools.insert(tool.name.clone(), tool);
    }

    /// Drop every tool a plugin provided.
    ///
    /// Called when a plugin is disabled or reloaded. A tool whose plugin is
    /// gone must go with it: an agent calling into a plugin that is no longer
    /// there would hang until the call timed out, which reads as the editor
    /// being broken rather than as the plugin being off.
    pub fn remove_provider(&mut self, plugin_id: &str) {
        self.tools
            .retain(|_, tool| tool.provider.as_deref() != Some(plugin_id));
    }

    /// Look one up.
    pub fn get(&self, name: &str) -> Option<&Tool> {
        self.tools.get(name)
    }

    /// How many there are.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Whether there are none.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Every tool, as `tools/list` reports them.
    pub fn describe_all(&self) -> Value {
        json!({
            "tools": self.tools.values().map(Tool::describe).collect::<Vec<_>>(),
        })
    }
}
