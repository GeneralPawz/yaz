//! The capability vocabulary.
//!
//! This enum is the single source of truth for the capability reference in the
//! docs site — the page is generated from it, never hand-written
//! ([ADR-0016](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0016-documentation-strategy.md)).
//!
//! The vocabulary is deliberately small. A user has to read the granted list in
//! an install dialog and understand it; a vocabulary that is precise but
//! unreadable protects nobody.

use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};

/// A permission a plugin declares in its manifest and the user grants at install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[non_exhaustive]
pub enum Capability {
    /// Read and write anywhere within the open project root.
    FsProject,

    /// Read a declared path outside the project.
    FsRead {
        /// The path, canonicalised before any check.
        path: Utf8PathBuf,
    },

    /// Write to a declared path outside the project.
    FsWrite {
        /// The path, canonicalised before any check.
        path: Utf8PathBuf,
    },

    /// HTTP requests to explicitly declared hosts.
    ///
    /// Wildcard hosts are rejected at manifest validation. A capability that
    /// grants "the internet" is not a capability.
    Net {
        /// Permitted host patterns, e.g. `api.crossref.org`.
        hosts: Vec<String>,
    },

    /// Execute a declared binary with validated arguments.
    Process {
        /// Binaries the plugin may invoke.
        binaries: Vec<String>,
    },

    /// Call declared MCP servers.
    ///
    /// Reaching an MCP server is reaching outside the process, to something
    /// the user did not necessarily set up — so it is a permission, and it
    /// names the servers rather than granting "MCP". A capability that grants
    /// any server is not a capability, for the same reason [`Capability::Net`]
    /// refuses a wildcard host ([ADR-0022]).
    ///
    /// Note what this is *not*: contributing a tool to yaz's own MCP server is
    /// a declaration and not a capability, because a contributed tool can do
    /// nothing the plugin could not already do. See `Manifest::provides`.
    ///
    /// [ADR-0022]: https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md
    McpClient {
        /// Servers the plugin may call, by their configured name.
        servers: Vec<String>,
    },

    /// Access the Zotero bridge.
    Zotero,

    /// Access the Obsidian vault bridge.
    Obsidian,

    /// Read and write the system clipboard.
    Clipboard,

    /// Post desktop notifications.
    Notifications,

    /// Open a URL or file with the system handler.
    ShellOpen,
}

impl Capability {
    /// Stable identifier used in manifests and in the generated documentation.
    pub fn id(&self) -> &'static str {
        match self {
            Capability::FsProject => "fs:project",
            Capability::FsRead { .. } => "fs:read",
            Capability::FsWrite { .. } => "fs:write",
            Capability::Net { .. } => "net",
            Capability::Process { .. } => "process",
            Capability::McpClient { .. } => "mcp:client",
            Capability::Zotero => "zotero",
            Capability::Obsidian => "obsidian",
            Capability::Clipboard => "clipboard",
            Capability::Notifications => "notifications",
            Capability::ShellOpen => "shell:open",
        }
    }

    /// Message key for the human-readable explanation shown at install time.
    ///
    /// Derived from [`Capability::id`] with `:` replaced by `-`, because Fluent
    /// identifiers permit neither colons nor dots. `fs:project` therefore
    /// resolves against `capability-fs-project-description`.
    pub fn description_key(&self) -> String {
        format!("capability-{}-description", self.id().replace(':', "-"))
    }

    /// Whether granting this is high-risk and warrants extra emphasis in the
    /// install dialog.
    pub fn is_sensitive(&self) -> bool {
        matches!(
            self,
            Capability::Process { .. } | Capability::FsWrite { .. } | Capability::Net { .. }
        )
    }
}
