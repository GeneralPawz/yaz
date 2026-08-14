//! Obsidian vault reading and Markdown to LaTeX translation.
//!
//! A vault is a folder of Markdown files, so this crate reads one directly from
//! disk. **No companion Obsidian plugin is required and Obsidian need not be
//! running** — which also means this works with any Markdown vault at all, not
//! only Obsidian's.
//!
//! The vault is **read-only by default**. A user's vault is often years of work
//! and we are not going to be the tool that mangles it.
//!
//! Translation is driven by a mapping the user can edit, because vault
//! conventions vary enormously and any fixed mapping would be wrong for most
//! people. Constructs we cannot map are passed through with a marker rather than
//! dropped.
//!
//! See [ADR-0009](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0009-obsidian-integration.md).

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod mapping;

use camino::Utf8PathBuf;

/// A Markdown vault on disk.
#[derive(Debug, Clone)]
pub struct Vault {
    /// Absolute path to the vault root.
    pub root: Utf8PathBuf,
}

// TODO(phase-5): note indexing, wikilink resolution, the Markdown → LaTeX
// writer, asset copying, and provenance tracking for re-import diffs.
