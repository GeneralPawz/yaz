//! The capability broker — the enforcement point.
//!
//! Every privileged request from a plugin passes through [`Broker::authorise`].
//! There is no other path to the filesystem, the network, or a subprocess.
//!
//! # Invariants
//!
//! These are the properties the broker must hold. Each has a corresponding
//! adversarial test, and a change here without one should not be merged.
//!
//! 1. **Canonicalise before deciding.** A path is fully resolved — `..`
//!    components collapsed, symlinks followed — *before* it is compared against
//!    any root. Checking the requested path rather than the resolved one is the
//!    classic traversal escape.
//! 2. **Hosts are matched, not logged.** A network request to an undeclared host
//!    is refused, not permitted-with-a-warning.
//! 3. **Deny by default.** An unrecognised or malformed request is refused.
//! 4. **Every denial is recorded** in a log the user can inspect, attributed to
//!    the requesting plugin.
//!
//! See [ADR-0006](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md).

use crate::capability::Capability;

/// Why a request was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Denied {
    /// The plugin never declared the capability in its manifest.
    #[error("plugin did not declare this capability")]
    NotDeclared,
    /// Declared, but the user has not granted it or has revoked it.
    #[error("capability declared but not granted by the user")]
    NotGranted,
    /// Declared and granted, but the specific target is outside its scope —
    /// a path outside the granted root, or an undeclared host.
    #[error("request is outside the granted scope of this capability")]
    OutOfScope,
}

/// Enforces capabilities for a single plugin.
#[derive(Debug)]
pub struct Broker {
    /// The plugin this broker serves.
    pub plugin_id: String,
    /// Capabilities the user has granted, which is the intersection of what the
    /// manifest declared and what the user approved.
    pub granted: Vec<Capability>,
}

// TODO(phase-3): authorise(), canonicalising path checks, host matching,
// the denial audit log, and the adversarial test suite the invariants require.
