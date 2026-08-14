//! The one place an HTTP client is constructed.
//!
//! Everything that talks to the network — the Zotero bridge, the plugin
//! registry, update checks — goes through [`http_client`], so the TLS trust
//! policy in
//! [ADR-0019](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0019-tls-trust-store.md)
//! has exactly one implementation rather than one per caller.
//!
//! # The policy
//!
//! Trust the **operating system's** certificate store, falling back to the
//! bundled Mozilla roots only when the platform store is unavailable.
//!
//! The OS store is what makes yaz work on a university or corporate network.
//! Those networks routinely intercept TLS, which works by installing a custom
//! root CA into the system store; software carrying its own roots never sees it
//! and every request fails. It also means an administrator who *distrusts* a CA
//! is honoured, which bundled roots cannot do.
//!
//! The fallback exists for minimal Linux containers, where the store may
//! genuinely not exist. Failing every request there would be worse than using
//! Mozilla's list.
//!
//! # Why this is not simply "enable both features"
//!
//! reqwest enables each root source independently and merges them, so turning on
//! both `rustls-tls-native-roots` and `rustls-tls-webpki-roots` would trust the
//! **union** of the OS store and Mozilla's list. That looks like a safe
//! superset and quietly destroys half the point: a CA the administrator removed
//! would still be trusted through the bundled copy.
//!
//! So both are compiled in, and exactly one is switched on per client.

use std::sync::OnceLock;

/// Which root source a client was built against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustRoots {
    /// The operating system's certificate store. The normal case.
    Platform,
    /// Mozilla's bundled roots, because the platform store was unusable.
    Bundled,
}

impl TrustRoots {
    /// Stable identifier for logs and diagnostics.
    ///
    /// A TLS bug report is not reproducible without knowing which source was
    /// used, so this belongs in any diagnostic output.
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustRoots::Platform => "platform",
            TrustRoots::Bundled => "bundled",
        }
    }
}

/// Whether the platform certificate store yielded anything usable.
///
/// Probed once and cached: reading the store is not free, and the answer cannot
/// meaningfully change while the process runs.
fn platform_roots_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let result = rustls_native_certs::load_native_certs();

        // Partial failure is normal — some stores contain entries that cannot be
        // parsed — and is not a reason to abandon the platform store. What
        // matters is whether any usable roots came back.
        if !result.errors.is_empty() {
            tracing::debug!(
                errors = result.errors.len(),
                certs = result.certs.len(),
                "some platform certificates could not be loaded"
            );
        }

        let available = !result.certs.is_empty();
        if !available {
            tracing::warn!(
                "platform certificate store is empty or unreadable; \
                 falling back to the bundled roots (see ADR-0019)"
            );
        }
        available
    })
}

/// Which roots [`http_client`] will use on this machine.
pub fn trust_roots() -> TrustRoots {
    if platform_roots_available() {
        TrustRoots::Platform
    } else {
        TrustRoots::Bundled
    }
}

/// Build an HTTP client following the trust policy above.
///
/// Callers should build one client and reuse it; reqwest pools connections, and
/// constructing a client per request discards that pooling along with the TLS
/// session cache.
pub fn http_client() -> reqwest::Result<reqwest::Client> {
    let roots = trust_roots();
    let platform = roots == TrustRoots::Platform;

    tracing::debug!(roots = roots.as_str(), "building HTTP client");

    reqwest::ClientBuilder::new()
        .use_rustls_tls()
        // Exactly one of these is true. Leaving both on would trust the union
        // of the two root sets, which is the failure mode this module exists to
        // avoid.
        .tls_built_in_native_certs(platform)
        .tls_built_in_webpki_certs(!platform)
        .user_agent(concat!("yaz/", env!("CARGO_PKG_VERSION")))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_can_be_built_on_this_machine() {
        assert!(http_client().is_ok());
    }

    #[test]
    fn the_root_source_is_reported() {
        // Which source is correct depends on the machine, but it must be one of
        // them and it must be nameable — a TLS failure is not diagnosable
        // without knowing which roots were in play.
        let roots = trust_roots();
        assert!(matches!(roots, TrustRoots::Platform | TrustRoots::Bundled));
        assert!(!roots.as_str().is_empty());
    }

    #[test]
    fn the_probe_is_stable_within_a_process() {
        // Cached, so repeated calls must agree; a client built now and one built
        // later must not disagree about what they trust.
        assert_eq!(trust_roots(), trust_roots());
    }
}
