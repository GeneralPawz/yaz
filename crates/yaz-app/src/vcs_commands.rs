//! Version control commands.
//!
//! # Switching it off never destroys anything
//!
//! Deactivating stops yaz recording versions. It does **not** remove `.git` or
//! touch the history, and there is deliberately no command that does. A toggle
//! that deleted a repository would be a single misclick between a writer and
//! every draft they have — and if they used git before yaz, it would be *their*
//! repository, with their branches and remotes in it.
//!
//! So "off" is a line in `yaz.toml`, and turning it back on finds the history
//! exactly where it was left.

use camino::{Utf8Path, Utf8PathBuf};
use serde::Serialize;

use yaz_core::project::ProjectSettings;
use yaz_vcs::{BackendKind, ChangeSummary, Commit, Descriptive, message};

use crate::commands::CommandError;

type Result<T> = std::result::Result<T, CommandError>;

/// How many versions the history tab asks for.
///
/// Enough to scroll through a paper's worth of drafts without turning the tab
/// into a paging exercise.
const HISTORY_LIMIT: usize = 200;

fn vcs_error(error: yaz_vcs::Error) -> CommandError {
    CommandError::new(error.message_key(), error)
}

fn canonical(root: &str) -> Result<Utf8PathBuf> {
    crate::commands::canonical_root(Utf8Path::new(root))
}

/// The backend a project is configured to use, if any.
fn configured(root: &Utf8Path) -> Result<Option<BackendKind>> {
    let settings = ProjectSettings::load(root)?;
    Ok(settings
        .version_control
        .as_deref()
        .and_then(BackendKind::from_id))
}

/// A backend a user could choose.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    /// Stable identifier.
    id: String,
    /// Message key naming it.
    label_key: String,
    /// Whether it can actually be used on this machine.
    available: bool,
}

/// The version-control state of a project, as the interface shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsStatus {
    /// Whether yaz is recording versions for this project.
    enabled: bool,
    /// The backend in use, or the one that would be used.
    backend: String,
    /// Whether that backend works on this machine.
    available: bool,
    /// Whether the project already has a history.
    initialised: bool,
    /// Whether anything differs from the last recorded version.
    dirty: bool,
    /// The most recent version.
    head: Option<Commit>,
}

/// Every backend, whether or not it works here.
///
/// Unavailable ones stay listed rather than hidden, for the same reason engines
/// do: "git is not installed" is actionable, and its silent absence is not.
#[tauri::command]
pub fn vcs_backends() -> Vec<BackendInfo> {
    [BackendKind::Git, BackendKind::Builtin]
        .into_iter()
        .map(|kind| BackendInfo {
            id: kind.id().to_owned(),
            label_key: kind.label_key().to_owned(),
            available: yaz_vcs::backend(kind).is_available(),
        })
        .collect()
}

/// Whether a project is being recorded, and what state its history is in.
#[tauri::command]
pub fn vcs_status(root: String) -> Result<VcsStatus> {
    let root = canonical(&root)?;
    let configured = configured(&root)?;
    // With nothing configured, report against the backend that *would* be used,
    // so the interface can say "git is available" before anything is switched on.
    let kind = configured.unwrap_or_default();
    let backend = yaz_vcs::backend(kind);

    let status = backend.status(&root).map_err(vcs_error)?;
    Ok(VcsStatus {
        enabled: configured.is_some(),
        backend: kind.id().to_owned(),
        available: backend.is_available(),
        initialised: status.initialised,
        dirty: status.dirty,
        head: status.head,
    })
}

/// Start recording versions, creating the repository if there is none.
#[tauri::command]
pub fn vcs_enable(root: String, backend: String) -> Result<VcsStatus> {
    let root_path = canonical(&root)?;
    let kind = BackendKind::from_id(&backend)
        .ok_or_else(|| CommandError::new("vcs-error-unknown-backend", &backend))?;

    let vcs = yaz_vcs::backend(kind);
    if !vcs.is_available() {
        return Err(vcs_error(yaz_vcs::Error::Unavailable {
            backend: kind.id(),
        }));
    }
    vcs.initialise(&root_path).map_err(vcs_error)?;

    let mut settings = ProjectSettings::load(&root_path)?;
    settings.version_control = Some(kind.id().to_owned());
    settings.save(&root_path)?;

    vcs_status(root)
}

/// Stop recording versions.
///
/// Leaves the repository and every recorded version untouched; see the module
/// docs for why there is no command that removes them.
#[tauri::command]
pub fn vcs_disable(root: String) -> Result<VcsStatus> {
    let root_path = canonical(&root)?;
    let mut settings = ProjectSettings::load(&root_path)?;
    settings.version_control = None;
    settings.save(&root_path)?;
    vcs_status(root)
}

/// Record a version.
///
/// `message` is what the author wrote. When it is absent or blank the message is
/// generated — today from the change list, later possibly by a model. That
/// precedence lives in [`yaz_vcs::message::resolve`] so nothing can quietly
/// overrule a person.
#[tauri::command]
pub fn vcs_commit(root: String, message: Option<String>) -> Result<Option<Commit>> {
    let root = canonical(&root)?;
    let Some(kind) = configured(&root)? else {
        // Saving a project that is not being recorded is not an error; it is
        // simply a save.
        return Ok(None);
    };

    let backend = yaz_vcs::backend(kind);
    let changes = backend.changes(&root).map_err(vcs_error)?;
    let summary = ChangeSummary::new(changes);
    let text = message::resolve(message.as_deref(), &Descriptive, &summary);

    backend.commit(&root, &text).map_err(vcs_error)
}

/// Recorded versions, most recent first.
#[tauri::command]
pub fn vcs_history(root: String) -> Result<Vec<Commit>> {
    let root = canonical(&root)?;
    let Some(kind) = configured(&root)? else {
        return Ok(Vec::new());
    };
    yaz_vcs::backend(kind)
        .history(&root, HISTORY_LIMIT)
        .map_err(vcs_error)
}

/// Put the project back to a recorded version.
#[tauri::command]
pub fn vcs_restore(root: String, commit: String) -> Result<()> {
    let root = canonical(&root)?;
    let kind = configured(&root)?
        .ok_or_else(|| CommandError::new("vcs-error-not-initialised", "version control is off"))?;
    yaz_vcs::backend(kind)
        .restore(&root, &commit)
        .map_err(vcs_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_backend_is_listed_whether_or_not_it_works_here() {
        // Hiding an unavailable backend leaves somebody hunting for an option
        // the documentation mentions.
        let backends = vcs_backends();
        assert_eq!(backends.len(), 2);
        assert!(backends.iter().any(|b| b.id == "git"));
        assert!(backends.iter().any(|b| b.id == "builtin"));
    }

    #[test]
    fn the_builtin_backend_is_never_reported_as_available() {
        let backends = vcs_backends();
        let builtin = backends.iter().find(|b| b.id == "builtin").unwrap();
        assert!(
            !builtin.available,
            "the placeholder must not look usable, or somebody switches it on \
             and believes their work is being recorded"
        );
    }

    #[test]
    fn an_unknown_backend_is_refused_rather_than_substituted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let error = vcs_enable(root, "mercurial".to_owned()).unwrap_err();
        assert_eq!(error.message_key(), "vcs-error-unknown-backend");
    }

    #[test]
    fn disabling_leaves_the_history_in_place() {
        // The whole safety argument: off is a settings line, not a deletion.
        let dir = tempfile::tempdir().unwrap();
        let root_path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let root = root_path.to_string();

        let git = yaz_vcs::backend(BackendKind::Git);
        if !git.is_available() {
            return;
        }
        std::fs::write(root_path.join("main.tex").as_std_path(), "x\n").unwrap();

        vcs_enable(root.clone(), "git".to_owned()).unwrap();
        vcs_commit(root.clone(), Some("First".to_owned()))
            .unwrap()
            .unwrap();

        let after = vcs_disable(root.clone()).unwrap();
        assert!(!after.enabled);
        assert!(
            root_path.join(".git").as_std_path().is_dir(),
            "disabling deleted the repository"
        );

        // And switching back on finds the history where it was left.
        let again = vcs_enable(root.clone(), "git".to_owned()).unwrap();
        assert!(again.enabled);
        assert_eq!(vcs_history(root).unwrap().len(), 1);
    }

    #[test]
    fn committing_an_untracked_project_is_a_no_op_rather_than_an_error() {
        // Ctrl+S in a project that is not being recorded is just a save.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        assert!(vcs_commit(root.clone(), None).unwrap().is_none());
        assert!(vcs_history(root).unwrap().is_empty());
    }
}
