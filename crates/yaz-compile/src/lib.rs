//! LaTeX compilation: engine abstraction, invocation, and log parsing.
//!
//! Two engines are first-class and neither is a fallback for the other. Embedded
//! **Tectonic** is the default: in-process, native on every architecture we
//! ship, and requiring no system TeX installation, which is what makes a fresh
//! install able to compile immediately. A detected **system distribution**
//! (TeX Live, MiKTeX) is offered as a peer, because journal templates routinely
//! require `pdflatex` or `lualatex` specifically.
//!
//! Everything except the actual typesetting — invocation, log parsing,
//! diagnostics, artefact paths, SyncTeX — is engine-independent and lives here.
//!
//! See [ADR-0007](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md).

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod diagnostics;
pub mod engine;

#[cfg(feature = "tectonic-engine")]
pub mod tectonic_engine;

pub use engine::CompileEngine;

#[cfg(feature = "tectonic-engine")]
pub use tectonic_engine::TectonicEngine;
