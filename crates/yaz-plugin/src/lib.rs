//! Plugin manifests, lifecycle, and the capability broker.
//!
//! # This crate is a security boundary
//!
//! Plugins run as JavaScript in the application's webview with full DOM access,
//! which is what allows them to build real user interfaces. They have **no
//! ambient authority**: `fetch`, `XMLHttpRequest`, WebSocket and the raw IPC
//! handle are all removed before plugin code runs. Every privileged operation a
//! plugin performs arrives here, and this crate decides whether it is permitted.
//!
//! **The security boundary is this process, not the JavaScript context.** A bug
//! in [`broker`] — a path canonicalised too late, a host pattern matched too
//! loosely — is a sandbox escape. Changes here need adversarial tests covering
//! traversal and symlink escape as a matter of course.
//!
//! What this does *not* protect against is stated plainly in `SECURITY.md`: a
//! plugin sharing the DOM can read the open document and overlay the interface.
//! Capabilities constrain what leaves the machine and what touches the disk.
//!
//! See [ADR-0006](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md).

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod broker;
pub mod capability;
pub mod manifest;

pub use broker::{Broker, DenialRecord, Denied, Request};
pub use capability::Capability;
pub use manifest::{Manifest, Provides, ToolDeclaration, UpdateChannel, UpdateSource, Updates};
