//! Forces the embedded engine to be linked, so its contribution to a shipped
//! binary can be measured rather than guessed at.
//!
//! Tectonic statically links XeTeX, ICU4C, freetype2, graphite2, libpng and
//! zlib. That is a large amount of C, and "how much bigger does the application
//! get" is a fair question to ask before making it the default engine
//! ([ADR-0007]). A `cargo build` of the library alone does not answer it: rlibs
//! are not linked, and dead-code elimination only happens at link time.
//!
//! # Referencing the type is not enough
//!
//! The first version of this probe constructed a `TectonicEngine` and called
//! `id()` and `is_available()`. Both are trivial - one returns a literal, the
//! other returns `true` - and neither reaches a single line of Tectonic. The
//! linker duly discarded the engine, and the measurement reported **0 bytes
//! added on linux-aarch64**: a whole TeX engine costing nothing, which should
//! have been obviously impossible.
//!
//! To keep the engine, the binary has to contain a call that actually enters it.
//! The call below is guarded by a runtime condition the compiler cannot fold
//! away, so the code is retained without the probe ever typesetting anything.
//!
//! [ADR-0007]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md

use camino::Utf8PathBuf;
use yaz_compile::CompileEngine;
use yaz_core::project::{EngineChoice, Project};

fn main() {
    let engine = yaz_compile::TectonicEngine::new();
    println!("{} available={}", engine.id(), engine.is_available());

    // Never true in practice, and not provably false at compile time, so the
    // whole Tectonic call graph stays in the binary. `compile` is what reaches
    // the engine; going through our own trait method keeps the probe free of a
    // direct tectonic dependency. Running it would need a real project and a
    // network fetch, neither of which a size probe should do.
    if std::env::args().any(|arg| arg == "--typeset-and-exit") {
        let project = Project {
            root: Utf8PathBuf::from("."),
            entry: Utf8PathBuf::from("main.tex"),
            engine: EngineChoice::Tectonic,
            document_locale: None,
        };
        match engine.compile(&project) {
            Ok(output) => println!("succeeded={}", output.succeeded),
            Err(error) => println!("compile failed: {error}"),
        }
    }
}
