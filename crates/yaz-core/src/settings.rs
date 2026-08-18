//! Settings schema, persistence and migration.
//!
//! The schema is the source of truth for the generated settings reference in the
//! docs site, so every setting needs a description key. See
//! [ADR-0016](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0016-documentation-strategy.md).

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

/// How many projects the recent list remembers.
///
/// Ten because it is a menu: a list long enough to scroll stops being faster
/// than opening the folder.
pub const RECENT_LIMIT: usize = 10;

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
    /// Active theme identifier, e.g. `yaz`. A theme provides both modes.
    pub theme: String,
    /// Light/dark resolution strategy.
    pub colour_mode: ColourMode,
    /// Interface locale — independent of the document locale.
    pub interface_locale: String,
    /// Whether the updater may check for application updates. Opt-in on first
    /// run; see [ADR-0013](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md).
    pub check_for_updates: bool,

    /// Recently opened project roots, most recent first.
    ///
    /// Application-wide rather than per project, for the obvious reason that a
    /// project cannot record that it was opened before it is opened.
    #[serde(default)]
    pub recent_projects: Vec<Utf8PathBuf>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            // One theme, both modes: which one shows is `colour_mode`, not a
            // second theme (ADR-0010).
            theme: "yaz".to_owned(),
            colour_mode: ColourMode::System,
            interface_locale: "en-US".to_owned(),
            check_for_updates: false,
            recent_projects: Vec::new(),
        }
    }
}

impl Settings {
    /// The settings file name inside the configuration directory.
    pub const FILE_NAME: &'static str = "settings.toml";

    /// Load settings, falling back to defaults.
    ///
    /// Unlike project settings, a malformed file here is **not** an error. A
    /// project's settings decide what gets compiled, so quietly ignoring a typo
    /// would build the wrong thing; these decide which theme is active and which
    /// folders appear in a menu, and refusing to start over them would be a
    /// worse failure than losing them.
    pub fn load(config_dir: &Utf8Path) -> Self {
        let path = config_dir.join(Self::FILE_NAME);
        let Ok(text) = std::fs::read_to_string(path.as_std_path()) else {
            return Self::default();
        };
        toml::from_str(&text).unwrap_or_default()
    }

    /// Write settings, creating the configuration directory if needed.
    pub fn save(&self, config_dir: &Utf8Path) -> crate::Result<()> {
        std::fs::create_dir_all(config_dir.as_std_path()).map_err(|source| crate::Error::Io {
            path: config_dir.to_owned(),
            source,
        })?;
        let path = config_dir.join(Self::FILE_NAME);
        let text = toml::to_string_pretty(self).map_err(|error| crate::Error::Io {
            path: path.clone(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()),
        })?;
        std::fs::write(path.as_std_path(), text).map_err(|source| crate::Error::Io {
            path: config_dir.join(Self::FILE_NAME),
            source,
        })
    }

    /// Record a project as most recently opened.
    ///
    /// Moves an already-known project to the front rather than adding it twice,
    /// which is what makes the list useful after the same few projects have been
    /// opened repeatedly.
    pub fn remember_project(&mut self, root: &Utf8Path) {
        self.recent_projects.retain(|existing| existing != root);
        self.recent_projects.insert(0, root.to_owned());
        self.recent_projects.truncate(RECENT_LIMIT);
    }

    /// Drop a project from the list, e.g. after it has been moved or deleted.
    pub fn forget_project(&mut self, root: &Utf8Path) {
        self.recent_projects.retain(|existing| existing != root);
    }
}

/// Where application settings live on this platform.
///
/// Hand-rolled rather than pulling in a directories crate: this is one path per
/// platform, and the crate would be a dependency, a licence and a supply-chain
/// entry for three `env::var` calls.
pub fn config_dir() -> Option<Utf8PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(Utf8PathBuf::from(appdata).join("yaz"))
    }

    #[cfg(target_os = "macos")]
    {
        Some(
            home_dir()?
                .join("Library")
                .join("Application Support")
                .join("yaz"),
        )
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return Some(Utf8PathBuf::from(xdg).join("yaz"));
            }
        }
        Some(home_dir()?.join(".config").join("yaz"))
    }
}

/// The user's home directory as UTF-8.
#[cfg(not(target_os = "windows"))]
fn home_dir() -> Option<Utf8PathBuf> {
    let raw = std::env::var_os("HOME")?;
    Utf8PathBuf::from_path_buf(std::path::PathBuf::from(raw)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        (dir, path)
    }

    #[test]
    fn settings_round_trip() {
        let (_guard, dir) = temp();
        let mut settings = Settings::default();
        settings.remember_project(Utf8Path::new("/projects/thesis"));
        settings.save(&dir).unwrap();

        let loaded = Settings::load(&dir);
        assert_eq!(loaded.recent_projects, settings.recent_projects);
        assert_eq!(loaded.theme, settings.theme);
    }

    #[test]
    fn absent_settings_are_defaults_rather_than_an_error() {
        let (_guard, dir) = temp();
        assert_eq!(Settings::load(&dir).recent_projects.len(), 0);
    }

    #[test]
    fn a_corrupt_file_does_not_stop_the_application_starting() {
        // The opposite of project settings, deliberately: these decide which
        // folders appear in a menu, and refusing to start over them would be a
        // worse failure than losing them.
        let (_guard, dir) = temp();
        std::fs::write(
            dir.join(Settings::FILE_NAME).as_std_path(),
            "not ] valid [ toml",
        )
        .unwrap();
        assert_eq!(Settings::load(&dir).theme, Settings::default().theme);
    }

    #[test]
    fn reopening_a_project_moves_it_to_the_front_rather_than_duplicating() {
        let mut settings = Settings::default();
        settings.remember_project(Utf8Path::new("/a"));
        settings.remember_project(Utf8Path::new("/b"));
        settings.remember_project(Utf8Path::new("/a"));

        assert_eq!(
            settings.recent_projects,
            vec![Utf8PathBuf::from("/a"), Utf8PathBuf::from("/b")],
            "the same project opened twice must appear once, at the top"
        );
    }

    #[test]
    fn the_list_is_bounded() {
        let mut settings = Settings::default();
        for n in 0..(RECENT_LIMIT + 5) {
            settings.remember_project(Utf8Path::new(&format!("/project-{n}")));
        }
        assert_eq!(settings.recent_projects.len(), RECENT_LIMIT);
        // Most recent first.
        assert_eq!(
            settings.recent_projects[0],
            Utf8PathBuf::from(format!("/project-{}", RECENT_LIMIT + 4))
        );
    }

    #[test]
    fn a_project_can_be_forgotten() {
        let mut settings = Settings::default();
        settings.remember_project(Utf8Path::new("/gone"));
        settings.forget_project(Utf8Path::new("/gone"));
        assert!(settings.recent_projects.is_empty());
    }
}
