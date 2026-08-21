//! Errors from Zotero library access.
//!
//! Every variant carries a message key rather than English prose, for the reason
//! given in [ADR-0011]: Rust does not format user-facing text.
//!
//! These are deliberately specific. "Could not read your library" is true of all
//! of them and actionable for none — a user whose Zotero is simply closed needs
//! to hear something different from one whose Zotero is newer than this build.
//!
//! [ADR-0011]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0011-localisation.md

use camino::Utf8PathBuf;

/// Convenient result alias for this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors produced while reading a Zotero library.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// No `zotero.sqlite` at the resolved location.
    #[error("no Zotero library at {path}")]
    NoLibrary {
        /// Where one was looked for.
        path: Utf8PathBuf,
    },

    /// The library's schema version is outside the checked range.
    ///
    /// [ADR-0008] chose to disable the source here rather than read on and risk
    /// mis-parsing a library whose tables have moved.
    ///
    /// [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md
    #[error(
        "Zotero schema {found} is outside the supported range {supported_from}..={supported_to}"
    )]
    UnsupportedSchema {
        /// The version the library reported.
        found: i64,
        /// Lowest version this build understands.
        supported_from: i64,
        /// Highest version this build has been checked against.
        supported_to: i64,
    },

    /// The database uses a journal mode where the main file is not
    /// self-contained, so a copy of it alone would be a stale snapshot.
    #[error("unsupported journal mode {mode}: a copy of the database alone would be incomplete")]
    UnsupportedJournalMode {
        /// The mode reported by `PRAGMA journal_mode`.
        mode: String,
    },

    /// Zotero is not running, so no live source could be reached.
    #[error("Zotero is not running")]
    NotRunning,

    /// A live source answered, but not in a shape this build understands.
    #[error("unexpected response from {source_name}")]
    UnexpectedResponse {
        /// Which source misbehaved.
        source_name: &'static str,
    },

    /// Network failure talking to a local Zotero.
    #[error("could not reach Zotero")]
    Http {
        /// The underlying error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// Underlying database failure.
    #[error("Zotero database error")]
    Database {
        /// The underlying error.
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// Underlying I/O failure.
    #[error("i/o error at {path}")]
    Io {
        /// The path being operated on.
        path: Utf8PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },
}

impl Error {
    /// Message key for the explanation shown to the user.
    ///
    /// Note that several of these are not failures in any useful sense. Zotero
    /// being closed is the normal state for most writers most of the time, and
    /// the interface says so and falls back rather than showing an error.
    pub fn message_key(&self) -> &'static str {
        match self {
            Error::NoLibrary { .. } => "zotero-error-no-library",
            Error::UnsupportedSchema { .. } => "zotero-error-unsupported-schema",
            Error::UnsupportedJournalMode { .. } => "zotero-error-unsupported-journal",
            Error::NotRunning => "zotero-error-not-running",
            Error::UnexpectedResponse { .. } => "zotero-error-unexpected-response",
            Error::Http { .. } => "zotero-error-http",
            Error::Database { .. } => "zotero-error-database",
            Error::Io { .. } => "zotero-error-io",
        }
    }

    /// Whether this means "try a lower-priority source" rather than "stop".
    ///
    /// The distinction matters because [ADR-0008] degrades through four sources.
    /// A closed Zotero should fall through to the offline library silently; a
    /// corrupt database should not be papered over the same way.
    ///
    /// [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md
    pub fn is_source_unavailable(&self) -> bool {
        matches!(
            self,
            Error::NotRunning
                | Error::NoLibrary { .. }
                | Error::Http { .. }
                | Error::UnsupportedSchema { .. }
                | Error::UnsupportedJournalMode { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_zotero_falls_through_but_a_broken_database_does_not() {
        assert!(Error::NotRunning.is_source_unavailable());
        assert!(
            Error::NoLibrary {
                path: Utf8PathBuf::from("/nowhere")
            }
            .is_source_unavailable()
        );

        // A schema we do not understand disables that source and moves on,
        // which is ADR-0008's "say so rather than mis-parse".
        assert!(
            Error::UnsupportedSchema {
                found: 999,
                supported_from: 120,
                supported_to: 140
            }
            .is_source_unavailable()
        );

        // But a database that is present and supported and still failed is a
        // real problem, and hiding it behind a silent fallback would mean the
        // user never learns their library is damaged.
        assert!(
            !Error::Database {
                source: "corrupt".into()
            }
            .is_source_unavailable()
        );
    }

    #[test]
    fn every_variant_has_a_distinct_message_key() {
        let keys = [
            Error::NoLibrary {
                path: Utf8PathBuf::from("/x"),
            }
            .message_key(),
            Error::UnsupportedSchema {
                found: 1,
                supported_from: 2,
                supported_to: 3,
            }
            .message_key(),
            Error::UnsupportedJournalMode { mode: "wal".into() }.message_key(),
            Error::NotRunning.message_key(),
            Error::UnexpectedResponse {
                source_name: "local-api",
            }
            .message_key(),
            Error::Http { source: "x".into() }.message_key(),
            Error::Database { source: "x".into() }.message_key(),
            Error::Io {
                path: Utf8PathBuf::from("/x"),
                source: std::io::Error::other("x"),
            }
            .message_key(),
        ];
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len(), "message keys must not collide");
    }
}
