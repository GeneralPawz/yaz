//! BibTeX and BibLaTeX parsing and key resolution.
//!
//! The project `.bib` is the compile-time source of truth for citations, always.
//! Zotero is a source that populates it, never a build dependency — a project
//! must compile on a co-author's machine that has no Zotero. See
//! [ADR-0008](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md).

/// A bibliography entry as it appears in a `.bib` file.
#[derive(Debug, Clone)]
pub struct BibEntry {
    /// The citation key, as used in `\cite{}`.
    pub key: String,
    /// The entry type, e.g. `article`, `inproceedings`.
    pub entry_type: String,
    /// Fields, in source order.
    pub fields: Vec<(String, String)>,
}

// TODO(phase-5): parser, writer, deduplication, key hygiene checks.
