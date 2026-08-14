//! LaTeX and BibTeX parsing, and cross-file project indexing.
//!
//! # Division of labour with the editor
//!
//! Two parsers exist in this project and the split is deliberate.
//!
//! **Lezer, in the webview**, parses the buffer being edited. It runs on every
//! keystroke and drives highlighting and the visual-mode decorations, so it must
//! be incremental and must never cross the IPC boundary
//! ([ADR-0004](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0004-editor-core-codemirror-single-buffer.md)).
//!
//! **This crate**, in Rust, does the project-wide work that is too expensive for
//! the keystroke path: the cross-file label and reference index, the `\input`
//! graph, and `.bib` key resolution. Its results reach the editor asynchronously
//! as completion sources and diagnostics.

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod bib;
pub mod index;

// TODO(phase-4): tree-sitter-latex parsing, label/ref extraction, \input graph.
