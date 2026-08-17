//! What a project is: a root directory, an entry document, and build settings.

use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};

/// A yaz project — a directory on disk plus the metadata in `yaz.toml`.
///
/// A project is deliberately thin. It does not own the documents inside it; it
/// describes where they are and how they are built. Nothing about a project
/// requires yaz to have created it, so an existing LaTeX directory can simply be
/// opened.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Absolute path to the project root. All project-relative paths resolve
    /// against this, and the `fs:project` capability is bounded by it.
    pub root: Utf8PathBuf,

    /// The document passed to the compiler, relative to [`Project::root`].
    pub entry: Utf8PathBuf,

    /// Which compilation engine to use for this project.
    ///
    /// Persisted per project because journal templates frequently require a
    /// specific engine. See
    /// [ADR-0007](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md).
    #[serde(default)]
    pub engine: EngineChoice,

    /// The language the document is written in — distinct from the interface
    /// locale. Drives spellcheck, `babel`/`polyglossia`, and quotation marks.
    #[serde(default)]
    pub document_locale: Option<String>,
}

/// Which LaTeX engine a project compiles with.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum EngineChoice {
    /// Embedded Tectonic. The default: native on every architecture we ship and
    /// requires no system TeX installation.
    #[default]
    Tectonic,
    /// A detected system distribution, driven through `latexmk` where available.
    System {
        /// The engine binary to invoke, e.g. `pdflatex` or `lualatex`.
        engine: String,
    },
}

impl EngineChoice {
    /// Stable identifier: `tectonic`, or `system:<binary>`.
    ///
    /// A flat string rather than a nested table because `yaz.toml` is meant to
    /// be edited by hand, and `engine = "system:xelatex"` reads better than the
    /// two-line table a tagged enum would produce.
    pub fn to_id(&self) -> String {
        match self {
            EngineChoice::Tectonic => "tectonic".to_owned(),
            EngineChoice::System { engine } => format!("system:{engine}"),
        }
    }

    /// Parse an identifier produced by [`EngineChoice::to_id`].
    ///
    /// Returns `None` for anything unrecognised rather than guessing — a typo in
    /// a hand-edited `yaz.toml` should surface as "that engine is not
    /// available", not silently compile with something else.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "tectonic" => Some(EngineChoice::Tectonic),
            other => other
                .strip_prefix("system:")
                .filter(|binary| !binary.is_empty())
                .map(|binary| EngineChoice::System {
                    engine: binary.to_owned(),
                }),
        }
    }
}

impl Serialize for EngineChoice {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_id())
    }
}

impl<'de> Deserialize<'de> for EngineChoice {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let id = String::deserialize(deserializer)?;
        EngineChoice::from_id(&id)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown engine {id:?}")))
    }
}

/// The per-project settings file, `yaz.toml`.
///
/// Deliberately small and hand-editable. Absent means "use the defaults", not
/// "this is not a project" — an existing LaTeX directory opens without yaz
/// having to write anything into it first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectSettings {
    /// The document passed to the compiler, relative to the project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<Utf8PathBuf>,

    /// Which engine to compile with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<EngineChoice>,

    /// The language the document is written in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_locale: Option<String>,

    /// The pane arrangement, as the frontend serialises it.
    ///
    /// Stored opaquely on purpose. The layout tree is a interface concern —
    /// which views are open, in what splits, at what sizes — and giving the
    /// domain layer a parallel definition of it would mean two schemas to keep
    /// in step for no gain here. This crate's interest is only that it round
    /// trips.
    ///
    /// Per project rather than global: a thesis and a conference paper want
    /// different arrangements, and the engine choice already lives here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
}

impl ProjectSettings {
    /// The settings file name, at the project root.
    pub const FILE_NAME: &'static str = "yaz.toml";

    /// Load settings for a project root, or defaults when the file is absent.
    ///
    /// A malformed file is an error rather than a silent fallback to defaults:
    /// quietly ignoring a typo would compile the wrong thing and give the author
    /// no clue why their engine choice stopped taking effect.
    pub fn load(root: &camino::Utf8Path) -> crate::Result<Self> {
        let path = root.join(Self::FILE_NAME);
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(&path).map_err(|source| crate::Error::Io {
            path: path.clone(),
            source,
        })?;
        toml::from_str(&text).map_err(|error| crate::Error::Io {
            path: path.clone(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()),
        })
    }

    /// Write the settings back to the project root.
    pub fn save(&self, root: &camino::Utf8Path) -> crate::Result<()> {
        let path = root.join(Self::FILE_NAME);
        let text = toml::to_string_pretty(self).map_err(|error| crate::Error::Io {
            path: path.clone(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()),
        })?;
        std::fs::write(&path, text).map_err(|source| crate::Error::Io { path, source })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_ids_round_trip() {
        for choice in [
            EngineChoice::Tectonic,
            EngineChoice::System {
                engine: "xelatex".to_owned(),
            },
        ] {
            let id = choice.to_id();
            assert_eq!(EngineChoice::from_id(&id), Some(choice));
        }
    }

    #[test]
    fn unknown_engine_ids_are_rejected_not_guessed() {
        assert_eq!(EngineChoice::from_id("teqtonic"), None);
        assert_eq!(EngineChoice::from_id("system:"), None);
        assert_eq!(EngineChoice::from_id(""), None);
    }

    #[test]
    fn settings_round_trip_through_toml() {
        let settings = ProjectSettings {
            entry: Some(Utf8PathBuf::from("paper.tex")),
            engine: Some(EngineChoice::System {
                engine: "lualatex".to_owned(),
            }),
            document_locale: Some("de-DE".to_owned()),
            workspace: Some(r#"{"kind":"leaf","tabs":["editor"]}"#.to_owned()),
        };
        let text = toml::to_string_pretty(&settings).expect("serialises");
        // The flat form is what makes the file pleasant to hand-edit.
        assert!(text.contains(r#"engine = "system:lualatex""#), "{text}");
        let parsed: ProjectSettings = toml::from_str(&text).expect("parses");
        assert_eq!(parsed.engine, settings.engine);
        assert_eq!(parsed.entry, settings.entry);
        // Opaque to this layer, so the only requirement is that it survives.
        assert_eq!(parsed.workspace, settings.workspace);
    }

    #[test]
    fn a_project_without_a_stored_layout_still_loads() {
        // Every project that predates the workspace has no `workspace` key, and
        // must open rather than fail to parse.
        let text = "entry = \"main.tex\"\nengine = \"tectonic\"\n";
        let parsed: ProjectSettings = toml::from_str(text).expect("parses");
        assert_eq!(parsed.workspace, None);
    }

    #[test]
    fn absent_file_yields_defaults() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = camino::Utf8Path::from_path(dir.path()).expect("utf8 path");
        let settings = ProjectSettings::load(root).expect("loads");
        assert!(settings.engine.is_none());
        assert!(settings.entry.is_none());
    }

    #[test]
    fn malformed_file_is_an_error_not_a_silent_default() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = camino::Utf8Path::from_path(dir.path()).expect("utf8 path");
        std::fs::write(root.join(ProjectSettings::FILE_NAME), "engine = \"nope\"\n")
            .expect("write");
        assert!(ProjectSettings::load(root).is_err());
    }
}
