# yaz — working notes for Claude

## What this is

A LaTeX writing environment. Rust core (Tauri v2) + Svelte 5 frontend, bridging
Zotero and Obsidian into publishable papers. Pre-alpha; architecture is decided,
implementation is in progress.

## Read this first

**`docs/adr/` is the authority on why anything is the way it is.** Before
proposing an architectural change, check whether an ADR already decided it. If a
change contradicts an accepted ADR, write a superseding ADR in the same change —
do not silently deviate.

The load-bearing ones:

- **0004** — There is ONE CodeMirror buffer holding the raw `.tex`. Visual mode
  is _decorations over that buffer_, never a second document model. Do not
  introduce ProseMirror or a LaTeX↔document converter.
- **0005** — Three tiers: core / core plugins / community plugins. Core plugins
  (`plugins/`) use only the public `@yaz/api`. **Never add a privileged back door
  for a first-party plugin** — add public API instead. This is the whole point.
- **0006** — Plugins run in the webview with DOM access, but **the security
  boundary is the Rust process**. Every fs/net/process call goes through the
  capability broker in `yaz-plugin`. That code is security-critical.
- **0014** — ARM64 is tier 1. **A dependency without a native aarch64 path is a
  blocker.** Never add an x86_64-only fast path without a NEON or scalar
  equivalent. No ARM64EC.
- **0015** — Performance budgets fail the build. Keystroke latency (<16 ms p99)
  is the one that matters most; **do not put IPC on the keystroke path.**
- **0023** — The preview knows **LaTeX itself** (kernel + standard classes) and
  nothing else. Anything a `\usepackage` adds goes in `yaz-latex-packages`, not
  in `vocabulary.ts`. The test is "does `\documentclass{article}` alone define
  it", never "does a real thesis use it".

## Environment (this machine)

- Windows 11 on **Snapdragon X / ARM64**. Host triple `aarch64-pc-windows-msvc`.
- `CARGO_HOME=D:\packages\cargo` — cargo lives at `D:\packages\cargo\bin`, not
  `~/.cargo`.
- MiKTeX present but **x64, i.e. emulated**. Useful for testing the system-TeX
  engine path; not representative of ARM performance.
- **The ARM64 MSVC toolchain component may be missing.** If linking fails for
  `aarch64-pc-windows-msvc`, install
  `Microsoft.VisualStudio.Component.VC.Tools.ARM64` via the VS Build Tools
  installer. The linker error does not say this.

## Layout

```
crates/     Rust workspace. yaz-app is THIN — wiring only, no domain logic.
apps/       desktop/ = Svelte frontend
packages/   api/ = @yaz/api, the public plugin contract (MIT, semver-strict)
plugins/    Submodules: texyaz/yaz-{zotero,obsidian,formats,learn} (ADR-0021)
docs/       VitePress site + ADRs
locales/    Message catalogues (root-level: both Rust and TS consume them)
themes/     yaz-light, yaz-dark
```

## Conventions that CI enforces

- Conventional Commits with the scopes in `commitlint.config.mjs`. Commit
  subjects become changelog text — write them for users.
- No hardcoded user-facing strings anywhere (i18n keys only).
- No literal colours in components — theme tokens only.
- CSS logical properties (`margin-inline-start`, not `margin-left`) for RTL.
- `#![deny(missing_docs)]` on public Rust items.
- Version numbers are managed by release-please. **Never hand-edit a version.**

## Commands

```bash
git submodule update --init --recursive   # the bundled plugins; the Rust
                                          # build fails without them
pnpm install          # workspace deps
pnpm dev              # run the app (dev mode: no updater, no live registry)
pnpm app:build        # release binary + installer
pnpm test             # frontend tests
pnpm test:rust        # cargo test --workspace
pnpm lint:rust        # clippy, warnings denied
pnpm format           # prettier + cargo fmt
node scripts/check-i18n.mjs   # message-key check (ADR-0011)
```

**Never build the app with `cargo build --release`.** tauri-build defaults to
dev mode without the CLI's environment, so the frontend is not embedded and the
window shows a "cannot reach this page" error. `build.rs` warns about it. Bare
`cargo` is fine for the non-`yaz-app` crates.

**Do not use `--all-features`.** It switches on `tectonic-engine`, whose system
C dependencies are not present, and the failure surfaces as a build-script panic
deep in a dependency.

Use `cargo` from `D:\packages\cargo\bin` if it is not on PATH in a fresh shell.
