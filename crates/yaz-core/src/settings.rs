//! Settings schema, persistence and migration.
//!
//! The schema is the source of truth for the generated settings reference in the
//! docs site, so every setting needs a description key. See
//! [ADR-0016](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0016-documentation-strategy.md).

use serde::{Deserialize, Serialize};

/// How the application resolves light and dark appearance.
///
/// See [ADR-0010](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0010-theming.md).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColourMode {
    /// Follow the operating system.
    #[default]
    System,
    /// Always light.
    Light,
    /// Always dark.
    Dark,
}

/// Top-level application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Active theme identifier, e.g. `yaz-dark`.
    pub theme: String,
    /// Light/dark resolution strategy.
    pub colour_mode: ColourMode,
    /// Interface locale — independent of the document locale.
    pub interface_locale: String,
    /// Whether the updater may check for application updates. Opt-in on first
    /// run; see [ADR-0013](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md).
    pub check_for_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "yaz-dark".to_owned(),
            colour_mode: ColourMode::System,
            interface_locale: "en-US".to_owned(),
            check_for_updates: false,
        }
    }
}

// TODO(phase-3): schema export for docs generation, versioned migration.
