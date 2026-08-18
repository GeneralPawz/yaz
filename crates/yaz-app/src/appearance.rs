//! Themes, colour mode and interface language.
//!
//! # A theme provides both modes
//!
//! [ADR-0010](https://generalpawz.github.io/yaz/adr/0010-theming) requires it.
//! A theme that supplied only one would either force the whole application to
//! that mode or leave the other looking like a different program, and
//! "installing this theme took your dark mode away" is not a state a user
//! should be able to reach. A manifest that claims one mode is refused here
//! rather than half-applied.
//!
//! # Where themes live
//!
//! The bundled one is compiled into the application. Installed ones are folders
//! under `<config>/themes/<id>/` holding `manifest.json` and `theme.css`,
//! which is the same shape the theme builder exports — so a theme someone
//! shares is installed by unzipping it into that folder.

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use yaz_core::Error;
use yaz_core::settings::{ColourMode, KeyPreferences, Settings};

use crate::commands::{CommandError, Result};

/// Where settings and installed themes live.
///
/// The absence of a configuration directory is a machine with no `APPDATA` or
/// no home, which is not a state worth a distinct error: nothing can be stored
/// and nothing was.
fn config_dir() -> Result<Utf8PathBuf> {
    yaz_core::settings::config_dir()
        .ok_or_else(|| CommandError::new("error-fs-not-found", "no configuration directory"))
}

/// The identifier of the theme compiled into the application.
pub const BUNDLED_THEME: &str = "yaz";

/// A theme as the interface needs to know it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    /// Folder name and stable identifier.
    pub id: String,
    /// Display name, which is data rather than a message key: a theme's name is
    /// its author's, and translating it would be wrong.
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Whether this theme ships with the application.
    #[serde(default)]
    pub bundled: bool,
}

/// What a manifest file holds.
#[derive(Debug, Deserialize)]
struct Manifest {
    id: String,
    name: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    description: String,
    /// Which colour modes the theme provides. Both, or it is not installed.
    #[serde(default)]
    modes: Vec<String>,
}

/// The appearance settings, as the interface holds them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: String,
    pub colour_mode: ColourMode,
    pub interface_locale: String,
}

/// Read the appearance settings.
#[tauri::command]
pub fn get_appearance() -> Result<Appearance> {
    let settings = Settings::load(&config_dir()?);
    Ok(Appearance {
        theme: settings.theme,
        colour_mode: settings.colour_mode,
        interface_locale: settings.interface_locale,
    })
}

/// Store the appearance settings.
#[tauri::command]
pub fn set_appearance(appearance: Appearance) -> Result<()> {
    let directory = config_dir()?;
    let mut settings = Settings::load(&directory);
    settings.theme = appearance.theme;
    settings.colour_mode = appearance.colour_mode;
    settings.interface_locale = appearance.interface_locale;
    Ok(settings.save(&directory)?)
}

/// Every theme that can be chosen.
///
/// The bundled one first and always present: a listing that could come back
/// empty would leave the application with no way to look like anything.
#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemeInfo>> {
    let mut found = vec![ThemeInfo {
        id: BUNDLED_THEME.to_owned(),
        name: "yaz".to_owned(),
        author: "yaz contributors".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        description: String::new(),
        bundled: true,
    }];

    let directory = themes_dir()?;
    let Ok(entries) = std::fs::read_dir(directory.as_std_path()) else {
        return Ok(found);
    };
    for entry in entries.flatten() {
        let Ok(name) = Utf8PathBuf::from_path_buf(entry.path()) else {
            continue;
        };
        if let Some(theme) = read_manifest(&name) {
            // A theme cannot shadow the bundled one; otherwise a folder named
            // `yaz` would make the application unable to fall back to it.
            if theme.id != BUNDLED_THEME {
                found.push(theme);
            }
        }
    }
    Ok(found)
}

/// The stylesheet of an installed theme.
///
/// The bundled theme returns nothing: it is compiled into the frontend bundle,
/// and serving a second copy of it would put the same rules in the cascade
/// twice.
#[tauri::command]
pub fn theme_stylesheet(id: String) -> Result<String> {
    if id == BUNDLED_THEME {
        return Ok(String::new());
    }
    let path = themes_dir()?.join(&id).join("theme.css");
    Ok(std::fs::read_to_string(path.as_std_path()).map_err(|source| Error::Io { path, source })?)
}

/// Write a theme bundle into a folder, ready to share or to install.
///
/// Returns where it was written. The folder is named after the theme so that
/// unzipping the result into `<config>/themes/` installs it, which is the
/// whole point of exporting one.
#[tauri::command]
pub fn export_theme(directory: String, manifest: String, css: String) -> Result<String> {
    let parsed: Manifest = serde_json::from_str(&manifest)
        .map_err(|error| CommandError::new("theme-error-manifest", error))?;
    check_modes(&parsed)?;

    let target = Utf8PathBuf::from(directory).join(&parsed.id);
    std::fs::create_dir_all(target.as_std_path()).map_err(|source| Error::Io {
        path: target.clone(),
        source,
    })?;

    write(&target.join("manifest.json"), &manifest)?;
    write(&target.join("theme.css"), &css)?;
    Ok(target.into_string())
}

/// Write a theme bundle straight into the themes folder.
///
/// What the builder calls when a theme is put to use. Separate from exporting
/// because "use this" has to survive closing the window: a theme that lived
/// only in the builder's state would be gone at the next start, taking the
/// interface's appearance with it.
#[tauri::command]
pub fn save_theme(manifest: String, css: String) -> Result<ThemeInfo> {
    let directory = themes_dir()?;
    std::fs::create_dir_all(directory.as_std_path()).map_err(|source| Error::Io {
        path: directory.clone(),
        source,
    })?;
    let parsed: Manifest = serde_json::from_str(&manifest)
        .map_err(|error| CommandError::new("theme-error-manifest", error))?;
    export_theme(directory.to_string(), manifest, css)?;

    Ok(ThemeInfo {
        id: parsed.id,
        name: parsed.name,
        author: parsed.author,
        version: parsed.version,
        description: parsed.description,
        bundled: false,
    })
}

/// Install a theme bundle from a folder, by copying it in.
#[tauri::command]
pub fn install_theme(source: String) -> Result<ThemeInfo> {
    let source = Utf8PathBuf::from(source);
    let Some(theme) = read_manifest(&source) else {
        return Err(CommandError::new(
            "theme-error-manifest",
            format!("{source} is not a theme bundle"),
        ));
    };

    let target = themes_dir()?.join(&theme.id);
    std::fs::create_dir_all(target.as_std_path()).map_err(|source| Error::Io {
        path: target.clone(),
        source,
    })?;
    for file in ["manifest.json", "theme.css"] {
        let from = source.join(file);
        let contents = std::fs::read_to_string(from.as_std_path())
            .map_err(|source| Error::Io { path: from, source })?;
        write(&target.join(file), &contents)?;
    }
    Ok(theme)
}

/// Where installed themes live.
fn themes_dir() -> Result<Utf8PathBuf> {
    Ok(config_dir()?.join("themes"))
}

/// Read and validate a theme folder's manifest.
fn read_manifest(folder: &Utf8Path) -> Option<ThemeInfo> {
    let text = std::fs::read_to_string(folder.join("manifest.json").as_std_path()).ok()?;
    let manifest: Manifest = serde_json::from_str(&text).ok()?;
    check_modes(&manifest).ok()?;
    if !folder.join("theme.css").exists() {
        return None;
    }
    Some(ThemeInfo {
        id: manifest.id,
        name: manifest.name,
        author: manifest.author,
        version: manifest.version,
        description: manifest.description,
        bundled: false,
    })
}

/// A theme must provide light and dark.
fn check_modes(manifest: &Manifest) -> Result<()> {
    let has = |mode: &str| manifest.modes.iter().any(|value| value == mode);
    if has("light") && has("dark") {
        return Ok(());
    }
    Err(CommandError::new(
        "theme-error-modes",
        format!("{} does not provide both light and dark", manifest.id),
    ))
}

fn write(path: &Utf8PathBuf, contents: &str) -> Result<()> {
    Ok(
        std::fs::write(path.as_std_path(), contents).map_err(|source| Error::Io {
            path: path.clone(),
            source,
        })?,
    )
}

/// What the user changed about the keyboard.
///
/// Stored with the other application settings rather than per project: a
/// keyboard belongs to the person, not to the paper.
#[tauri::command]
pub fn get_key_preferences() -> Result<KeyPreferences> {
    Ok(Settings::load(&config_dir()?).keys)
}

/// Store the keyboard changes.
#[tauri::command]
pub fn set_key_preferences(preferences: KeyPreferences) -> Result<()> {
    let directory = config_dir()?;
    let mut settings = Settings::load(&directory);
    settings.keys = preferences;
    Ok(settings.save(&directory)?)
}
