//! The yaz desktop application binary.
//!
//! This crate is intentionally thin. It wires the domain crates to the Tauri
//! command surface and owns no domain logic, so that everything meaningful stays
//! testable without a running application and reusable by a future CLI or
//! language server ([ADR-0017]).
//!
//! [ADR-0017]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0017-repository-layout.md

#![deny(unsafe_code)]
#![warn(clippy::all)]

use std::process::ExitCode;

/// True when running in development mode.
///
/// Dev mode never contacts the update server or the live plugin registry, and
/// loads unpacked plugins from `dev-plugins/` with hot reload. Signature
/// verification is **not** relaxed — disabling it on the path developers
/// exercise daily is how it ends up disabled in a release build
/// ([ADR-0013](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0013-update-distribution.md)).
fn is_dev_mode() -> bool {
    cfg!(debug_assertions) || std::env::var_os("YAZ_DEV").is_some()
}

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("YAZ_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        arch = std::env::consts::ARCH,
        os = std::env::consts::OS,
        dev_mode = is_dev_mode(),
        "yaz starting"
    );

    // Phase 1 scaffold: the architecture is decided and the crate boundaries
    // exist. Phase 2 builds the walking skeleton — open a folder, edit a .tex,
    // compile it, show the PDF — and replaces this with the Tauri runtime.
    eprintln!(
        "yaz {} ({} on {}) — pre-alpha scaffold, no UI yet.",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
        std::env::consts::OS,
    );
    eprintln!("See docs/adr/ for the architecture, and the roadmap in README.md.");

    ExitCode::SUCCESS
}
