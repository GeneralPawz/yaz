# Development setup

## Requirements

| Tool | Version | Needed for |
| --- | --- | --- |
| Rust | 1.85+ (edition 2024) | Everything in `crates/` |
| Node | 22+ | `apps/`, `packages/`, `plugins/`, `docs/` |
| pnpm | 9+ | Workspace management |

A contributor working only on Rust does not need Node, and vice versa. The
targets in `rust-toolchain.toml` are installed automatically by rustup on first
build.

```bash
git clone https://github.com/GeneralPawz/yaz.git
cd yaz
pnpm install
pnpm dev           # dev mode: no updater, no live plugin registry
```

## Building the application

> **Do not build the app with `cargo build --release`.** It produces a binary
> that opens a window showing the webview's *"cannot reach this page"* error, and
> nothing about the message suggests a build problem.
>
> `tauri-build` distinguishes dev from production using environment the Tauri CLI
> sets. Run bare, it defaults to **dev**: `devUrl` is compiled in and
> `frontendDist` is never embedded, so the binary looks for a Vite dev server
> that is not running. `crates/yaz-app/build.rs` prints a warning when it detects
> this, but cargo warnings are easy to miss in a long build.

```bash
pnpm app:build     # tauri build — embeds the frontend, produces an installer
pnpm dev           # tauri dev — hot reload against the Vite server
```

`cargo build` is still the right tool for the Rust crates on their own — it is
only `yaz-app` that needs the CLI.

Both commands run from the **repository root**, not from `apps/desktop`. The
Tauri config lives at `crates/yaz-app/tauri.conf.json`
([ADR-0017](../adr/0017-repository-layout.md)) and the CLI locates it by
searching downward from the working directory.

To confirm a binary is a production build, put a listener on the dev port and
check that it is never contacted:

```powershell
$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 5173); $l.Start()
Start-Process target\release\yaz.exe
# a production binary never connects; a dev binary does
```

## Platform prerequisites

### Windows on ARM64 — read this first

**The ARM64 MSVC toolchain is not installed by default, even on an ARM64
machine.** Visual Studio installs the x64 and x86 target libraries; the ARM64
ones are a separate component. Without it every build fails with:

```
LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'
```

which does not mention ARM64 and sends people looking at the Windows SDK. The
SDK is usually fine — check `Program Files (x86)\Windows Kits\10\Lib\<ver>\um\`
for an `arm64` directory. The missing piece is the **MSVC CRT**: look under
`…\VC\Tools\MSVC\<ver>\lib\` and if you see only `x64`, `x86`, and `onecore`,
this is your problem.

Note that this blocks *all* builds on an ARM64 host, including cross-compiling
to x86_64 — build scripts and proc-macro crates are compiled for the host.

Fix, from an **elevated** terminal:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override `
  "--add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --quiet --norestart"
```

Or, against an existing install:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe" `
  modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" `
  --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --quiet --norestart
```

Verify by re-checking that `…\VC\Tools\MSVC\<ver>\lib\arm64` now exists, then:

```powershell
cargo check --workspace
```

You also need the **WebView2 runtime**, which ships with Windows 11 — including
the native ARM64 build, so nothing is emulated
([ADR-0014](../adr/0014-target-platforms-and-arm64.md)).

### Windows on x86_64

Visual Studio Build Tools with "Desktop development with C++", plus the WebView2
runtime.

### Linux

```bash
# Debian / Ubuntu
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel

# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  libappindicator-gtk3 librsvg
```

Identical on aarch64 — every one of these has a native ARM64 build.

## LaTeX

You do not need a TeX distribution. Tectonic is embedded and is the default
engine ([ADR-0007](../adr/0007-latex-compilation-engines.md)).

A system TeX Live or MiKTeX is useful for exercising the *other* engine path,
which is the one journal templates requiring `pdflatex` or `lualatex` use. On
Windows-on-ARM be aware that MiKTeX is typically an x64 build running under
emulation — fine for correctness testing, meaningless for performance numbers.

## Verifying a change

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features

pnpm check          # types
pnpm lint           # includes the i18n and theme-token rules
pnpm test
```

CI additionally runs the performance budgets
([ADR-0015](../adr/0015-performance-budgets.md)) on native x86_64 **and** ARM64
runners. A budget met only on x86_64 is not met, and contributors on x86_64
machines cannot verify the ARM64 side locally — CI is the authority there.

## Working on a plugin

Core plugins in `plugins/` build against `@yaz/api` exactly as a third-party
plugin does; they have no privileged access
([ADR-0005](../adr/0005-extensibility-tiers.md)).

For an out-of-tree plugin, drop it in `dev-plugins/` and it loads unpacked with
hot reload in dev mode. `packages/plugin-template` is the starting point.
