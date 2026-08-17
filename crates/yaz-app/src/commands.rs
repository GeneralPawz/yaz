//! The Tauri command surface.
//!
//! Thin wiring only: these translate between the frontend's DTOs and the domain
//! crates, and hold no logic of their own ([ADR-0017]).
//!
//! Every one of them is a privileged operation. The frontend has no filesystem
//! access of its own, and neither will plugins — the Rust process is the
//! security boundary ([ADR-0006]). The path handling here is the first sketch of
//! what the capability broker will enforce properly in phase 3: everything is
//! canonicalised and checked against the project root *before* it is used.
//!
//! [ADR-0017]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0017-repository-layout.md
//! [ADR-0006]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md

use camino::{Utf8Path, Utf8PathBuf};
use serde::Serialize;
use yaz_compile::{CompileEngine, SystemEngine};
use yaz_core::project::{EngineChoice, Project, ProjectSettings};

/// Errors crossing the IPC boundary.
///
/// Carries a message key rather than English prose so the frontend renders it in
/// the active locale ([ADR-0011]). The `detail` is diagnostic text for a log or
/// a disclosure triangle, never the primary message shown to a user.
///
/// [ADR-0011]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0011-localisation.md
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    message_key: String,
    detail: String,
}

impl From<yaz_core::Error> for CommandError {
    fn from(error: yaz_core::Error) -> Self {
        Self {
            message_key: error.message_key().to_owned(),
            detail: error.to_string(),
        }
    }
}

impl CommandError {
    /// The message key the frontend resolves against the active locale.
    ///
    /// Test-only: production code serialises the whole struct across IPC rather
    /// than reading the key back, so a non-test accessor would be dead code and
    /// CI denies warnings.
    #[cfg(test)]
    pub(crate) fn message_key(&self) -> &str {
        &self.message_key
    }

    pub(crate) fn new(message_key: &str, detail: impl std::fmt::Display) -> Self {
        Self {
            message_key: message_key.to_owned(),
            detail: detail.to_string(),
        }
    }
}

type Result<T> = std::result::Result<T, CommandError>;

/// A file inside the open project.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    relative_path: String,
    is_entry: bool,
}

/// The open project as the frontend sees it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    root: String,
    entry: String,
    files: Vec<ProjectFile>,
}

/// The outcome of a compile.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    succeeded: bool,
    pdf_path: Option<String>,
    diagnostics: Vec<yaz_compile::diagnostics::Diagnostic>,
    engine_id: String,
    elapsed_ms: u128,
}

/// Resolve a project-relative path and refuse anything outside the root.
///
/// Canonicalisation happens *before* the comparison, so `..` traversal and
/// symlink escapes are refused rather than followed. This is the invariant the
/// capability broker will inherit, and it is why the check cannot be a simple
/// `starts_with` on the untouched input.
fn resolve_in_root(root: &Utf8Path, relative: &str) -> Result<Utf8PathBuf> {
    let root_canonical = dunce_canonicalize(root)?;
    let joined = root.join(relative);

    // A file being written may not exist yet, so canonicalise the parent and
    // re-attach the final component.
    let candidate = if joined.exists() {
        dunce_canonicalize(&joined)?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| CommandError::new("error-fs-outside-root", "path has no parent"))?;
        let file_name = joined.file_name().ok_or_else(|| {
            CommandError::new("error-fs-outside-root", "path has no final component")
        })?;
        dunce_canonicalize(parent)?.join(file_name)
    };

    if !candidate.starts_with(&root_canonical) {
        return Err(CommandError::new(
            "error-fs-outside-root",
            format!("{candidate} is outside {root_canonical}"),
        ));
    }

    Ok(candidate)
}

/// Canonicalise, keeping the result UTF-8 and free of Windows `\\?\` prefixes.
fn dunce_canonicalize(path: &Utf8Path) -> Result<Utf8PathBuf> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| CommandError::new("error-fs-not-found", format!("{path}: {error}")))?;
    // Windows canonicalisation yields a `\\?\C:\…` extended-length path, which
    // compares badly against ordinary paths and looks alarming in the UI.
    let text = canonical.to_string_lossy();
    let trimmed = text.strip_prefix(r"\\?\").unwrap_or(&text);
    Ok(Utf8PathBuf::from(trimmed))
}

/// Open a directory as a project and list its LaTeX sources.
#[tauri::command]
pub fn open_project(root: String) -> Result<ProjectInfo> {
    let root = dunce_canonicalize(Utf8Path::new(&root))?;

    let mut files: Vec<String> = walkdir::WalkDir::new(root.as_std_path())
        .max_depth(8)
        .into_iter()
        .filter_entry(|entry| {
            // Build output and VCS metadata are noise in a file list, and
            // descending into them on a large project is slow for no benefit.
            let name = entry.file_name().to_string_lossy();
            !(name.starts_with('.') || name == "build" || name == "node_modules")
        })
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            matches!(
                entry.path().extension().and_then(|e| e.to_str()),
                Some("tex" | "bib" | "cls" | "sty")
            )
        })
        .filter_map(|entry| {
            let path = Utf8PathBuf::from_path_buf(entry.into_path()).ok()?;
            let relative = path.strip_prefix(&root).ok()?;
            Some(relative.as_str().replace('\\', "/"))
        })
        .collect();

    files.sort();

    // Entry heuristic, deliberately dumb for now: main.tex, else the first .tex.
    // Phase 4 replaces this with the \documentclass scan in yaz-latex, which can
    // tell a root document from an \input fragment.
    let entry = files
        .iter()
        .find(|f| f.as_str() == "main.tex")
        .or_else(|| files.iter().find(|f| f.ends_with(".tex")))
        .cloned()
        .unwrap_or_default();

    Ok(ProjectInfo {
        root: root.to_string(),
        entry: entry.clone(),
        files: files
            .into_iter()
            .map(|relative_path| ProjectFile {
                is_entry: relative_path == entry,
                relative_path,
            })
            .collect(),
    })
}

/// Read a project-relative file as text.
#[tauri::command]
pub fn read_file(root: String, relative_path: String) -> Result<String> {
    let path = resolve_in_root(Utf8Path::new(&root), &relative_path)?;
    std::fs::read_to_string(&path)
        .map_err(|error| CommandError::new("error-fs-undecodable", format!("{path}: {error}")))
}

/// Write a project-relative file.
#[tauri::command]
pub fn write_file(root: String, relative_path: String, contents: String) -> Result<()> {
    let path = resolve_in_root(Utf8Path::new(&root), &relative_path)?;
    // TODO(phase-2): atomic write via a temp file plus rename, and an mtime
    // check so an external modification is not silently clobbered
    // (yaz_core::Error::ConflictingWrite exists for exactly this).
    std::fs::write(&path, contents)
        .map_err(|error| CommandError::new("error-fs-io", format!("{path}: {error}")))
}

/// Compile the project's entry document.
#[tauri::command]
pub fn compile_project(root: String) -> Result<CompileResult> {
    let root = dunce_canonicalize(Utf8Path::new(&root))?;
    let info = open_project(root.to_string())?;

    if info.entry.is_empty() {
        return Err(CommandError::new(
            "error-fs-not-found",
            "no .tex file in this project",
        ));
    }

    // An explicit choice in yaz.toml wins. Without one, fall back to whatever
    // this machine actually has — a project that has never been configured
    // should still compile.
    let settings = ProjectSettings::load(&root)?;
    let choice = match settings.engine {
        Some(choice) => choice,
        None => default_engine_choice().ok_or_else(|| {
            CommandError::new("compile-engine-unavailable", "no engine available")
        })?,
    };

    let engine = build_engine(&choice)?;

    let project = Project {
        root: root.clone(),
        entry: Utf8PathBuf::from(&info.entry),
        engine: choice,
        document_locale: settings.document_locale,
    };

    let started = std::time::Instant::now();
    let output = engine.compile(&project)?;
    let elapsed_ms = started.elapsed().as_millis();

    Ok(CompileResult {
        succeeded: output.succeeded,
        pdf_path: output.pdf.map(|p| p.to_string()),
        diagnostics: output.diagnostics,
        engine_id: engine.id().to_owned(),
        elapsed_ms,
    })
}

/// The engine to use when a project has expressed no preference.
///
/// Prefers embedded Tectonic when this build has it, since it needs nothing
/// installed; otherwise the first detected system typesetter.
fn default_engine_choice() -> Option<EngineChoice> {
    #[cfg(feature = "tectonic-engine")]
    {
        return Some(EngineChoice::Tectonic);
    }
    #[cfg(not(feature = "tectonic-engine"))]
    {
        SystemEngine::detect_all()
            .into_iter()
            .next()
            .map(|engine| EngineChoice::System {
                engine: engine.engine,
            })
    }
}

/// Turn a stored choice into something that can actually run.
///
/// Refuses rather than substituting. A project pinned to `lualatex` because its
/// journal template needs it must not quietly compile with something else — a
/// silently different engine produces a subtly different PDF, which is far worse
/// than an error saying the engine is missing.
fn build_engine(choice: &EngineChoice) -> Result<Box<dyn CompileEngine>> {
    match choice {
        EngineChoice::Tectonic => {
            #[cfg(feature = "tectonic-engine")]
            {
                Ok(Box::new(yaz_compile::TectonicEngine::new()))
            }
            #[cfg(not(feature = "tectonic-engine"))]
            {
                Err(CommandError::new(
                    "engine-tectonic-not-built",
                    "this build does not include the embedded Tectonic engine",
                ))
            }
        }
        EngineChoice::System { engine } => {
            let system = SystemEngine::new(engine.clone());
            if system.is_available() {
                Ok(Box::new(system))
            } else {
                Err(CommandError::new(
                    "engine-system-not-installed",
                    format!("{engine} is not installed on this machine"),
                ))
            }
        }
        // EngineChoice is #[non_exhaustive], so a variant added in yaz-core
        // lands here rather than failing to compile. Refusing is right: an
        // engine this function has not been taught to construct must not fall
        // through to some default.
        other => Err(CommandError::new(
            "compile-engine-unavailable",
            format!("engine {} is not supported by this build", other.to_id()),
        )),
    }
}

/// An engine the user could choose, and whether they actually can.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    /// Stable identifier, e.g. `tectonic` or `system:xelatex`.
    id: String,
    /// What to show in the picker. Engine binary names are not translated.
    label: String,
    /// Whether this build can actually run it.
    available: bool,
    /// Message key explaining why not, when unavailable.
    unavailable_reason_key: Option<String>,
}

/// Every engine yaz knows about, available or not.
///
/// Unavailable engines are listed rather than hidden. Tectonic is a *compile
/// time* feature: a build without it cannot be made to have it by changing a
/// setting, and silently omitting it from the picker would leave a user
/// wondering where the advertised engine went. Saying "not in this build"
/// is the honest answer, and it is also the actionable one.
#[tauri::command]
pub fn list_engines() -> Vec<EngineInfo> {
    let mut engines = Vec::new();

    engines.push(EngineInfo {
        id: "tectonic".to_owned(),
        label: "Tectonic (embedded)".to_owned(),
        available: cfg!(feature = "tectonic-engine"),
        unavailable_reason_key: if cfg!(feature = "tectonic-engine") {
            None
        } else {
            Some("engine-tectonic-not-built".to_owned())
        },
    });

    let detected = SystemEngine::detect_all();
    for name in ["xelatex", "lualatex", "pdflatex"] {
        let available = detected.iter().any(|e| e.engine == name);
        engines.push(EngineInfo {
            id: format!("system:{name}"),
            label: name.to_owned(),
            available,
            unavailable_reason_key: if available {
                None
            } else {
                Some("engine-system-not-installed".to_owned())
            },
        });
    }

    engines
}

/// Read the persisted per-project settings.
#[tauri::command]
pub fn get_project_settings(root: String) -> Result<ProjectSettingsDto> {
    let root = dunce_canonicalize(Utf8Path::new(&root))?;
    let settings = ProjectSettings::load(&root)?;
    Ok(ProjectSettingsDto {
        engine_id: settings.engine.map(|e| e.to_id()),
        entry: settings.entry.map(|p| p.to_string()),
        workspace: settings.workspace,
    })
}

/// Persist the pane arrangement for a project.
///
/// Written through the same settings file as the engine choice, so a project
/// carries how it is worked on as well as how it is built.
#[tauri::command]
pub fn set_project_workspace(root: String, workspace: String) -> Result<()> {
    let root = dunce_canonicalize(Utf8Path::new(&root))?;
    let mut settings = ProjectSettings::load(&root)?;
    settings.workspace = Some(workspace);
    settings.save(&root)?;
    Ok(())
}

/// Persist the engine choice for a project, writing `yaz.toml`.
#[tauri::command]
pub fn set_project_engine(root: String, engine_id: String) -> Result<()> {
    let root = dunce_canonicalize(Utf8Path::new(&root))?;

    let choice = EngineChoice::from_id(&engine_id).ok_or_else(|| {
        CommandError::new(
            "compile-engine-unavailable",
            format!("unknown engine {engine_id}"),
        )
    })?;

    let mut settings = ProjectSettings::load(&root)?;
    settings.engine = Some(choice);
    settings.save(&root)?;
    Ok(())
}

/// Per-project settings, as the frontend sees them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsDto {
    engine_id: Option<String>,
    entry: Option<String>,
    /// The pane arrangement, opaque to this layer.
    workspace: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tectonic_availability_tracks_the_build_feature() {
        let engines = list_engines();
        let tectonic = engines
            .iter()
            .find(|e| e.id == "tectonic")
            .expect("tectonic is always listed, available or not");

        // The point of listing it regardless: a build without the feature must
        // say so rather than omit it.
        assert_eq!(tectonic.available, cfg!(feature = "tectonic-engine"));
        assert_eq!(
            tectonic.unavailable_reason_key.is_some(),
            !cfg!(feature = "tectonic-engine")
        );
    }

    #[test]
    fn every_engine_carries_a_reason_when_unavailable() {
        for engine in list_engines() {
            assert_eq!(
                engine.available,
                engine.unavailable_reason_key.is_none(),
                "{} must explain itself when unavailable",
                engine.id
            );
        }
    }

    #[test]
    fn engine_ids_parse_back_into_choices() {
        for engine in list_engines() {
            assert!(
                EngineChoice::from_id(&engine.id).is_some(),
                "{} is offered to the user but cannot be stored",
                engine.id
            );
        }
    }

    #[test]
    fn unknown_engine_is_refused_rather_than_substituted() {
        // A project pinned to a missing engine must fail loudly: silently
        // compiling with a different one produces a subtly different PDF.
        let result = build_engine(&EngineChoice::System {
            engine: "definitely-not-a-real-typesetter".to_owned(),
        });
        assert!(result.is_err());
    }
}

/// Report that the frontend has mounted and is interactive.
///
/// This exists because "the window appeared" is not the same thing as "the
/// application is usable", and only the second one is what
/// [ADR-0015](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0015-performance-budgets.md)
/// budgets. Measuring window-handle creation from outside the process reports
/// around 90 ms and is meaningless: at that point the webview has not loaded,
/// the bundle has not parsed, and nothing is on screen.
///
/// The frontend calls this once it has mounted, and the elapsed time since
/// process start is the number the budget is about.
#[tauri::command]
pub fn report_ready(state: tauri::State<'_, StartupClock>) -> u128 {
    let elapsed = state.started.elapsed().as_millis();
    tracing::info!(startup_ms = elapsed, "frontend interactive");

    // Release builds are GUI-subsystem binaries with no stdout or stderr, so a
    // benchmark harness cannot read the tracing output. When YAZ_STARTUP_LOG
    // names a file, the measurement is appended there instead.
    if let Some(path) = std::env::var_os("YAZ_STARTUP_LOG") {
        use std::io::Write as _;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "startup_ms={elapsed}");
        }
    }

    elapsed
}

/// Process start time, for the startup measurement above.
pub struct StartupClock {
    /// When `main` began.
    pub started: std::time::Instant,
}

/// Read a produced artefact as bytes, for handing the PDF to pdf.js.
#[tauri::command]
pub fn read_artefact(path: String) -> Result<Vec<u8>> {
    let path = Utf8PathBuf::from(path);
    std::fs::read(&path)
        .map_err(|error| CommandError::new("error-fs-io", format!("{path}: {error}")))
}
