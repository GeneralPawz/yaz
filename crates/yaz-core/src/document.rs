//! Reading and writing documents.
//!
//! The authoritative copy of a document being edited lives in the webview's
//! editor buffer, not here — putting IPC on the keystroke path would break the
//! latency budget in
//! [ADR-0015](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0015-performance-budgets.md).
//! This module owns durable state: loading, atomic saves, encoding detection,
//! and reconciling changes made outside the application.

use camino::Utf8PathBuf;

/// A document loaded from disk, with the state needed to detect an external
/// modification before overwriting it.
#[derive(Debug, Clone)]
pub struct Document {
    /// Absolute path on disk.
    pub path: Utf8PathBuf,
    /// Contents as text, always UTF-8 internally regardless of source encoding.
    pub text: String,
    /// Modification time observed at load, used to detect conflicting writes.
    pub loaded_mtime: Option<std::time::SystemTime>,
}

// TODO(phase-2): load, save_atomic, detect_encoding, reconcile_external_change.
