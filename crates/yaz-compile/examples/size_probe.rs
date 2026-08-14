//! Forces the embedded engine to be linked, so its contribution to a shipped
//! binary can be measured rather than guessed at.
//!
//! Tectonic statically links XeTeX, ICU4C, freetype2, graphite2, libpng and
//! zlib. That is a large amount of C, and "how much bigger does the application
//! get" is a fair question to ask before making it the default engine
//! ([ADR-0007]). A `cargo build` of the library alone does not answer it: rlibs
//! are not linked, and dead-code elimination only happens at link time.
//!
//! Referencing the engine keeps the linker from discarding it.
//!
//! [ADR-0007]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md

fn main() {
    let engine = yaz_compile::TectonicEngine::new();
    // Printed so the call cannot be optimised away.
    println!("{} available={}", engine.id(), engine.is_available());
}
