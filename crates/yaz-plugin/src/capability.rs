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
            Capability::Process { .. }
                | Capability::FsWrite { .. }
                | Capability::Net { .. }
                | Capability::McpClient { .. }
        )
    }

    /// One of every variant, for tests that must cover the whole vocabulary.
    ///
    /// Adding a capability without adding it here is caught by the exhaustive
    /// `match` below, which is the point: the tests that walk this list are
    /// checking that nothing was forgotten, so the list itself must not be the
    /// thing that gets forgotten.
    #[cfg(test)]
    fn every() -> Vec<Capability> {
        let all = vec![
            Capability::FsProject,
            Capability::FsRead {
                path: "/tmp".into(),
            },
            Capability::FsWrite {
                path: "/tmp".into(),
            },
            Capability::Net { hosts: vec![] },
            Capability::Process { binaries: vec![] },
            Capability::McpClient { servers: vec![] },
            Capability::Zotero,
            Capability::Obsidian,
            Capability::Clipboard,
            Capability::Notifications,
            Capability::ShellOpen,
        ];
        // Not reached; it exists so that a new variant fails to compile here.
        if false {
            match all[0] {
                Capability::FsProject
                | Capability::FsRead { .. }
                | Capability::FsWrite { .. }
                | Capability::Net { .. }
                | Capability::Process { .. }
                | Capability::McpClient { .. }
                | Capability::Zotero
                | Capability::Obsidian
                | Capability::Clipboard
                | Capability::Notifications
                | Capability::ShellOpen => {}
            }
        }
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The catalogues, read at compile time so a moved file fails the build.
    const EN: &str = include_str!("../../../locales/en-US.ftl");
    const DE: &str = include_str!("../../../locales/de-DE.ftl");

    /// Whether a catalogue defines a key, by the same shape `i18n.ts` reads:
    /// `key = value` on one line.
    fn defines(catalogue: &str, key: &str) -> bool {
        catalogue
            .lines()
            .any(|line| line.starts_with(&format!("{key} = ")))
    }

    #[test]
    fn every_capability_can_be_explained_to_the_person_granting_it() {
        // The install dialog shows this text, and a plugin asking for a
        // permission nobody can read is a permission nobody can refuse
        // meaningfully. The documentation generator prints a placeholder
        // instead, which is how `mcp:client` went a whole feature without one.
        for capability in Capability::every() {
            let key = capability.description_key();
            assert!(
                defines(EN, &key),
                "{} has no {key} in locales/en-US.ftl",
                capability.id()
            );
            assert!(
                defines(DE, &key),
                "{} has no {key} in locales/de-DE.ftl",
                capability.id()
            );
        }
    }

    #[test]
    fn reaching_outside_the_process_is_sensitive() {
        // Everything that can touch something other than this project: the
        // network, another program, a file elsewhere, an MCP server. ADR-0022
        // is explicit that calling out over MCP belongs with `net` and
        // `process`, and it is exactly as easy to leak a document through.
        for capability in Capability::every() {
            let expected = matches!(
                capability,
                Capability::Net { .. }
                    | Capability::Process { .. }
                    | Capability::FsWrite { .. }
                    | Capability::McpClient { .. }
            );
            assert_eq!(
                capability.is_sensitive(),
                expected,
                "{} is marked the wrong way",
                capability.id()
            );
        }
    }

    #[test]
    fn description_keys_are_valid_fluent_identifiers() {
        // Fluent permits neither `:` nor `.`, and `fs:project` has one.
        for capability in Capability::every() {
            let key = capability.description_key();
            assert!(
                key.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "{key} is not a Fluent identifier"
            );
        }
    }
}
