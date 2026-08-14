//! The yaz desktop application binary.
//!
//! This crate is intentionally thin. It wires the domain crates to the Tauri
//! command surface and owns no domain logic, so that everything meaningful stays
//! testable without a running application and reusable by a future CLI or
//! language server ([ADR-0017]).
//!
//! [ADR-0017]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0017-repository-layout.md

// Release builds are GUI binaries: without this, launching yaz from Explorer
// also opens a console window behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(unsafe_code)]
#![warn(clippy::all)]

mod commands;

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

fn main() {
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

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::read_file,
            commands::write_file,
            commands::compile_project,
            commands::available_engines,
            commands::read_artefact,
        ])
        .setup(|_app| {
            if is_dev_mode() {
                tracing::warn!("development mode: updater and live plugin registry are disabled");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the yaz application");
}
