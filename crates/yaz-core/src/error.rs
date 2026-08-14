//! Error types for the core domain layer.
//!
//! Every user-facing variant carries a stable message key rather than English
//! prose. Rust does not format user-facing text; the frontend resolves the key
//! against the active locale. See
//! [ADR-0011](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0011-localisation.md).

use camino::Utf8PathBuf;

/// Convenient result alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors produced by the core domain layer.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// A path that was expected to exist does not.
    #[error("path not found: {path}")]
    NotFound {
        /// The path that was looked up.
        path: Utf8PathBuf,
    },

    /// A path exists but lies outside the boundary the caller is allowed to touch.
    ///
    /// Produced after canonicalisation, so this covers `..` traversal and
    /// symlink escapes as well as plainly out-of-bounds paths.
    #[error("path {path} is outside the permitted root {root}")]
    OutsideRoot {
        /// The offending path, canonicalised.
        path: Utf8PathBuf,
        /// The root it was required to be within.
        root: Utf8PathBuf,
    },

    /// A file's contents are not valid UTF-8 and no encoding could be detected.
    #[error("could not decode {path} as text")]
    Undecodable {
        /// The file that could not be decoded.
        path: Utf8PathBuf,
    },

    /// The file changed on disk since it was read, and writing would lose data.
    #[error("{path} was modified externally")]
    ConflictingWrite {
        /// The file whose on-disk state diverged.
        path: Utf8PathBuf,
    },

    /// Underlying I/O failure.
    #[error("i/o error at {path}")]
    Io {
        /// The path being operated on when the failure occurred.
        path: Utf8PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
}

impl Error {
    /// The stable message key for this error, for localised rendering.
    ///
    /// Keys are part of the message catalogue contract and must not be changed
    /// without updating `locales/`. They are kebab-case with no dots or colons,
    /// because Fluent identifiers permit neither.
    pub fn message_key(&self) -> &'static str {
        match self {
            Error::NotFound { .. } => "error-fs-not-found",
            Error::OutsideRoot { .. } => "error-fs-outside-root",
            Error::Undecodable { .. } => "error-fs-undecodable",
            Error::ConflictingWrite { .. } => "error-fs-conflicting-write",
            Error::Io { .. } => "error-fs-io",
        }
    }
}
