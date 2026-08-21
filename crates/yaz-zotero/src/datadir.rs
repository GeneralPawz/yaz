//! Finding Zotero's data directory.
//!
//! # Why this is not just `~/Zotero`
//!
//! That is only the default, and a user who moved their library — onto a
//! second drive, or out of a synced folder — has a `profiles.ini` and a
//! `prefs.js` that say where it actually went. Worse, a machine can hold
//! several profiles pointing at *different* libraries, and picking the wrong one
//! does not fail: it succeeds against an empty database and reports a library
//! with no items in it, which reads as "Zotero isn't set up" rather than "yaz
//! looked in the wrong place".
//!
//! This module was written against exactly that situation — two profiles, one
//! with eleven thousand items and one with none — so it follows the same rule
//! Zotero itself does: honour `Default=1`, then the profile's own `dataDir`,
//! and only then fall back to the conventional location.
//!
//! The resolution is reported rather than assumed, because a user whose library
//! looks empty needs to see *which* directory was consulted.

use camino::{Utf8Path, Utf8PathBuf};

/// Where a data directory came from, so the interface can explain itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// The user set the path explicitly in yaz's settings.
    Configured,
    /// Read from the default profile's `prefs.js`.
    ProfilePref,
    /// The conventional location, because nothing else said otherwise.
    Convention,
}

impl Origin {
    /// Message key explaining this origin to the user.
    pub fn label_key(&self) -> &'static str {
        match self {
            Origin::Configured => "zotero-datadir-configured",
            Origin::ProfilePref => "zotero-datadir-profile",
            Origin::Convention => "zotero-datadir-convention",
        }
    }
}

/// A resolved Zotero data directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDir {
    /// The directory itself.
    pub path: Utf8PathBuf,
    /// How it was arrived at.
    pub origin: Origin,
}

impl DataDir {
    /// Path to the library database inside this directory.
    pub fn database(&self) -> Utf8PathBuf {
        self.path.join("zotero.sqlite")
    }

    /// Whether a library database is actually present.
    pub fn has_database(&self) -> bool {
        self.database().as_std_path().is_file()
    }
}

/// One profile listed in `profiles.ini`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    /// The profile's display name, e.g. `default`.
    pub name: String,
    /// Absolute path to the profile directory.
    pub path: Utf8PathBuf,
    /// Whether `profiles.ini` marks this as the default.
    pub is_default: bool,
    /// The data directory this profile declares, if it declares one.
    pub data_dir: Option<Utf8PathBuf>,
}

/// Where Zotero keeps `profiles.ini` on this platform.
///
/// Zotero is a Firefox-derived application and follows Mozilla's convention,
/// which differs per platform rather than following the data directory.
fn profiles_root() -> Option<Utf8PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(Utf8PathBuf::from(appdata).join("Zotero").join("Zotero"))
    }

    #[cfg(target_os = "macos")]
    {
        Some(
            home_dir()?
                .join("Library")
                .join("Application Support")
                .join("Zotero"),
        )
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Some(home_dir()?.join(".zotero").join("zotero"))
    }
}

/// The user's home directory as UTF-8.
fn home_dir() -> Option<Utf8PathBuf> {
    let raw = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| {
            // Windows before USERPROFILE is set, e.g. some service contexts.
            let mut joined = std::env::var_os("HOMEDRIVE")?;
            joined.push(std::env::var_os("HOMEPATH")?);
            Some(joined)
        })?;
    Utf8PathBuf::from_path_buf(std::path::PathBuf::from(raw)).ok()
}

/// The conventional data directory, used when nothing overrides it.
pub fn conventional() -> Option<Utf8PathBuf> {
    home_dir().map(|home| home.join("Zotero"))
}

/// Parse `profiles.ini`, resolving each profile's declared data directory.
///
/// Returns an empty list rather than an error when the file is absent: Zotero
/// simply may not be installed, which is a normal state and not a failure.
pub fn profiles() -> Vec<Profile> {
    let Some(root) = profiles_root() else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(root.join("profiles.ini").as_std_path()) else {
        return Vec::new();
    };
    parse_profiles_ini(&text, &root)
}

/// Parse the INI text. Separated from the filesystem so it can be tested.
///
/// Deliberately hand-rolled. The format is a handful of `Key=Value` lines under
/// `[Section]` headers, and every INI crate brings its own opinion about
/// escaping and duplicate keys — opinions that would be applied to a file we do
/// not own and cannot change.
fn parse_profiles_ini(text: &str, root: &Utf8Path) -> Vec<Profile> {
    let mut profiles = Vec::new();
    let mut name = String::new();
    let mut path: Option<String> = None;
    let mut is_relative = true;
    let mut is_default = false;
    let mut in_profile = false;

    let mut flush = |name: &str, path: &Option<String>, is_relative: bool, is_default: bool| {
        if let Some(raw) = path {
            let resolved = if is_relative {
                root.join(raw.replace('\\', "/"))
            } else {
                Utf8PathBuf::from(raw.replace('\\', "/"))
            };
            profiles.push(Profile {
                name: name.to_owned(),
                data_dir: read_data_dir_pref(&resolved),
                path: resolved,
                is_default,
            });
        }
    };

    for line in text.lines() {
        let line = line.trim();
        if let Some(section) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            if in_profile {
                flush(&name, &path, is_relative, is_default);
            }
            in_profile = section.starts_with("Profile");
            name = String::new();
            path = None;
            is_relative = true;
            is_default = false;
            continue;
        }
        if !in_profile {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "Name" => name = value.trim().to_owned(),
            "Path" => path = Some(value.trim().to_owned()),
            "IsRelative" => is_relative = value.trim() == "1",
            "Default" => is_default = value.trim() == "1",
            _ => {}
        }
    }
    if in_profile {
        flush(&name, &path, is_relative, is_default);
    }

    profiles
}

/// Read `extensions.zotero.dataDir` out of a profile's `prefs.js`.
fn read_data_dir_pref(profile_dir: &Utf8Path) -> Option<Utf8PathBuf> {
    let text = std::fs::read_to_string(profile_dir.join("prefs.js").as_std_path()).ok()?;
    extract_data_dir_pref(&text)
}

/// Extract the data directory from `prefs.js` text.
///
/// `prefs.js` is JavaScript, and the value is a JS string literal — on Windows
/// it is full of escaped backslashes (`"D:\\programs\\zotero"`). Reading the
/// literal without unescaping yields a path with doubled separators that does
/// not exist, and the failure looks like a missing library rather than a parsing
/// bug.
fn extract_data_dir_pref(text: &str) -> Option<Utf8PathBuf> {
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("user_pref(") else {
            continue;
        };
        let Some(rest) = rest.strip_prefix("\"extensions.zotero.dataDir\"") else {
            continue;
        };
        let rest = rest.trim_start().strip_prefix(',')?.trim_start();
        let literal = rest.strip_prefix('"')?;
        let end = find_unescaped_quote(literal)?;
        return Some(Utf8PathBuf::from(unescape_js(&literal[..end])));
    }
    None
}

/// Index of the first `"` not preceded by a backslash.
fn find_unescaped_quote(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some(i),
            _ => i += 1,
        }
    }
    None
}

/// Unescape the subset of JS string escapes that appear in a path.
fn unescape_js(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Resolve the data directory to use.
///
/// `configured` wins outright — it is the user telling us directly, and is the
/// escape hatch for any layout this module fails to work out.
pub fn resolve(configured: Option<&Utf8Path>) -> Option<DataDir> {
    if let Some(path) = configured {
        return Some(DataDir {
            path: path.to_owned(),
            origin: Origin::Configured,
        });
    }

    let found = profiles();
    // `Default=1` is what Zotero itself honours. Falling back to the first
    // profile listed would be wrong here: profiles.ini lists Profile1 before
    // Profile0 on a real machine, and the default is Profile0.
    let chosen = found
        .iter()
        .find(|p| p.is_default && p.data_dir.is_some())
        .or_else(|| found.iter().find(|p| p.data_dir.is_some()));

    if let Some(profile) = chosen {
        if let Some(dir) = &profile.data_dir {
            return Some(DataDir {
                path: dir.clone(),
                origin: Origin::ProfilePref,
            });
        }
    }

    conventional().map(|path| DataDir {
        path,
        origin: Origin::Convention,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verbatim shape of a real profiles.ini, including the ordering that makes
    // "take the first profile" the wrong rule: Profile1 is listed first, but
    // Profile0 carries Default=1.
    const REAL_INI: &str = "\
[Profile1]
Name=Work
IsRelative=1
Path=Profiles/dwsdidhv.Work

[Profile0]
Name=default
IsRelative=1
Path=Profiles/2fbrpca7.default
Default=1

[General]
StartWithLastProfile=1
Version=2
";

    #[test]
    fn parses_both_profiles_and_marks_the_default() {
        let root = Utf8PathBuf::from("/roaming/Zotero/Zotero");
        let profiles = parse_profiles_ini(REAL_INI, &root);

        assert_eq!(profiles.len(), 2, "the [General] section is not a profile");
        assert_eq!(profiles[0].name, "Work");
        assert!(!profiles[0].is_default);
        assert_eq!(profiles[1].name, "default");
        assert!(profiles[1].is_default, "Default=1 is on the second entry");
    }

    #[test]
    fn the_default_is_not_the_first_listed() {
        // The bug this guards against: a machine where taking profiles[0] finds
        // an empty library and reports "Zotero has no items".
        let root = Utf8PathBuf::from("/roaming/Zotero/Zotero");
        let profiles = parse_profiles_ini(REAL_INI, &root);
        let default = profiles.iter().find(|p| p.is_default).unwrap();
        assert_eq!(default.name, "default");
        assert_ne!(default.name, profiles[0].name);
    }

    #[test]
    fn relative_paths_resolve_against_the_profiles_root() {
        let root = Utf8PathBuf::from("/roaming/Zotero/Zotero");
        let profiles = parse_profiles_ini(REAL_INI, &root);
        assert_eq!(
            profiles[1].path,
            Utf8PathBuf::from("/roaming/Zotero/Zotero/Profiles/2fbrpca7.default")
        );
    }

    #[test]
    fn absolute_profile_paths_are_left_alone() {
        let ini = "[Profile0]\nName=abs\nIsRelative=0\nPath=/elsewhere/profile\nDefault=1\n";
        let profiles = parse_profiles_ini(ini, &Utf8PathBuf::from("/roaming"));
        assert_eq!(profiles[0].path, Utf8PathBuf::from("/elsewhere/profile"));
    }

    #[test]
    fn reads_a_windows_data_dir_with_escaped_separators() {
        // Exactly as it appears in a real prefs.js. Reading the literal without
        // unescaping gives `D:\\programs\\zotero`, which does not exist.
        let prefs = r#"user_pref("extensions.zotero.dataDir", "D:\\programs\\zotero");"#;
        assert_eq!(
            extract_data_dir_pref(prefs),
            Some(Utf8PathBuf::from(r"D:\programs\zotero"))
        );
    }

    #[test]
    fn reads_a_posix_data_dir() {
        let prefs = r#"user_pref("extensions.zotero.dataDir", "/mnt/library/zotero");"#;
        assert_eq!(
            extract_data_dir_pref(prefs),
            Some(Utf8PathBuf::from("/mnt/library/zotero"))
        );
    }

    #[test]
    fn ignores_other_preferences() {
        let prefs = "\
user_pref(\"extensions.zotero.firstRun2\", false);
user_pref(\"extensions.zotero.dataDir\", \"/real/path\");
user_pref(\"extensions.zotero.sync.autoSync\", true);
";
        assert_eq!(
            extract_data_dir_pref(prefs),
            Some(Utf8PathBuf::from("/real/path"))
        );
    }

    #[test]
    fn absent_preference_is_not_an_error() {
        assert_eq!(extract_data_dir_pref("user_pref(\"other\", 1);"), None);
        assert_eq!(extract_data_dir_pref(""), None);
    }

    #[test]
    fn a_quote_inside_the_path_does_not_truncate_it() {
        // Legal on POSIX, and the naive `find('"')` gets it wrong.
        let prefs = r#"user_pref("extensions.zotero.dataDir", "/od\"d/zotero");"#;
        assert_eq!(
            extract_data_dir_pref(prefs),
            Some(Utf8PathBuf::from("/od\"d/zotero"))
        );
    }

    #[test]
    fn configured_path_overrides_discovery() {
        let configured = Utf8PathBuf::from("/explicit/choice");
        let resolved = resolve(Some(&configured)).unwrap();
        assert_eq!(resolved.path, configured);
        assert_eq!(resolved.origin, Origin::Configured);
    }

    #[test]
    fn database_sits_inside_the_data_directory() {
        let dir = DataDir {
            path: Utf8PathBuf::from("/data/zotero"),
            origin: Origin::Convention,
        };
        assert_eq!(
            dir.database(),
            Utf8PathBuf::from("/data/zotero/zotero.sqlite")
        );
    }
}
