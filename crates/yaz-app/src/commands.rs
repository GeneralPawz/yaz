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

pub(crate) type Result<T> = std::result::Result<T, CommandError>;

/// A file inside the open project.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    relative_path: String,
    is_entry: bool,
    /// What sort of file it is, for its icon and whether it is dimmed.
    kind: FileKind,
}

/// What a file is, as far as a file list needs to care.
///
/// Coarse on purpose. The list draws one icon per kind and dims one of them,
/// so a distinction that changes neither is a distinction that costs a variant
/// and buys nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileKind {
    /// A LaTeX source.
    Tex,
    /// A bibliography.
    Bib,
    /// A class or package.
    Style,
    /// A compiled document.
    Pdf,
    Image,
    /// Something a compile produced and a compile can produce again.
    ///
    /// One kind for the lot. There are thirty extensions here and nobody has
    /// ever wanted to tell an `.fdb_latexmk` from an `.fls` in a file list —
    /// what they want is for both to stop competing with the two files they
    /// are actually working on.
    Build,
    Other,
}

/// Extensions a LaTeX run leaves behind.
///
/// The list is long because the toolchain is: glossaries, biblatex, beamer and
/// `latexmk` each write their own. A missing entry is not a failure, only a
/// file that stays as prominent as the source beside it.
const BUILD_EXTENSIONS: &[&str] = &[
    "acn",
    "acr",
    "alg",
    "aux",
    "auxlock",
    "bbl",
    "bcf",
    "blg",
    "dvi",
    "fdb_latexmk",
    "figlist",
    "fls",
    "glg",
    "glo",
    "gls",
    "glsdefs",
    "idx",
    "ilg",
    "ind",
    "ist",
    "lof",
    "log",
    "lot",
    "nav",
    "out",
    "run",
    "snm",
    "synctex",
    "toc",
    "vrb",
    "xdv",
];

/// Extensions that are pictures.
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "eps", "tif", "tiff", "webp", "bmp",
];

impl FileKind {
    /// Classify by name.
    ///
    /// By the final extension, with one exception: `main.synctex.gz` is a
    /// build artefact whose extension is `gz`, and a compressed archive that
    /// happens to be one is not something to show as a generic file.
    fn of(name: &str) -> Self {
        let lower = name.to_ascii_lowercase();
        let stripped = lower.strip_suffix(".gz").unwrap_or(&lower);
        let extension = stripped.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");

        match extension {
            "tex" => FileKind::Tex,
            "bib" => FileKind::Bib,
            "cls" | "sty" | "clo" | "def" => FileKind::Style,
            "pdf" => FileKind::Pdf,
            _ if IMAGE_EXTENSIONS.contains(&extension) => FileKind::Image,
            _ if BUILD_EXTENSIONS.contains(&extension) => FileKind::Build,
            _ => FileKind::Other,
        }
    }
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
    /// The SyncTeX database, which is what makes a click in the PDF findable
    /// in the source.
    synctex_path: Option<String>,
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
    let root_canonical = canonical_root(root)?;
    let joined = root.join(relative);

    // A file being written may not exist yet, so canonicalise the parent and
    // re-attach the final component.
    let candidate = if joined.exists() {
        canonical_root(&joined)?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| CommandError::new("error-fs-outside-root", "path has no parent"))?;
        let file_name = joined.file_name().ok_or_else(|| {
            CommandError::new("error-fs-outside-root", "path has no final component")
        })?;
        canonical_root(parent)?.join(file_name)
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
pub(crate) fn canonical_root(path: &Utf8Path) -> Result<Utf8PathBuf> {
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
    let root = canonical_root(Utf8Path::new(&root))?;

    // Everything, not only the sources.
    //
    // A real project has images the author wants to see, a `.bib` they open,
    // and a compiled PDF they double-click. Showing four extensions and
    // hiding the rest meant the file list disagreed with the folder, and the
    // author had to keep a file manager open beside it.
    //
    // What is *shown* is then the interface's decision — dotfolders, build
    // artefacts and unfamiliar formats each have a switch — and a decision
    // like that belongs where it can be changed without a recompile.
    let mut files: Vec<String> = walkdir::WalkDir::new(root.as_std_path())
        .max_depth(8)
        .into_iter()
        .filter_entry(|entry| {
            // `.git` and `node_modules` are excluded here rather than in the
            // interface because they are not a preference: they hold tens of
            // thousands of files, walking them is slow, and nobody has ever
            // wanted to browse either from a LaTeX editor. Every other dotted
            // folder is a real choice and is left to the switch.
            let name = entry.file_name().to_string_lossy();
            !(name == ".git" || name == "node_modules")
        })
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file())
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

    // Recorded here rather than in the frontend: this is the one place
    // that knows the open succeeded and knows the canonical root.
    remember_project(&root);

    Ok(ProjectInfo {
        root: root.to_string(),
        entry: entry.clone(),
        files: files
            .into_iter()
            .map(|relative_path| ProjectFile {
                is_entry: relative_path == entry,
                kind: FileKind::of(&relative_path),
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

/// Read a project-relative file as bytes.
///
/// For the things that are not text: a PDF the author wants to look at, an
/// image a figure includes. Scoped to the project root like every other
/// project read, because the alternative — composing a path in the webview and
/// handing it to an unscoped reader — would put the boundary in the wrong
/// process (ADR-0006).
#[tauri::command]
pub fn read_project_bytes(root: String, relative_path: String) -> Result<Vec<u8>> {
    let path = resolve_in_root(Utf8Path::new(&root), &relative_path)?;
    std::fs::read(&path)
        .map_err(|error| CommandError::new("error-fs-io", format!("{path}: {error}")))
}

/// Write a project-relative file as bytes.
///
/// For the things that are not text: an image a plugin captured, a figure it
/// generated. Scoped to the project root exactly as the text write is, because
/// "which file may this touch" is not a question the webview gets to answer
/// ([ADR-0006]).
///
/// [ADR-0006]: https://github.com/texyaz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md
#[tauri::command]
pub fn write_project_bytes(root: String, relative_path: String, contents: Vec<u8>) -> Result<()> {
    let path = resolve_in_root(Utf8Path::new(&root), &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CommandError::new("error-fs-io", format!("{parent}: {error}")))?;
    }
    std::fs::write(&path, contents)
        .map_err(|error| CommandError::new("error-fs-io", format!("{path}: {error}")))
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
    let root = canonical_root(Utf8Path::new(&root))?;
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
        synctex_path: output.synctex.map(|p| p.to_string()),
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
    let root = canonical_root(Utf8Path::new(&root))?;
    let settings = ProjectSettings::load(&root)?;
    Ok(ProjectSettingsDto {
        engine_id: settings.engine.map(|e| e.to_id()),
        entry: settings.entry.map(|p| p.to_string()),
        workspace: settings.workspace,
    })
}

/// Projects opened before, most recent first.
///
/// Entries whose folder has since gone are filtered out rather than offered:
/// a menu item that always fails is worse than one that is absent.
#[tauri::command]
pub fn recent_projects() -> Vec<RecentProject> {
    let Some(dir) = yaz_core::settings::config_dir() else {
        return Vec::new();
    };
    yaz_core::settings::Settings::load(&dir)
        .recent_projects
        .into_iter()
        .filter(|root| root.as_std_path().is_dir())
        .map(|root| RecentProject {
            name: root.file_name().unwrap_or(root.as_str()).to_owned(),
            root: root.to_string(),
        })
        .collect()
}

/// A previously opened project, as the menu lists it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    /// The folder name, which is what a menu should show.
    name: String,
    /// The full path, used to reopen and shown as a tooltip.
    root: String,
}

/// Record a project as most recently opened.
fn remember_project(root: &Utf8Path) {
    let Some(dir) = yaz_core::settings::config_dir() else {
        return;
    };
    let mut settings = yaz_core::settings::Settings::load(&dir);
    settings.remember_project(root);
    if let Err(error) = settings.save(&dir) {
        // Losing the recent list is not worth failing an open over.
        tracing::warn!(%error, "could not record the recently opened project");
    }
}

/// Persist the pane arrangement for a project.
///
/// Written through the same settings file as the engine choice, so a project
/// carries how it is worked on as well as how it is built.
#[tauri::command]
pub fn set_project_workspace(root: String, workspace: String) -> Result<()> {
    let root = canonical_root(Utf8Path::new(&root))?;
    let mut settings = ProjectSettings::load(&root)?;
    settings.workspace = Some(workspace);
    settings.save(&root)?;
    Ok(())
}

/// Persist the engine choice for a project, writing `yaz.toml`.
#[tauri::command]
pub fn set_project_engine(root: String, engine_id: String) -> Result<()> {
    let root = canonical_root(Utf8Path::new(&root))?;

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

/// Where in the source a point in the PDF came from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    /// Project-relative when the file is inside the project, absolute when it
    /// is not — a `\input` from elsewhere, or a package.
    path: String,
    /// Whether `path` is relative to the project root.
    in_project: bool,
    /// One-based.
    line: u32,
}

/// Inverse search: the source line behind a point in the compiled PDF.
///
/// `x` and `y` are PDF points from the top left of the page, which is what a
/// viewer has after putting a click through its own transform. Returns nothing
/// rather than an error when the database has no answer — a click on a blank
/// page is an ordinary thing to do, not a failure.
#[tauri::command]
pub fn locate_in_source(
    root: String,
    synctex_path: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Option<SourceLocation>> {
    let path = Utf8PathBuf::from(synctex_path);
    let Ok(database) = yaz_compile::synctex::SyncTex::load(&path) else {
        // A missing or unreadable database means the last compile did not
        // write one. Nothing to say, and nothing the user did wrong.
        return Ok(None);
    };

    let Some(found) = database.locate(page, x, y) else {
        return Ok(None);
    };

    // The engine records absolute paths. The editor works in project-relative
    // ones, and a file outside the project cannot be opened in it at all, so
    // which of the two this is has to travel with the answer.
    let root = Utf8PathBuf::from(root);
    let absolute = if found.file.is_absolute() {
        found.file.clone()
    } else {
        root.join(&found.file)
    };
    let relative = absolute.strip_prefix(&root).ok();

    Ok(Some(SourceLocation {
        path: relative
            .map(|p| p.to_string())
            .unwrap_or_else(|| absolute.to_string()),
        in_project: relative.is_some(),
        line: found.line,
    }))
}

#[cfg(test)]
mod file_kind_tests {
    use super::FileKind;

    #[test]
    fn knows_the_files_an_author_works_on() {
        assert_eq!(FileKind::of("main.tex"), FileKind::Tex);
        assert_eq!(FileKind::of("BIMwissT.bib"), FileKind::Bib);
        assert_eq!(FileKind::of("output/main.pdf"), FileKind::Pdf);
        assert_eq!(FileKind::of("images/logo.png"), FileKind::Image);
        assert_eq!(FileKind::of("thesis.cls"), FileKind::Style);
    }

    #[test]
    fn calls_a_compiled_pdf_a_pdf() {
        // It is an artefact, and it is also the thing the author double-clicks
        // to read what they wrote. Dimming it with the `.aux` files would hide
        // the one output anybody wants.
        assert_eq!(FileKind::of("output/main.pdf"), FileKind::Pdf);
    }

    #[test]
    fn gathers_what_a_compile_leaves_behind() {
        for name in [
            "main.aux",
            "main.log",
            "main.toc",
            "main.lof",
            "main.bbl",
            "main.bcf",
            "main.glo",
            "main.gls",
            "main.ist",
            "main.acn",
            "main.fdb_latexmk",
            "main.fls",
            "main.out",
        ] {
            assert_eq!(FileKind::of(name), FileKind::Build, "{name}");
        }
    }

    #[test]
    fn sees_through_the_compression_on_a_synctex() {
        // `main.synctex.gz` has the extension `gz`, and an archive that happens
        // to be a build artefact should not read as a generic file.
        assert_eq!(FileKind::of("output/main.synctex.gz"), FileKind::Build);
    }

    #[test]
    fn does_not_guess_at_what_it_does_not_know() {
        // A generic icon is honest; classifying by hope is not.
        assert_eq!(FileKind::of("README.md"), FileKind::Other);
        assert_eq!(FileKind::of("indent.yaml"), FileKind::Other);
        assert_eq!(FileKind::of("Makefile"), FileKind::Other);
        assert_eq!(FileKind::of("no-extension"), FileKind::Other);
    }

    #[test]
    fn ignores_the_case_of_an_extension() {
        // Windows hands these back however they were typed.
        assert_eq!(FileKind::of("Figure.PNG"), FileKind::Image);
        assert_eq!(FileKind::of("MAIN.TEX"), FileKind::Tex);
    }
}
