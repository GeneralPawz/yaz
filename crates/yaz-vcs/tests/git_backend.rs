//! The git backend, against a real repository.
//!
//! The unit tests in `src/git.rs` parse strings and would all pass against a
//! backend that never ran git successfully. These create a repository in a
//! temporary directory and drive it through the public interface.
//!
//! Skipped when git is absent, which is the condition this backend is offered
//! under anyway.

use camino::Utf8PathBuf;
use yaz_vcs::{ChangeKind, Error, VersionControl, git::Git};

/// A temporary project, or `None` when git is not installed.
fn project() -> Option<(tempfile::TempDir, Utf8PathBuf, Git)> {
    let backend = Git::new();
    if !backend.is_available() {
        eprintln!("git is not installed — skipping");
        return None;
    }
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(
        root.join("main.tex").as_std_path(),
        "\\documentclass{article}\n",
    )
    .unwrap();
    Some((dir, root, backend))
}

macro_rules! project_or_skip {
    () => {
        match project() {
            Some(parts) => parts,
            None => return,
        }
    };
}

#[test]
fn an_untracked_project_reports_itself_as_untracked() {
    let (_guard, root, backend) = project_or_skip!();
    let status = backend.status(&root).unwrap();
    assert!(!status.initialised);
    assert!(status.head.is_none());

    // And operations that need a repository say so rather than failing obscurely.
    assert!(matches!(
        backend.commit(&root, "anything"),
        Err(Error::NotInitialised)
    ));
    assert!(matches!(
        backend.history(&root, 10),
        Err(Error::NotInitialised)
    ));
}

#[test]
fn initialising_creates_a_repository_and_an_ignore_file() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();

    assert!(
        root.join(".git").as_std_path().is_dir(),
        "no .git was created"
    );
    let ignore = std::fs::read_to_string(root.join(".gitignore").as_std_path()).unwrap();
    // Compile output is rebuilt from source; recording it makes every version
    // carry a PDF nobody will read back.
    assert!(ignore.contains("build/"), "{ignore}");

    assert!(backend.status(&root).unwrap().initialised);
}

#[test]
fn an_existing_ignore_file_is_left_alone() {
    let (_guard, root, backend) = project_or_skip!();
    std::fs::write(root.join(".gitignore").as_std_path(), "mine\n").unwrap();
    backend.initialise(&root).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join(".gitignore").as_std_path()).unwrap(),
        "mine\n",
        "yaz overwrote the project's own ignore file"
    );
}

#[test]
fn initialising_twice_is_harmless() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    backend.initialise(&root).unwrap();
    assert!(backend.status(&root).unwrap().initialised);
}

#[test]
fn a_commit_records_a_version() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();

    let commit = backend
        .commit(&root, "First draft")
        .unwrap()
        .expect("there was something to record");
    assert_eq!(commit.summary, "First draft");
    assert!(!commit.id.is_empty());
    assert!(!commit.short_id.is_empty());
    assert!(commit.timestamp.starts_with("20"), "{}", commit.timestamp);

    let history = backend.history(&root, 10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, commit.id);

    let status = backend.status(&root).unwrap();
    assert!(!status.dirty, "everything was just recorded");
    assert_eq!(status.head.unwrap().id, commit.id);
}

#[test]
fn saving_an_unchanged_project_records_nothing() {
    // Ctrl+S with no edits must not manufacture an empty version, or the history
    // fills with entries that say nothing happened.
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    backend.commit(&root, "First draft").unwrap().unwrap();

    assert!(
        backend.commit(&root, "Nothing changed").unwrap().is_none(),
        "an empty commit was created"
    );
    assert_eq!(backend.history(&root, 10).unwrap().len(), 1);
}

#[test]
fn changes_are_reported_with_what_happened_to_them() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    backend.commit(&root, "First draft").unwrap().unwrap();

    std::fs::write(root.join("main.tex").as_std_path(), "edited\n").unwrap();
    std::fs::write(root.join("notes.tex").as_std_path(), "new file\n").unwrap();

    let changes = backend.changes(&root).unwrap();
    let modified = changes.iter().find(|c| c.path == "main.tex").unwrap();
    let added = changes.iter().find(|c| c.path == "notes.tex").unwrap();
    assert_eq!(modified.kind, ChangeKind::Modified);
    assert_eq!(added.kind, ChangeKind::Added);
}

#[test]
fn history_is_most_recent_first() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    backend.commit(&root, "First").unwrap().unwrap();
    std::fs::write(root.join("main.tex").as_std_path(), "second\n").unwrap();
    backend.commit(&root, "Second").unwrap().unwrap();

    let history = backend.history(&root, 10).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].summary, "Second");
    assert_eq!(history[1].summary, "First");
}

#[test]
fn restoring_puts_an_earlier_version_back() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    std::fs::write(root.join("main.tex").as_std_path(), "first\n").unwrap();
    let first = backend.commit(&root, "First").unwrap().unwrap();

    std::fs::write(root.join("main.tex").as_std_path(), "second\n").unwrap();
    backend.commit(&root, "Second").unwrap().unwrap();

    backend.restore(&root, &first.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex").as_std_path()).unwrap(),
        "first\n"
    );

    // And forward again: both versions are still in the history, so moving back
    // and forth is just another restore rather than an undo stack.
    let history = backend.history(&root, 10).unwrap();
    assert_eq!(history.len(), 2, "restoring must not rewrite history");
    let second = history.iter().find(|c| c.summary == "Second").unwrap();
    // The restore left the earlier content staged, so record it before moving on.
    backend.commit(&root, "Back to the first draft").unwrap();
    backend.restore(&root, &second.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex").as_std_path()).unwrap(),
        "second\n"
    );
}

#[test]
fn restoring_refuses_to_discard_unsaved_work() {
    // Uncommitted edits are the one thing here that exists nowhere else. A
    // restore that overwrote them would destroy the only copy.
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();
    let first = backend.commit(&root, "First").unwrap().unwrap();

    std::fs::write(root.join("main.tex").as_std_path(), "unsaved work\n").unwrap();

    assert!(
        matches!(
            backend.restore(&root, &first.id),
            Err(Error::WouldLoseChanges)
        ),
        "restoring overwrote uncommitted changes"
    );
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex").as_std_path()).unwrap(),
        "unsaved work\n",
        "the working tree was modified despite the refusal"
    );
}

#[test]
fn a_message_with_awkward_characters_survives_the_round_trip() {
    // Commit messages are user text, and a writer quoting a title will produce
    // quotes, newlines and pipes.
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();

    let awkward = "Quote \"the\" | table, 100% — see §3";
    let commit = backend.commit(&root, awkward).unwrap().unwrap();
    assert_eq!(commit.summary, awkward);
    assert_eq!(backend.history(&root, 1).unwrap()[0].summary, awkward);
}

/// Restoring must hand back exactly what was recorded, byte for byte.
///
/// Found by the restore test failing with `"first\r\n"` against `"first\n"`. On
/// Windows git defaults `core.autocrlf` to rewriting line endings on checkout,
/// so a restored file came back with CRLF, the editor then saved it with LF, and
/// the next version was a whole-file diff caused by nothing the author did.
#[test]
fn restoring_does_not_rewrite_line_endings() {
    let (_guard, root, backend) = project_or_skip!();
    backend.initialise(&root).unwrap();

    let content = "line one\nline two\nline three\n";
    std::fs::write(root.join("main.tex").as_std_path(), content).unwrap();
    let commit = backend.commit(&root, "Written with LF").unwrap().unwrap();

    std::fs::write(root.join("main.tex").as_std_path(), "replaced\n").unwrap();
    backend.commit(&root, "Replaced").unwrap().unwrap();

    backend.restore(&root, &commit.id).unwrap();
    let restored = std::fs::read(root.join("main.tex").as_std_path()).unwrap();
    assert_eq!(
        String::from_utf8(restored).unwrap(),
        content,
        "the restored file differs from what was recorded"
    );
}
