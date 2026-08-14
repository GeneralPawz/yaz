//! The engine abstraction.

use camino::Utf8PathBuf;
use yaz_core::project::Project;

/// Outcome of a compilation attempt.
#[derive(Debug)]
pub struct CompileOutput {
    /// The produced PDF, if compilation reached that point.
    pub pdf: Option<Utf8PathBuf>,
    /// The SyncTeX database, for forward and inverse search.
    pub synctex: Option<Utf8PathBuf>,
    /// Structured diagnostics parsed from the engine log.
    pub diagnostics: Vec<crate::diagnostics::Diagnostic>,
    /// Whether a usable PDF was produced. LaTeX frequently emits errors and a
    /// PDF simultaneously, so this is not the inverse of "has errors".
    pub succeeded: bool,
}

/// A LaTeX compilation backend.
///
/// Implementors are responsible only for running the typesetter. Log parsing,
/// diagnostic mapping, and artefact placement are shared and must not be
/// duplicated per engine.
pub trait CompileEngine: Send + Sync {
    /// Stable identifier, e.g. `tectonic` or `system:pdflatex`.
    fn id(&self) -> &str;

    /// Whether this engine is usable on this machine right now.
    ///
    /// A system engine reports `false` when the distribution is absent, which is
    /// what lets the UI say precisely that instead of surfacing a confusing
    /// compile failure.
    fn is_available(&self) -> bool;

    /// Compile the project's entry document.
    fn compile(&self, project: &Project) -> yaz_core::Result<CompileOutput>;
}

// TODO(phase-2): TectonicEngine (embedded), SystemEngine (latexmk-driven),
// engine detection at startup, shell-escape opt-in gate.
