fn main() {
    // `cargo build --release` on its own does NOT produce a shippable binary.
    //
    // tauri-build distinguishes dev from production using environment set by the
    // Tauri CLI. Invoked bare, it defaults to dev: `devUrl` is baked in and
    // `frontendDist` is never embedded, so the exe opens a window pointing at a
    // Vite server that is not running and the user sees the webview's "cannot
    // reach this page" error. That reads as an application bug rather than a
    // build mistake, which is why it is worth warning about here.
    //
    // The signal is the presence of *any* TAURI_* variable rather than a
    // specific one. Measured at build-script time, `cargo build` sees none at
    // all, while the CLI sets TAURI_CLI_VERBOSITY among others. Note that
    // TAURI_ENV_TARGET_TRIPLE — the obvious candidate — is *not* set this early,
    // so keying on it produces a false warning on the correct build path, which
    // is worse than having no guard at all.
    println!("cargo:rerun-if-env-changed=TAURI_CLI_VERBOSITY");

    let is_release = std::env::var("PROFILE").as_deref() == Ok("release");
    let via_tauri_cli = std::env::vars().any(|(key, _)| key.starts_with("TAURI_"));

    if is_release && !via_tauri_cli {
        println!(
            "cargo:warning=Building yaz-app in release without the Tauri CLI. This produces a \
             DEV binary that loads the Vite dev server and shows a blank 'cannot reach this \
             page' window. Use `pnpm app:build` instead — see docs/contributing/setup.md."
        );
    }

    tauri_build::build();
}
