//! Cross-file project index: labels, references, and the `\input` graph.
//!
//! Indexing is incremental and runs off the main thread. A full re-index of a
//! large project must not block editing — see the budgets in
//! [ADR-0015](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0015-performance-budgets.md).

use camino::Utf8PathBuf;

/// A `\label{}` definition found in the project.
#[derive(Debug, Clone)]
pub struct Label {
    /// The label name.
    pub name: String,
    /// File the label is defined in.
    pub file: Utf8PathBuf,
    /// Byte offset of the definition within that file.
    pub offset: usize,
}

/// The project-wide index, rebuilt incrementally as files change.
#[derive(Debug, Default)]
pub struct ProjectIndex {
    /// Every label defined anywhere in the project.
    pub labels: Vec<Label>,
}

// TODO(phase-4): incremental rebuild, \input graph, unresolved-reference diagnostics.
