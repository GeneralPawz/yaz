//! Version control for a project.
//!
//! # Why an abstraction rather than "just use git"
//!
//! Most people writing a paper do not have git, do not want git, and should not
//! have to learn it to get their drafts back. But the people who *do* have it
//! already have branches, remotes, hooks and an identity configured, and a tool
//! that quietly kept its own parallel history beside `.git` would be worse than
//! useless to them.
//!
//! So there are two backends behind one interface: [`git`], which drives the
//! user's own `git` and leaves their repository theirs, and [`stub`], the
//! placeholder for a built-in history for everyone else.
//!
//! # What this is not
//!
//! Not a git client. There is no branching, no merging, no remotes and no
//! conflict resolution here, and adding them would be building a worse
//! alternative to tools that already exist. This records versions of a document
//! and puts them back, which is the part a writer actually wants.
//!
//! See [ADR-0005](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0005-extensibility-tiers.md)
//! — version history is listed there as a core plugin, and this is the core
//! capability it will be written against.

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod git;
pub mod message;
pub mod stub;

use camino::Utf8Path;
use serde::{Deserialize, Serialize};

pub use message::{ChangeSummary, Descriptive, MessageWriter};

/// Convenient result alias.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors from version control.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The backend is not installed on this machine.
    #[error("{backend} is not available on this machine")]
    Unavailable {
        /// Which backend was asked for.
        backend: &'static str,
    },

    /// The project is not under version control yet.
    #[error("this project is not under version control")]
    NotInitialised,

    /// The working tree has changes that restoring would destroy.
    #[error("there are unsaved changes that restoring would overwrite")]
    WouldLoseChanges,

    /// The backend exists but has no implementation yet.
    #[error("{backend} is not implemented yet")]
    NotImplemented {
        /// Which backend.
        backend: &'static str,
    },

    /// The underlying tool failed.
    #[error("{tool} failed: {detail}")]
    Tool {
        /// The program that failed.
        tool: &'static str,
        /// Its own explanation, for a log or a disclosure triangle.
        detail: String,
    },

    /// Underlying I/O failure.
    #[error("i/o error")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// Message key for the explanation shown to the user.
    pub fn message_key(&self) -> &'static str {
        match self {
            Error::Unavailable { .. } => "vcs-error-unavailable",
            Error::NotInitialised => "vcs-error-not-initialised",
            Error::WouldLoseChanges => "vcs-error-would-lose-changes",
            Error::NotImplemented { .. } => "vcs-error-not-implemented",
            Error::Tool { .. } => "vcs-error-tool",
            Error::Io(_) => "vcs-error-io",
        }
    }
}

/// One recorded version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    /// Full identifier.
    pub id: String,
    /// Short form, for display.
    pub short_id: String,
    /// The first line of the message.
    pub summary: String,
    /// Who recorded it.
    pub author: String,
    /// When, as ISO-8601. A string because the backend already formats it and
    /// re-parsing it here would add a date dependency to gain nothing.
    pub timestamp: String,
}

/// What changed about one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    /// New since the last version.
    Added,
    /// Present before and since edited.
    Modified,
    /// Gone since the last version.
    Deleted,
    /// Renamed, or something this does not distinguish.
    Other,
}

/// A file that differs from the last recorded version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Path relative to the project root.
    pub path: String,
    /// How it changed.
    pub kind: ChangeKind,
}

/// The state of a project's history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Whether this project has a history at all.
    pub initialised: bool,
    /// Whether anything differs from the last recorded version.
    pub dirty: bool,
    /// The most recent version, when there is one.
    pub head: Option<Commit>,
}

/// A project's history.
pub trait VersionControl: Send + Sync {
    /// Stable identifier, e.g. `git`.
    fn id(&self) -> &'static str;

    /// Whether this backend can be used on this machine.
    fn is_available(&self) -> bool;

    /// Whether a project already has a history, and whether it is current.
    fn status(&self, root: &Utf8Path) -> Result<Status>;

    /// Begin tracking a project.
    fn initialise(&self, root: &Utf8Path) -> Result<()>;

    /// Files differing from the last recorded version.
    fn changes(&self, root: &Utf8Path) -> Result<Vec<FileChange>>;

    /// Record a version.
    ///
    /// Returns `None` when there was nothing to record, which is the common case
    /// on save: a save with no edits should not manufacture an empty version.
    fn commit(&self, root: &Utf8Path, message: &str) -> Result<Option<Commit>>;

    /// Recorded versions, most recent first.
    fn history(&self, root: &Utf8Path, limit: usize) -> Result<Vec<Commit>>;

    /// Put the project back to a recorded version.
    ///
    /// Refuses when the working tree has uncommitted changes, rather than
    /// overwriting work that was never recorded and cannot be recovered.
    fn restore(&self, root: &Utf8Path, commit: &str) -> Result<()>;
}

/// Which backend a project uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendKind {
    /// The user's own git.
    #[default]
    Git,
    /// yaz's built-in history, for machines without git.
    Builtin,
}

impl BackendKind {
    /// Stable identifier used in settings and across the IPC boundary.
    pub fn id(&self) -> &'static str {
        match self {
            BackendKind::Git => "git",
            BackendKind::Builtin => "builtin",
        }
    }

    /// Parse an identifier back.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "git" => Some(BackendKind::Git),
            "builtin" => Some(BackendKind::Builtin),
            _ => None,
        }
    }

    /// Message key naming this backend.
    pub fn label_key(&self) -> &'static str {
        match self {
            BackendKind::Git => "vcs-backend-git",
            BackendKind::Builtin => "vcs-backend-builtin",
        }
    }
}

/// Build a backend.
pub fn backend(kind: BackendKind) -> Box<dyn VersionControl> {
    match kind {
        BackendKind::Git => Box::new(git::Git::new()),
        BackendKind::Builtin => Box::new(stub::Builtin::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_ids_round_trip() {
        for kind in [BackendKind::Git, BackendKind::Builtin] {
            assert_eq!(BackendKind::from_id(kind.id()), Some(kind));
        }
        assert_eq!(BackendKind::from_id("mercurial"), None);
        assert_eq!(BackendKind::from_id(""), None);
    }

    #[test]
    fn every_error_has_its_own_message_key() {
        let keys = [
            Error::Unavailable { backend: "git" }.message_key(),
            Error::NotInitialised.message_key(),
            Error::WouldLoseChanges.message_key(),
            Error::NotImplemented { backend: "builtin" }.message_key(),
            Error::Tool {
                tool: "git",
                detail: String::new(),
            }
            .message_key(),
            Error::Io(std::io::Error::other("x")).message_key(),
        ];
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len(), "message keys must not collide");
    }
}
