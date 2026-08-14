//! The embedded Tectonic engine.
//!
//! Tectonic runs **in-process**, not as a subprocess: there is no binary to
//! ship alongside the application, no `PATH` to get wrong, and — the reason it
//! is the default — no TeX distribution for the user to install before their
//! first document compiles.
//!
//! It is also the only engine that is genuinely native on every architecture we
//! ship. A system TeX distribution on Windows-on-ARM is typically an x86_64
//! build running under emulation, which
//! [ADR-0014](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0014-target-platforms-and-arm64.md)
//! rules out for anything we control.
//!
//! # Limitations, stated plainly
//!
//! Tectonic is XeTeX-based. It is **not** `pdflatex` and cannot be made to be.
//! Templates that require `pdflatex` or `lualatex` specifically need the system
//! engine, and the UI must say so rather than surfacing a confusing TeX error —
//! see [ADR-0007](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md).
//!
//! The first compilation of a document downloads the support files it needs, so
//! it requires network access and a visible progress state. Subsequent runs use
//! the shared cache.

use camino::Utf8PathBuf;
use tectonic::config::PersistentConfig;
use tectonic::driver::{OutputFormat, ProcessingSessionBuilder};
use tectonic::status::NoopStatusBackend;
use yaz_core::project::Project;

use crate::engine::{CompileEngine, CompileOutput};

/// Compiles documents with the embedded Tectonic engine.
#[derive(Debug, Default)]
pub struct TectonicEngine {
    /// Where build artefacts are written, relative to the project root.
    pub build_dir: Utf8PathBuf,
}

impl TectonicEngine {
    /// Create an engine writing artefacts into `build/` inside the project.
    pub fn new() -> Self {
        Self {
            build_dir: Utf8PathBuf::from("build"),
        }
    }
}

impl CompileEngine for TectonicEngine {
    fn id(&self) -> &str {
        "tectonic"
    }

    fn is_available(&self) -> bool {
        // Compiled in, so always present. Contrast with the system engine,
        // which reports false when no distribution is installed.
        true
    }

    fn compile(&self, project: &Project) -> yaz_core::Result<CompileOutput> {
        let entry = project.root.join(&project.entry);
        let out_dir = project.root.join(&self.build_dir);

        std::fs::create_dir_all(&out_dir).map_err(|source| yaz_core::Error::Io {
            path: out_dir.clone(),
            source,
        })?;

        // TODO(phase-2): replace with a status backend that streams progress and
        // structured diagnostics to the frontend instead of discarding them.
        let mut status = NoopStatusBackend::default();

        let config = PersistentConfig::open(false).map_err(|_| yaz_core::Error::Io {
            path: entry.clone(),
            source: std::io::Error::other("could not open the Tectonic configuration"),
        })?;

        let bundle = config
            .default_bundle(false)
            .map_err(|_| yaz_core::Error::Io {
                path: entry.clone(),
                source: std::io::Error::other("could not open the Tectonic support bundle"),
            })?;

        let format_cache = config
            .format_cache_path()
            .map_err(|_| yaz_core::Error::Io {
                path: entry.clone(),
                source: std::io::Error::other("could not resolve the Tectonic format cache"),
            })?;

        let mut builder = ProcessingSessionBuilder::default();
        builder
            .bundle(bundle)
            .primary_input_path(entry.as_std_path())
            .filesystem_root(project.root.as_std_path())
            .format_name("latex")
            .format_cache_path(format_cache)
            .output_format(OutputFormat::Pdf)
            .output_dir(out_dir.as_std_path())
            // Both are needed for a usable editor: logs drive the diagnostics
            // panel, intermediates make repeat builds fast.
            .keep_logs(true)
            .keep_intermediates(true)
            // SyncTeX is what makes click-to-source work in the PDF pane.
            .synctex(true);

        let mut session = builder.create(&mut status).map_err(|_| yaz_core::Error::Io {
            path: entry.clone(),
            source: std::io::Error::other("could not create a Tectonic session"),
        })?;

        // A non-zero result does not mean "no PDF": LaTeX routinely emits errors
        // and a usable document at the same time, so the outcome is reported
        // from what actually landed on disk rather than from the exit status.
        let run = session.run(&mut status);

        let stem = entry.file_stem().unwrap_or("document");
        let pdf = out_dir.join(format!("{stem}.pdf"));
        let synctex = out_dir.join(format!("{stem}.synctex.gz"));

        Ok(CompileOutput {
            succeeded: run.is_ok() && pdf.exists(),
            pdf: pdf.exists().then_some(pdf),
            synctex: synctex.exists().then_some(synctex),
            // TODO(phase-2): parse the retained log into typed diagnostics via
            // crate::diagnostics, which is shared across engines.
            diagnostics: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_reports_itself_as_available() {
        let engine = TectonicEngine::new();
        assert_eq!(engine.id(), "tectonic");
        assert!(engine.is_available());
    }
}
