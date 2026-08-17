//! Version control through the user's own `git`.
//!
//! # Why the command-line git and not a library
//!
//! Because the repository is the user's, not ours. Driving `git` means their
//! config, their hooks, their credential helper, their identity and their
//! `.gitignore` all apply, and anything they do outside yaz — a branch, a
//! rebase, a push — is not something yaz has to have anticipated. A linked
//! library would give us a repository that only yaz understands the same way,
//! for a feature whose entire value is that it is the ordinary one.
//!
//! The cost is that `git` must be installed, which is exactly the condition this
//! backend is offered under.
//!
//! # This is not a git client
//!
//! No branching, no merging, no remotes. Recording a version and putting one
//! back is the part a writer wants; the rest already has better tools.

use camino::Utf8Path;
use std::process::Command;

use crate::{ChangeKind, Commit, Error, FileChange, Result, Status, VersionControl};

/// Version control backed by `git`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Git;

impl Git {
    /// A git backend.
    pub fn new() -> Self {
        Self
    }
}

/// Stop Windows opening a console window for a child process.
///
/// yaz is a GUI binary, so spawning a console application makes Windows show a
/// console for it. Committing on every save would otherwise flash a black
/// window across the screen each time the author pressed Ctrl+S.
fn suppress_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// `CREATE_NO_WINDOW`, from the Win32 process creation flags.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// Run git in a project and return its stdout.
fn run(root: &Utf8Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command
        .current_dir(root.as_std_path())
        .args(args)
        .stdin(std::process::Stdio::null());
    suppress_console(&mut command);

    let output = command.output()?;
    if !output.status.success() {
        return Err(Error::Tool {
            tool: "git",
            detail: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Whether `git` is on this machine, answered once per process.
///
/// Cached for the same reason engine detection is: each probe is a process
/// start, and on Windows-on-ARM that is slow enough to be felt if it happens
/// per keystroke-triggered save.
fn git_exists() -> bool {
    use std::sync::OnceLock;
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let mut command = Command::new("git");
        command
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null());
        suppress_console(&mut command);
        command.status().map(|s| s.success()).unwrap_or(false)
    })
}

/// The `.gitignore` written for a new project.
///
/// Compile output is regenerated from the source on every build, so recording it
/// makes every version a few hundred kilobytes of PDF that nobody will ever read
/// back. Written only when the project has no `.gitignore` of its own.
const DEFAULT_IGNORE: &str = "\
# Written by yaz when version control was switched on.
# Compile output is rebuilt from the source, so it is not worth recording.
build/
*.aux
*.log
*.out
*.synctex.gz
*.toc
*.fls
*.fdb_latexmk
";

impl VersionControl for Git {
    fn id(&self) -> &'static str {
        "git"
    }

    fn is_available(&self) -> bool {
        git_exists()
    }

    fn status(&self, root: &Utf8Path) -> Result<Status> {
        if !root.join(".git").as_std_path().exists() {
            return Ok(Status {
                initialised: false,
                dirty: false,
                head: None,
            });
        }
        if !git_exists() {
            return Err(Error::Unavailable { backend: "git" });
        }

        let dirty = !run(root, &["status", "--porcelain"])?.trim().is_empty();
        // A repository with no commits yet has no HEAD, and asking for one is an
        // error rather than an empty answer.
        let head = self.history(root, 1)?.into_iter().next();

        Ok(Status {
            initialised: true,
            dirty,
            head,
        })
    }

    fn initialise(&self, root: &Utf8Path) -> Result<()> {
        if !git_exists() {
            return Err(Error::Unavailable { backend: "git" });
        }
        if root.join(".git").as_std_path().exists() {
            return Ok(());
        }

        run(root, &["init"])?;

        // An identity is required to commit at all, and a writer who has never
        // used git has none. A repository-local fallback is set only when
        // nothing is configured, so a real identity is never overwritten.
        if run(root, &["config", "user.email"])
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            run(root, &["config", "user.email", "yaz@localhost"])?;
            run(root, &["config", "user.name", "yaz"])?;
        }

        // Keep file contents byte-exact. On Windows git defaults to rewriting
        // line endings on checkout, so restoring a version would hand back a
        // file with CRLF that the editor then saves with LF — and the next
        // version would be a whole-file diff caused by nothing the author did.
        // Set locally, so it changes only repositories yaz creates.
        run(root, &["config", "core.autocrlf", "false"])?;

        let ignore = root.join(".gitignore");
        if !ignore.as_std_path().exists() {
            std::fs::write(ignore.as_std_path(), DEFAULT_IGNORE)?;
        }
        Ok(())
    }

    fn changes(&self, root: &Utf8Path) -> Result<Vec<FileChange>> {
        if !root.join(".git").as_std_path().exists() {
            return Err(Error::NotInitialised);
        }
        let output = run(root, &["status", "--porcelain=v1", "--untracked-files=all"])?;
        Ok(output.lines().filter_map(parse_status_line).collect())
    }

    fn commit(&self, root: &Utf8Path, message: &str) -> Result<Option<Commit>> {
        if !root.join(".git").as_std_path().exists() {
            return Err(Error::NotInitialised);
        }

        run(root, &["add", "--all"])?;
        // Nothing staged means nothing changed. Saving an unmodified document
        // should not manufacture an empty version, so this is a normal outcome
        // rather than an error.
        if run(root, &["diff", "--cached", "--name-only"])?
            .trim()
            .is_empty()
        {
            return Ok(None);
        }

        run(root, &["commit", "--message", message])?;
        Ok(self.history(root, 1)?.into_iter().next())
    }

    fn history(&self, root: &Utf8Path, limit: usize) -> Result<Vec<Commit>> {
        if !root.join(".git").as_std_path().exists() {
            return Err(Error::NotInitialised);
        }

        // Unit separators between fields and record separators between commits:
        // a message can contain anything, including whatever delimiter looked
        // safe, and these two bytes cannot appear in one.
        let format = format!("--pretty=format:%H{UNIT}%h{UNIT}%an{UNIT}%aI{UNIT}%s{RECORD}");
        let output = match run(root, &["log", &format, &format!("--max-count={limit}")]) {
            Ok(output) => output,
            // A repository with no commits has no HEAD to log; that is an empty
            // history, not a failure.
            Err(Error::Tool { .. }) => return Ok(Vec::new()),
            Err(other) => return Err(other),
        };

        Ok(output
            .split(RECORD)
            .filter(|record| !record.trim().is_empty())
            .filter_map(parse_commit)
            .collect())
    }

    fn restore(&self, root: &Utf8Path, commit: &str) -> Result<()> {
        let status = self.status(root)?;
        if !status.initialised {
            return Err(Error::NotInitialised);
        }
        // Restoring overwrites the working tree. Uncommitted edits are the one
        // thing here that exists nowhere else, so this refuses rather than
        // destroying them — the caller is expected to record them first.
        if status.dirty {
            return Err(Error::WouldLoseChanges);
        }

        // `checkout <commit> -- .` puts the files back without moving HEAD, so
        // the history is not rewritten and going forward again is just another
        // restore. Recording the result is the caller's decision.
        run(root, &["checkout", commit, "--", "."])?;
        Ok(())
    }
}

/// Field separator inside a log record.
const UNIT: char = '\u{1f}';
/// Record separator between log entries.
const RECORD: char = '\u{1e}';

/// Parse one `--pretty=format` record.
fn parse_commit(record: &str) -> Option<Commit> {
    let mut fields = record.trim_start_matches('\n').split(UNIT);
    Some(Commit {
        id: fields.next()?.to_owned(),
        short_id: fields.next()?.to_owned(),
        author: fields.next()?.to_owned(),
        timestamp: fields.next()?.to_owned(),
        summary: fields.next().unwrap_or_default().to_owned(),
    })
}

/// Parse one `git status --porcelain` line.
fn parse_status_line(line: &str) -> Option<FileChange> {
    if line.len() < 4 {
        return None;
    }
    let (code, path) = line.split_at(2);
    let path = path.trim();
    // A rename reads `R  old -> new`; the new name is the one worth reporting.
    let path = match path.split_once(" -> ") {
        Some((_, new)) => new,
        None => path,
    };

    let kind = match code.trim() {
        "A" | "??" => ChangeKind::Added,
        "D" => ChangeKind::Deleted,
        "M" | "MM" | "AM" => ChangeKind::Modified,
        "R" => ChangeKind::Other,
        _ => ChangeKind::Modified,
    };

    Some(FileChange {
        path: path.trim_matches('"').to_owned(),
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lines_parse_into_changes() {
        assert_eq!(
            parse_status_line(" M main.tex"),
            Some(FileChange {
                path: "main.tex".to_owned(),
                kind: ChangeKind::Modified
            })
        );
        assert_eq!(
            parse_status_line("?? new.tex"),
            Some(FileChange {
                path: "new.tex".to_owned(),
                kind: ChangeKind::Added
            })
        );
        assert_eq!(
            parse_status_line(" D gone.tex"),
            Some(FileChange {
                path: "gone.tex".to_owned(),
                kind: ChangeKind::Deleted
            })
        );
    }

    #[test]
    fn a_rename_reports_the_new_name() {
        let change = parse_status_line("R  old.tex -> new.tex").unwrap();
        assert_eq!(change.path, "new.tex");
        assert_eq!(change.kind, ChangeKind::Other);
    }

    #[test]
    fn quoted_paths_are_unquoted() {
        // git quotes paths containing spaces or non-ASCII.
        let change = parse_status_line(" M \"section two.tex\"").unwrap();
        assert_eq!(change.path, "section two.tex");
    }

    #[test]
    fn a_commit_record_parses() {
        let record =
            format!("abc123{UNIT}abc{UNIT}Ada{UNIT}2026-08-17T10:00:00+02:00{UNIT}Update main.tex");
        let commit = parse_commit(&record).unwrap();
        assert_eq!(commit.id, "abc123");
        assert_eq!(commit.short_id, "abc");
        assert_eq!(commit.author, "Ada");
        assert_eq!(commit.summary, "Update main.tex");
    }

    #[test]
    fn a_message_containing_the_obvious_delimiters_still_parses() {
        // The reason for the unit separator: a commit message can contain a
        // pipe, a tab, a newline, or whatever else looked like a safe choice.
        let awkward = "Fix | the \t table, see: a|b";
        let record = format!("id{UNIT}sh{UNIT}Ada{UNIT}2026-08-17T10:00:00Z{UNIT}{awkward}");
        assert_eq!(parse_commit(&record).unwrap().summary, awkward);
    }

    #[test]
    fn a_truncated_record_is_skipped_rather_than_panicking() {
        assert!(parse_commit("only-one-field").is_none());
        assert!(parse_status_line("").is_none());
        assert!(parse_status_line("M").is_none());
    }
}
