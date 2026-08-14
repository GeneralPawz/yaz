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
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
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
