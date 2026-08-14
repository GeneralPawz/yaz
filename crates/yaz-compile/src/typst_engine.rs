//! The embedded Typst engine.
//!
//! # This is not another LaTeX engine
//!
//! Tectonic and the system engines are two ways to typeset the same `.tex`
//! source. Typst is not: it is a **different document language**, and a Typst
//! project is written in `.typ`. Pointing it at a LaTeX file produces a parse
//! error, not a document, so [`crate::engine::CompileEngine::compile`] refuses
//! rather than trying — see `EngineChoice::language`.
//!
//! Treating it as a third interchangeable option in the picker would be the
//! single easiest way to make this feature confusing.
//!
//! # Why it is worth having
//!
//! For someone writing from their own notes rather than filling in a
//! publisher's template, Typst is plausibly the better tool: much faster, with
//! incremental compilation, and pure Rust — no vcpkg, no ICU4C, no system C
//! libraries, and native on every architecture without effort.
//!
//! It is **not** meaningfully smaller, which is the intuitive claim and the
//! wrong one. Measured on `aarch64-pc-windows-msvc`, a Typst build is a 40.4 MB
//! binary against Tectonic's 50.5 MB, and its installer is marginally *larger* —
//! about 9.5 MB of it is the embedded font set that Tectonic instead fetches on
//! demand. The argument is speed and buildability, not disk.
//!
//! It buys none of that for anyone who needs `elsarticle.cls`, which is why it
//! is an addition rather than a replacement. See the
//! [roadmap](https://generalpawz.github.io/yaz/roadmap).

use camino::{Utf8Path, Utf8PathBuf};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

use yaz_core::project::Project;

use crate::diagnostics::{Diagnostic, Severity};
use crate::engine::{CompileEngine, CompileOutput};

/// Compiles documents with the embedded Typst engine.
#[derive(Debug, Default)]
pub struct TypstEngine {
    /// Where artefacts are written, relative to the project root.
    pub build_dir: Utf8PathBuf,
}

impl TypstEngine {
    /// An engine writing artefacts into `build/` inside the project.
    pub fn new() -> Self {
        Self {
            build_dir: Utf8PathBuf::from("build"),
        }
    }
}

/// Fonts, parsed once for the process.
///
/// Parsing the embedded set is cheap but not free, and the result never changes,
/// so it is done once rather than per compile.
fn fonts() -> &'static (LazyHash<FontBook>, Vec<Font>) {
    static FONTS: OnceLock<(LazyHash<FontBook>, Vec<Font>)> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut book = FontBook::new();
        let mut fonts = Vec::new();

        // Embedded fonts only. Scanning system fonts would mean pulling fontdb
        // with fontconfig, reintroducing a system C dependency on Linux and
        // undercutting the reason for trying Typst. It also means a machine with
        // no usable system fonts still produces a PDF rather than failing.
        for (font, info) in typst_kit::fonts::embedded() {
            book.push(info);
            fonts.push(font);
        }

        (LazyHash::new(book), fonts)
    })
}

/// A [`World`] rooted at a project directory.
struct ProjectWorld {
    root: Utf8PathBuf,
    main: FileId,
    library: LazyHash<Library>,
    /// Sources and binaries are cached because Typst asks for the same file
    /// repeatedly during a single compilation.
    sources: Mutex<HashMap<FileId, Source>>,
    binaries: Mutex<HashMap<FileId, Bytes>>,
}

impl ProjectWorld {
    fn new(root: &Utf8Path, entry: &Utf8Path) -> yaz_core::Result<Self> {
        // Fallible because a virtual path must be well formed — an entry that
        // escapes the project root is rejected here rather than later.
        let vpath = VirtualPath::new(entry.as_str()).map_err(|error| yaz_core::Error::Io {
            path: entry.to_owned(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidInput, error.to_string()),
        })?;

        Ok(Self {
            root: root.to_owned(),
            main: RootedPath::new(VirtualRoot::Project, vpath).intern(),
            library: LazyHash::new(Library::builder().build()),
            sources: Mutex::new(HashMap::new()),
            binaries: Mutex::new(HashMap::new()),
        })
    }

    /// Resolve a file id to a real path inside the project.
    ///
    /// Anything that escapes the root is refused. Typst packages are not
    /// supported yet, so a package-qualified id is refused rather than being
    /// silently resolved against the project — which would read the wrong file.
    fn resolve(&self, id: FileId) -> FileResult<Utf8PathBuf> {
        let rooted = id.get();

        if matches!(rooted.root(), VirtualRoot::Package(_)) {
            return Err(FileError::Other(Some(
                "Typst packages are not supported yet".into(),
            )));
        }

        // Typst's own resolver does the containment check, returning None when a
        // path would escape the root. Better to use it than to re-derive the
        // same logic here and risk disagreeing with the engine about what is
        // inside the project.
        let resolved = rooted
            .vpath()
            .realize(self.root.as_std_path())
            .map_err(|_| FileError::AccessDenied)?;

        Utf8PathBuf::from_path_buf(resolved)
            .map_err(|_| FileError::Other(Some("path is not valid UTF-8".into())))
    }
}

impl World for ProjectWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &fonts().0
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if let Some(cached) = self.sources.lock().unwrap().get(&id) {
            return Ok(cached.clone());
        }
        let path = self.resolve(id)?;
        let text = std::fs::read_to_string(path.as_std_path())
            .map_err(|error| FileError::from_io(error, path.as_std_path()))?;
        let source = Source::new(id, text);
        self.sources.lock().unwrap().insert(id, source.clone());
        Ok(source)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(cached) = self.binaries.lock().unwrap().get(&id) {
            return Ok(cached.clone());
        }
        let path = self.resolve(id)?;
        let data = std::fs::read(path.as_std_path())
            .map_err(|error| FileError::from_io(error, path.as_std_path()))?;
        let bytes = Bytes::new(data);
        self.binaries.lock().unwrap().insert(id, bytes.clone());
        Ok(bytes)
    }

    fn font(&self, index: usize) -> Option<Font> {
        fonts().1.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        // Deliberately absent for now. A document that stamps itself with the
        // current date is not reproducible, and reproducible output matters more
        // here than `datetime.today()` working.
        None
    }
}

impl CompileEngine for TypstEngine {
    fn id(&self) -> &str {
        "typst"
    }

    fn is_available(&self) -> bool {
        // Compiled in, so always present.
        true
    }

    fn compile(&self, project: &Project) -> yaz_core::Result<CompileOutput> {
        let out_dir = project.root.join(&self.build_dir);
        std::fs::create_dir_all(&out_dir).map_err(|source| yaz_core::Error::Io {
            path: out_dir.clone(),
            source,
        })?;

        let world = ProjectWorld::new(&project.root, &project.entry)?;
        let result = typst::compile::<typst_layout::PagedDocument>(&world);

        let mut diagnostics: Vec<Diagnostic> = result
            .warnings
            .iter()
            .map(|warning| to_diagnostic(warning, Severity::Warning))
            .collect();

        let document = match result.output {
            Ok(document) => document,
            Err(errors) => {
                diagnostics.extend(errors.iter().map(|e| to_diagnostic(e, Severity::Error)));
                return Ok(CompileOutput {
                    succeeded: false,
                    pdf: None,
                    synctex: None,
                    diagnostics,
                });
            }
        };

        let pdf =
            typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()).map_err(|errors| {
                yaz_core::Error::Io {
                    path: project.root.join(&project.entry),
                    source: std::io::Error::other(format!("PDF export failed: {errors:?}")),
                }
            })?;

        let stem = project.entry.file_stem().unwrap_or("document");
        let pdf_path = out_dir.join(format!("{stem}.pdf"));
        std::fs::write(pdf_path.as_std_path(), pdf).map_err(|source| yaz_core::Error::Io {
            path: pdf_path.clone(),
            source,
        })?;

        Ok(CompileOutput {
            succeeded: true,
            pdf: Some(pdf_path),
            // Typst has its own source mapping, but nothing resembling a SyncTeX
            // file. Wiring the editor to it is separate work.
            synctex: None,
            diagnostics,
        })
    }
}

/// Convert a Typst diagnostic into the engine-independent shape.
fn to_diagnostic(source: &typst::diag::SourceDiagnostic, severity: Severity) -> Diagnostic {
    Diagnostic {
        severity,
        message: source.message.to_string(),
        // TODO(phase-4): map the span back to a file and line. Typst reports a
        // byte span against a FileId, so this needs the World to resolve it.
        file: None,
        line: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_identifies_itself() {
        let engine = TypstEngine::new();
        assert_eq!(engine.id(), "typst");
        assert!(engine.is_available());
    }

    #[test]
    fn some_fonts_are_always_available() {
        // The embedded set means a machine with no system fonts still typesets.
        assert!(!fonts().1.is_empty());
    }
}
