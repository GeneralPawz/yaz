//! The system TeX engine.
//!
//! Drives an installed TeX distribution (TeX Live, MiKTeX). This is not a
//! fallback for Tectonic — [ADR-0007] makes the two first-class peers, because
//! journal templates routinely require `pdflatex` or `lualatex` specifically and
//! Tectonic, being XeTeX-based, cannot be either.
//!
//! `latexmk` is preferred when present so we inherit its dependency resolution —
//! how many passes to run, when to run BibTeX, when the `.aux` has settled —
//! rather than reimplementing a well-solved problem badly.
//!
//! [ADR-0007]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md

use camino::Utf8PathBuf;
use std::process::Command;
use yaz_core::project::Project;

use crate::diagnostics::parse_log;
use crate::engine::{CompileEngine, CompileOutput};

/// Compiles with an installed TeX distribution.
#[derive(Debug, Clone)]
pub struct SystemEngine {
    /// The typesetter to run, e.g. `pdflatex`, `xelatex`, `lualatex`.
    pub engine: String,
    /// Where artefacts are written, relative to the project root.
    pub build_dir: Utf8PathBuf,
}

impl SystemEngine {
    /// A system engine driving the named typesetter.
    pub fn new(engine: impl Into<String>) -> Self {
        Self {
            engine: engine.into(),
            build_dir: Utf8PathBuf::from("build"),
        }
    }

    /// Every typesetter present on this machine, in preference order.
    ///
    /// Preference is XeTeX first because it handles Unicode and system fonts
    /// without ceremony, then LuaTeX, then pdfTeX. A project that needs a
    /// specific one says so in its settings and overrides this entirely.
    pub fn detect_all() -> Vec<SystemEngine> {
        ["xelatex", "lualatex", "pdflatex"]
            .iter()
            .filter(|name| binary_exists(name))
            .map(|name| SystemEngine::new(*name))
            .collect()
    }

    fn use_latexmk(&self) -> bool {
        binary_exists("latexmk")
    }
}

/// The latexmk switch that selects a given typesetter.
///
/// These are not derivable from the binary name. `-pdf` selects pdfTeX, but
/// XeTeX and LuaTeX want `-xelatex` and `-lualatex`; latexmk rejects anything
/// else outright ("`-xe` unknown option") and, because it never starts a TeX
/// run, produces no log for the diagnostics parser to explain the failure with.
fn latexmk_flag(engine: &str) -> &'static str {
    match engine {
        "xelatex" => "-xelatex",
        "lualatex" => "-lualatex",
        // pdflatex, and anything unrecognised, gets latexmk's default PDF route.
        _ => "-pdf",
    }
}

/// Whether a binary can be found on `PATH`.
fn binary_exists(name: &str) -> bool {
    // `--version` is the most portable liveness check across TeX tooling; some
    // of these do not support `--help` and none support a bare invocation
    // without blocking for input.
    Command::new(name)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

impl CompileEngine for SystemEngine {
    fn id(&self) -> &str {
        &self.engine
    }

    fn is_available(&self) -> bool {
        binary_exists(&self.engine)
    }

    fn compile(&self, project: &Project) -> yaz_core::Result<CompileOutput> {
        let out_dir = project.root.join(&self.build_dir);
        std::fs::create_dir_all(&out_dir).map_err(|source| yaz_core::Error::Io {
            path: out_dir.clone(),
            source,
        })?;

        let mut command = if self.use_latexmk() {
            let mut c = Command::new("latexmk");
            c.arg(latexmk_flag(&self.engine))
                .arg("-interaction=nonstopmode")
                .arg("-file-line-error")
                .arg("-synctex=1")
                .arg(format!("-outdir={}", self.build_dir));
            c
        } else {
            let mut c = Command::new(&self.engine);
            c.arg("-interaction=nonstopmode")
                .arg("-file-line-error")
                .arg("-synctex=1")
                .arg(format!("-output-directory={}", self.build_dir));
            c
        };

        // Run from the project root so that relative \input, \includegraphics
        // and \bibliography paths resolve the way the author wrote them.
        command.current_dir(project.root.as_std_path());
        command.arg(project.entry.as_str());

        let output = command.output().map_err(|source| yaz_core::Error::Io {
            path: Utf8PathBuf::from(&self.engine),
            source,
        })?;

        let stem = project.entry.file_stem().unwrap_or("document");
        let log_path = out_dir.join(format!("{stem}.log"));

        // The log is authoritative, not stdout: with -interaction=nonstopmode
        // the interesting detail lands in the log while stdout is a firehose.
        let log = std::fs::read_to_string(&log_path)
            .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).into_owned());
        let diagnostics = parse_log(&log);

        let pdf = out_dir.join(format!("{stem}.pdf"));
        let synctex = out_dir.join(format!("{stem}.synctex.gz"));

        Ok(CompileOutput {
            // Keyed off the artefact, not the exit status: LaTeX regularly
            // returns non-zero while producing a perfectly usable document.
            succeeded: pdf.exists(),
            pdf: pdf.exists().then_some(pdf),
            synctex: synctex.exists().then_some(synctex),
            diagnostics,
        })
    }
}
