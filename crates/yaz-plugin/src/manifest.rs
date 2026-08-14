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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

// TODO(phase-3): validation (reject wildcard net hosts, reject reserved ids),
// capability-diff against an installed version, checksum verification.
