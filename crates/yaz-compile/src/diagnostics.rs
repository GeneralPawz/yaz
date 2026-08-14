//! Parsing TeX logs into structured, source-mapped diagnostics.
//!
//! This is engine-independent. TeX's log format, for all its faults, does not
//! vary meaningfully between engines, so parsing it once is correct and parsing
//! it per engine would be duplication.

use camino::Utf8PathBuf;

/// How serious a diagnostic is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Compilation failed or produced a broken document.
    Error,
    /// Something is wrong but a PDF was still produced.
    Warning,
    /// Informational, e.g. an overfull box.
    Info,
}

/// A single diagnostic, mapped back onto a source location where possible.
#[derive(Debug, Clone)]
pub struct Diagnostic {
    /// Severity.
    pub severity: Severity,
    /// Stable message key for localised rendering, with the raw TeX text kept
    /// in [`Diagnostic::raw`] since we cannot translate every engine message.
    pub message_key: Option<String>,
    /// The engine's own message text, always retained.
    pub raw: String,
    /// Source file, when the log attributes one.
    pub file: Option<Utf8PathBuf>,
    /// 1-based line number, when the log attributes one.
    pub line: Option<u32>,
}

// TODO(phase-2): the log parser itself, plus file-stack tracking so that
// diagnostics inside \input'd files are attributed correctly.
