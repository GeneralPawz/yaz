//! Plugin manifests.
//!
//! The same `manifest.json` format is used by core plugins and community
//! plugins, because they are the same thing
//! ([ADR-0005](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0005-extensibility-tiers.md)).

use crate::capability::Capability;
use semver::Version;
use serde::{Deserialize, Serialize};
use url::Url;

/// A plugin's `manifest.json`.
///
/// Field names are camelCase on the wire, matching what a plugin author writes
/// and what `packages/plugin-template/manifest.json` ships. Without the rename
/// this struct silently fails to parse its own template, since `minAppVersion`
/// would have to be spelled `min_app_version` in the JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Stable, globally unique identifier, e.g. `com.example.my-plugin`.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// The plugin's own version, set by its author.
    pub version: Version,
    /// Minimum application version required. A plugin requiring a newer
    /// application is not loaded and not offered as an update.
    pub min_app_version: Version,
    /// Author name.
    pub author: String,
    /// Short description shown in the plugin list.
    pub description: String,
    /// Source repository, used for update checks.
    #[serde(default)]
    pub repository: Option<Url>,
    /// Capabilities the plugin requests. The user grants these at install.
    ///
    /// An update requesting capabilities beyond the installed set is blocked
    /// until explicitly approved — see
    /// [ADR-0013](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md).
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// What the plugin adds to yaz, as opposed to what it asks yaz for.
    ///
    /// Declared so that it can be read without running the plugin — which is
    /// what a person deciding whether to install it needs, and what a registry
    /// would list ([ADR-0022]).
    ///
    /// [ADR-0022]: https://github.com/texyaz/yaz/blob/main/docs/adr/0022-mcp-and-tool-declaration.md
    #[serde(default)]
    pub provides: Provides,
    /// Where the plugin's own updates come from, and how eagerly to take them.
    ///
    /// Absent for a plugin that does not update itself — which is every plugin
    /// loaded from a development directory, and any that is happy to arrive
    /// only with the application.
    #[serde(default)]
    pub updates: Option<Updates>,
}

/// What a plugin contributes.
///
/// A contribution is not a permission: none of this is granted by the broker,
/// because none of it lets the plugin do anything it could not already do. It
/// is here to be *read* — before installing, and by a registry.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provides {
    /// Tools the plugin adds to yaz's MCP server, for an agent to call.
    #[serde(default)]
    pub tools: Vec<ToolDeclaration>,
}

/// One tool a plugin says it provides.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDeclaration {
    /// Unique within the plugin. Namespaced by plugin id when exposed, so two
    /// plugins may both provide `search` without knowing about each other.
    pub name: String,
    /// Message key for what the tool does, shown to a person and to an agent.
    pub description_key: String,
}

impl Provides {
    /// Whether the plugin declared a tool by this name.
    ///
    /// Asked when the plugin registers one. A tool the manifest did not
    /// declare is refused, which is what stops the declaration being a comment
    /// — a manifest entry nothing checks drifts out of date within one release
    /// and then actively misleads, because people trust it.
    pub fn declares_tool(&self, name: &str) -> bool {
        self.tools.iter().any(|tool| tool.name == name)
    }
}

/// Where a plugin's updates come from.
///
/// The plugin says, rather than the application holding a list of plugins it
/// knows about. That is Obsidian's shape and deliberately so: it is a shape
/// plugin authors already understand, it needs no registry to exist before the
/// first plugin can ship, and a plugin hosted somewhere we have never heard of
/// is a `source` nobody has written yet rather than a plugin we have forbidden
/// ([ADR-0021]).
///
/// [ADR-0021]: https://github.com/texyaz/yaz/blob/main/docs/adr/0021-plugin-distribution.md
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Updates {
    /// Which mechanism fetches them.
    pub source: UpdateSource,
    /// What to fetch, read according to `source`. For GitHub: `owner/name`.
    pub repository: String,
    /// Which stream to follow.
    #[serde(default)]
    pub channel: UpdateChannel,
}

/// The mechanisms an update can come through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateSource {
    /// A GitHub repository's releases.
    Github,
}

/// How eagerly a plugin takes its own updates.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    /// Published releases only. What almost every plugin wants.
    #[default]
    Release,
    /// Pre-releases too, for someone testing a plugin before it ships.
    Prerelease,
    /// Never. The plugin arrives with the application and stays as it is.
    Manual,
}

impl Manifest {
    /// Whether this plugin may be updated to `candidate`.
    ///
    /// Three conditions, and each is a way an update goes wrong in a manner
    /// that reports as the *application* being broken rather than the plugin:
    ///
    /// - it must be the same plugin, because an id changing mid-update is
    ///   either a mistake or an attempt to become a plugin somebody trusted;
    /// - it must be newer, so a rollback is a deliberate act and not something
    ///   a mis-tagged release does by itself;
    /// - and the running application must satisfy the candidate's
    ///   `minAppVersion`, or the plugin loads and then fails against an API it
    ///   expected to find.
    pub fn accepts_update(&self, candidate: &Manifest, app_version: &Version) -> bool {
        candidate.id == self.id
            && candidate.version > self.version
            && &candidate.min_app_version <= app_version
    }

    /// Whether this plugin looks for updates at all.
    pub fn updates_itself(&self) -> bool {
        matches!(
            self.updates.as_ref().map(|u| u.channel),
            Some(UpdateChannel::Release) | Some(UpdateChannel::Prerelease)
        )
    }
}

// TODO(phase-3): validation (reject wildcard net hosts, reject reserved ids),
// capability-diff against an installed version, checksum verification.

#[cfg(test)]
mod tests {
    use super::*;

    /// A manifest, with the parts a test cares about set.
    fn manifest(version: &str, min_app: &str) -> Manifest {
        Manifest {
            id: "com.example.plugin".to_owned(),
            name: "Example".to_owned(),
            version: Version::parse(version).expect("a version"),
            min_app_version: Version::parse(min_app).expect("a version"),
            author: "Someone".to_owned(),
            description: "An example.".to_owned(),
            repository: None,
            capabilities: Vec::new(),
            provides: Provides::default(),
            updates: None,
        }
    }

    fn app(version: &str) -> Version {
        Version::parse(version).expect("a version")
    }

    #[test]
    fn takes_a_newer_version() {
        let installed = manifest("0.2.0", "0.2.0");
        let candidate = manifest("0.3.0", "0.2.0");
        assert!(installed.accepts_update(&candidate, &app("0.2.0")));
    }

    #[test]
    fn refuses_an_older_one() {
        // A rollback should be a deliberate act, not something a mis-tagged
        // release does by itself.
        let installed = manifest("0.3.0", "0.2.0");
        let candidate = manifest("0.2.0", "0.2.0");
        assert!(!installed.accepts_update(&candidate, &app("0.2.0")));
    }

    #[test]
    fn refuses_the_same_one() {
        let installed = manifest("0.2.0", "0.2.0");
        assert!(!installed.accepts_update(&installed.clone(), &app("0.2.0")));
    }

    #[test]
    fn refuses_one_the_application_is_too_old_for() {
        // The failure this prevents is the worst kind: the plugin installs,
        // loads, and then fails against an API that is not there — which
        // reports as the application being broken.
        let installed = manifest("0.2.0", "0.2.0");
        let candidate = manifest("0.3.0", "0.9.0");
        assert!(!installed.accepts_update(&candidate, &app("0.2.0")));
    }

    #[test]
    fn takes_one_the_application_exactly_satisfies() {
        let installed = manifest("0.2.0", "0.2.0");
        let candidate = manifest("0.3.0", "0.3.0");
        assert!(installed.accepts_update(&candidate, &app("0.3.0")));
    }

    #[test]
    fn refuses_a_different_plugin() {
        // An id changing mid-update is either a mistake or an attempt to
        // become a plugin somebody already trusted.
        let installed = manifest("0.2.0", "0.2.0");
        let mut candidate = manifest("0.3.0", "0.2.0");
        candidate.id = "com.example.other".to_owned();
        assert!(!installed.accepts_update(&candidate, &app("0.2.0")));
    }

    #[test]
    fn a_plugin_without_an_updates_block_does_not_update_itself() {
        assert!(!manifest("0.2.0", "0.2.0").updates_itself());
    }

    #[test]
    fn a_manual_channel_does_not_update_itself() {
        let mut plugin = manifest("0.2.0", "0.2.0");
        plugin.updates = Some(Updates {
            source: UpdateSource::Github,
            repository: "texyaz/yaz-example".to_owned(),
            channel: UpdateChannel::Manual,
        });
        assert!(!plugin.updates_itself());
    }

    #[test]
    fn a_release_channel_does() {
        let mut plugin = manifest("0.2.0", "0.2.0");
        plugin.updates = Some(Updates {
            source: UpdateSource::Github,
            repository: "texyaz/yaz-example".to_owned(),
            channel: UpdateChannel::Release,
        });
        assert!(plugin.updates_itself());
    }

    #[test]
    fn reads_the_updates_block_a_real_plugin_ships() {
        let source = r#"{
            "id": "com.yaz.zotero",
            "name": "Zotero",
            "version": "0.2.0",
            "minAppVersion": "0.2.0",
            "author": "yaz",
            "description": "Cite from Zotero.",
            "capabilities": [{ "kind": "zotero" }],
            "updates": {
                "source": "github",
                "repository": "texyaz/yaz-zotero",
                "channel": "release"
            }
        }"#;
        let manifest: Manifest = serde_json::from_str(source).expect("it parses");
        let updates = manifest.updates.expect("an updates block");
        assert_eq!(updates.source, UpdateSource::Github);
        assert_eq!(updates.repository, "texyaz/yaz-zotero");
        assert_eq!(updates.channel, UpdateChannel::Release);
    }

    #[test]
    fn a_manifest_without_updates_still_parses() {
        // Every manifest written before this field existed, and every plugin
        // content to arrive with the application.
        let source = r#"{
            "id": "com.example.plugin",
            "name": "Example",
            "version": "0.1.0",
            "minAppVersion": "0.1.0",
            "author": "Someone",
            "description": "An example."
        }"#;
        let manifest: Manifest = serde_json::from_str(source).expect("it parses");
        assert!(manifest.updates.is_none());
        assert!(!manifest.updates_itself());
    }

    #[test]
    fn a_declared_tool_is_recognised() {
        let provides = Provides {
            tools: vec![ToolDeclaration {
                name: "search-library".to_owned(),
                description_key: "zotero-tool-search".to_owned(),
            }],
        };
        assert!(provides.declares_tool("search-library"));
    }

    #[test]
    fn an_undeclared_tool_is_not() {
        // What stops the declaration being a comment: a plugin registering a
        // tool its manifest never mentioned is refused, so the manifest cannot
        // drift out of date without somebody noticing.
        let provides = Provides {
            tools: vec![ToolDeclaration {
                name: "search-library".to_owned(),
                description_key: "zotero-tool-search".to_owned(),
            }],
        };
        assert!(!provides.declares_tool("delete-everything"));
    }

    #[test]
    fn a_plugin_that_provides_nothing_declares_nothing() {
        assert!(!Provides::default().declares_tool("anything"));
    }

    #[test]
    fn reads_a_manifest_that_provides_tools_and_calls_a_server() {
        // The two halves of ADR-0022 in one manifest: what it asks for, which
        // is a capability, and what it adds, which is not.
        let source = r#"{
            "id": "com.example.agent",
            "name": "Agent",
            "version": "0.1.0",
            "minAppVersion": "0.2.0",
            "author": "Someone",
            "description": "An example.",
            "capabilities": [
                { "kind": "mcp-client", "servers": ["reference-checker"] }
            ],
            "provides": {
                "tools": [
                    { "name": "check", "descriptionKey": "agent-tool-check" }
                ]
            }
        }"#;
        let manifest: Manifest = serde_json::from_str(source).expect("it parses");
        assert_eq!(manifest.capabilities.len(), 1);
        assert_eq!(manifest.capabilities[0].id(), "mcp:client");
        assert!(manifest.provides.declares_tool("check"));
    }

    #[test]
    fn a_manifest_without_provides_still_parses() {
        // Every manifest written before the field existed.
        let source = r#"{
            "id": "com.example.plugin",
            "name": "Example",
            "version": "0.1.0",
            "minAppVersion": "0.1.0",
            "author": "Someone",
            "description": "An example."
        }"#;
        let manifest: Manifest = serde_json::from_str(source).expect("it parses");
        assert!(manifest.provides.tools.is_empty());
    }
}
