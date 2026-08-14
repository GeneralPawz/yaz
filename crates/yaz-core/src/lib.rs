//! Project, document, workspace and settings model for yaz.
//!
//! This crate is the domain layer. It knows what a project is, how documents are
//! read and written, and how settings are stored and migrated. It knows nothing
//! about Tauri, about the user interface, or about how anything is displayed —
//! that separation is what keeps it testable without a running application, and
//! reusable by a future CLI or language server.
//!
//! See [ADR-0017](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0017-repository-layout.md).

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod document;
pub mod error;
pub mod project;
pub mod settings;
pub mod workspace;

pub use error::{Error, Result};
