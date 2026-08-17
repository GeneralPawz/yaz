//! The built-in history, for machines without git.
//!
//! # Deliberately not implemented
//!
//! Every operation returns [`Error::NotImplemented`]. That is the point: the
//! shape is fixed and the interface is exercised, so the day this is written it
//! slots in behind callers that already exist — and until then the interface
//! reports honestly rather than appearing to work.
//!
//! The alternative, a backend that silently does nothing, would be worse than
//! having none: a writer would switch version control on, see no error, and
//! discover months later that nothing was ever recorded.
//!
//! When it is built, the likely shape is content-addressed snapshots of the
//! project's text files under `.yaz/history`, since the documents are small and
//! the hard parts of a real VCS — merging, remotes, concurrent writers — are all
//! out of scope.

use camino::Utf8Path;

use crate::{Commit, Error, FileChange, Result, Status, VersionControl};

/// yaz's own history. Not implemented yet.
#[derive(Debug, Clone, Copy, Default)]
pub struct Builtin;

impl Builtin {
    /// A built-in backend.
    pub fn new() -> Self {
        Self
    }
}

/// The one error every operation returns, so the reason is written once.
fn pending<T>() -> Result<T> {
    Err(Error::NotImplemented { backend: "builtin" })
}

impl VersionControl for Builtin {
    fn id(&self) -> &'static str {
        "builtin"
    }

    /// Always false, so it is never selected automatically.
    ///
    /// A user can still choose it in settings and will be told plainly that it
    /// does not work yet, which is more useful than hiding that the option is
    /// planned.
    fn is_available(&self) -> bool {
        false
    }

    fn status(&self, _root: &Utf8Path) -> Result<Status> {
        // The one operation that answers rather than failing: the interface asks
        // for status before anything else, and an error here would surface as a
        // failure on every project open rather than as "not set up".
        Ok(Status {
            initialised: false,
            dirty: false,
            head: None,
        })
    }

    fn initialise(&self, _root: &Utf8Path) -> Result<()> {
        pending()
    }

    fn changes(&self, _root: &Utf8Path) -> Result<Vec<FileChange>> {
        pending()
    }

    fn commit(&self, _root: &Utf8Path, _message: &str) -> Result<Option<Commit>> {
        pending()
    }

    fn history(&self, _root: &Utf8Path, _limit: usize) -> Result<Vec<Commit>> {
        pending()
    }

    fn restore(&self, _root: &Utf8Path, _commit: &str) -> Result<()> {
        pending()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_reports_that_it_does_not_work_rather_than_doing_nothing() {
        // A backend that silently succeeded would let somebody write for months
        // believing their work was being recorded.
        let backend = Builtin::new();
        let root = Utf8Path::new("/somewhere");
        assert!(matches!(
            backend.initialise(root),
            Err(Error::NotImplemented { .. })
        ));
        assert!(matches!(
            backend.commit(root, "anything"),
            Err(Error::NotImplemented { .. })
        ));
        assert!(matches!(
            backend.history(root, 10),
            Err(Error::NotImplemented { .. })
        ));
    }

    #[test]
    fn status_answers_so_opening_a_project_does_not_fail() {
        let status = Builtin::new().status(Utf8Path::new("/somewhere")).unwrap();
        assert!(!status.initialised);
    }

    #[test]
    fn it_is_never_selected_automatically() {
        assert!(!Builtin::new().is_available());
    }
}
