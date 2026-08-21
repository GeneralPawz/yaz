//! Turning a set of changes into a commit message.
//!
//! # Why this is a seam and not a function
//!
//! The intent is to have a small model write these eventually — "tightened the
//! argument in the methods section" is worth more than "edited methods.tex".
//! That is not built, and building the interface for it later would mean
//! changing every caller once the shape turned out to be wrong.
//!
//! So the shape is fixed now, by the deterministic writer below, and the seam it
//! has to satisfy is visible in [`MessageWriter`]:
//!
//! - It gets a [`ChangeSummary`], **not** a diff and not the repository. A model
//!   should be handed what it needs and nothing else, and a writer that could
//!   read arbitrary files would be one more thing to reason about when the
//!   writer becomes a network call.
//! - It returns a `String` and cannot fail. A message generator that can fail
//!   makes saving fail, and a save must never depend on a model answering.
//!   A future network-backed writer falls back to the deterministic one rather
//!   than propagating an error.
//! - It is synchronous. When an asynchronous writer arrives, it belongs behind a
//!   queue that amends the message afterwards, not on the path between pressing
//!   save and the version being recorded.
//!
//! # A message the user wrote always wins
//!
//! Generation only ever fills in a message that was not supplied. Nothing here
//! is consulted when somebody has said what they meant.

use crate::{ChangeKind, FileChange};

/// What changed, as the writer sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeSummary {
    /// Files that differ from the last recorded version.
    pub files: Vec<FileChange>,
}

impl ChangeSummary {
    /// Build a summary from a change list.
    pub fn new(files: Vec<FileChange>) -> Self {
        Self { files }
    }

    /// Whether there is anything to describe.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }
}

/// Writes a commit message for a set of changes.
///
/// See the module docs for the constraints an implementation must satisfy —
/// they exist so that a model-backed writer can be added without touching
/// callers.
pub trait MessageWriter: Send + Sync {
    /// Describe these changes. Never fails; see the module docs.
    fn write(&self, summary: &ChangeSummary) -> String;
}

/// The built-in writer: says what changed, without pretending to know why.
///
/// Deliberately plain. "Edited two files" is honest and forgettable; a generated
/// sentence that guesses at intent and gets it wrong is worse than either,
/// because it reads like a record of what the author meant.
#[derive(Debug, Clone, Copy, Default)]
pub struct Descriptive;

impl MessageWriter for Descriptive {
    fn write(&self, summary: &ChangeSummary) -> String {
        if summary.files.is_empty() {
            return "No changes".to_owned();
        }

        // One file is the overwhelmingly common case on save, and naming it is
        // far more useful than a count.
        if let [only] = summary.files.as_slice() {
            return format!("{} {}", verb(only.kind), only.path);
        }

        let added = summary
            .files
            .iter()
            .filter(|f| f.kind == ChangeKind::Added)
            .count();
        let deleted = summary
            .files
            .iter()
            .filter(|f| f.kind == ChangeKind::Deleted)
            .count();
        let changed = summary.files.len() - added - deleted;

        let mut parts = Vec::new();
        if changed > 0 {
            parts.push(format!("edited {changed}"));
        }
        if added > 0 {
            parts.push(format!("added {added}"));
        }
        if deleted > 0 {
            parts.push(format!("removed {deleted}"));
        }

        let files = if summary.files.len() == 1 {
            "file"
        } else {
            "files"
        };
        format!("Update {files}: {}", parts.join(", "))
    }
}

/// The verb for a single-file change.
fn verb(kind: ChangeKind) -> &'static str {
    match kind {
        ChangeKind::Added => "Add",
        ChangeKind::Deleted => "Delete",
        ChangeKind::Modified | ChangeKind::Other => "Update",
    }
}

/// The message to record, preferring what the author actually wrote.
///
/// The one place the precedence lives, so a future writer cannot accidentally
/// take priority over a person.
pub fn resolve(
    explicit: Option<&str>,
    writer: &dyn MessageWriter,
    summary: &ChangeSummary,
) -> String {
    match explicit
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        Some(message) => message.to_owned(),
        None => writer.write(summary),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(path: &str, kind: ChangeKind) -> FileChange {
        FileChange {
            path: path.to_owned(),
            kind,
        }
    }

    #[test]
    fn a_single_file_is_named_rather_than_counted() {
        let summary = ChangeSummary::new(vec![change("main.tex", ChangeKind::Modified)]);
        assert_eq!(Descriptive.write(&summary), "Update main.tex");
    }

    #[test]
    fn the_verb_matches_what_happened() {
        assert_eq!(
            Descriptive.write(&ChangeSummary::new(vec![change(
                "new.tex",
                ChangeKind::Added
            )])),
            "Add new.tex"
        );
        assert_eq!(
            Descriptive.write(&ChangeSummary::new(vec![change(
                "old.tex",
                ChangeKind::Deleted
            )])),
            "Delete old.tex"
        );
    }

    #[test]
    fn several_files_are_summarised_by_kind() {
        let summary = ChangeSummary::new(vec![
            change("a.tex", ChangeKind::Modified),
            change("b.tex", ChangeKind::Modified),
            change("c.tex", ChangeKind::Added),
            change("d.tex", ChangeKind::Deleted),
        ]);
        assert_eq!(
            Descriptive.write(&summary),
            "Update files: edited 2, added 1, removed 1"
        );
    }

    #[test]
    fn an_authors_own_message_always_wins() {
        // The point of the precedence: a generated message must never quietly
        // replace what somebody wrote.
        let summary = ChangeSummary::new(vec![change("main.tex", ChangeKind::Modified)]);
        assert_eq!(
            resolve(
                Some("Tighten the argument in section 3"),
                &Descriptive,
                &summary
            ),
            "Tighten the argument in section 3"
        );
    }

    #[test]
    fn a_blank_message_falls_back_to_the_writer() {
        // An empty commit box is "you decide", not "record an empty message".
        let summary = ChangeSummary::new(vec![change("main.tex", ChangeKind::Modified)]);
        for blank in [Some(""), Some("   "), Some("\n"), None] {
            assert_eq!(resolve(blank, &Descriptive, &summary), "Update main.tex");
        }
    }

    #[test]
    fn a_writer_that_wanted_to_fail_cannot() {
        // Encoded as a type, not a convention: `write` returns a String. A
        // future model-backed writer must fall back rather than make saving
        // depend on an answer.
        struct Unhelpful;
        impl MessageWriter for Unhelpful {
            fn write(&self, summary: &ChangeSummary) -> String {
                // Exactly what a network-backed writer should do when it cannot
                // answer: defer to the deterministic one.
                Descriptive.write(summary)
            }
        }
        let summary = ChangeSummary::new(vec![change("main.tex", ChangeKind::Modified)]);
        assert_eq!(Unhelpful.write(&summary), "Update main.tex");
    }

    #[test]
    fn no_changes_still_produces_something_recordable() {
        assert_eq!(
            Descriptive.write(&ChangeSummary::new(Vec::new())),
            "No changes"
        );
    }
}
