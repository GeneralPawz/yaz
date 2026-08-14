# <img src="crates/yaz-app/icons/128x128.png" width="28" align="top" alt=""> yaz

[![CI](https://img.shields.io/github/actions/workflow/status/GeneralPawz/yaz/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/GeneralPawz/yaz/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/GeneralPawz/yaz?style=flat-square&logo=github&label=release)](https://github.com/GeneralPawz/yaz/releases/latest)
[![Docs](https://img.shields.io/badge/docs-generalpawz.github.io%2Fyaz-blue?style=flat-square)](https://generalpawz.github.io/yaz/)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux%20%C2%B7%20x86__64%20%7C%20ARM64-lightgrey?style=flat-square)](https://generalpawz.github.io/yaz/reference/generated/platforms)
[![Licence AGPL-3.0](https://img.shields.io/badge/app-AGPL--3.0-orange?style=flat-square)](LICENSE)
[![API MIT](https://img.shields.io/badge/%40yaz%2Fapi-MIT-blue?style=flat-square)](packages/api/LICENSE)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-ff69b4?style=flat-square&logo=githubsponsors)](https://github.com/sponsors/GeneralPawz)

Most LaTeX tools compile `.tex` to PDF and stop there. yaz starts where the
writing actually begins — the references in your Zotero library and the notes in
your Obsidian vault — and carries them through to a manuscript that satisfies a
journal's template.

Rust core, one CodeMirror buffer, TypeScript plugins, and genuinely native on
ARM64 rather than an x86_64 build under emulation.

> [!WARNING]
> **Pre-alpha.** The architecture is decided and recorded; the application is
> being built. There are no released binaries yet — see [Status](#status-) for
> what actually works today.

## Write however you think ✍️

A **source mode** with syntax highlighting, autocompletion, line numbers and
diagnostics, and a **visual mode** that renders the document as rich text.

They are the *same editor over the same buffer*. That is the whole trick: the
buffer always holds your real `.tex`, and visual mode is decorations drawn over
it rather than a second document model.

| Because of that | You get |
| --- | --- |
| One editor instance | Vim keybindings work in **both** modes, not implemented twice |
| No conversion step | Switching modes cannot change a byte of your file |
| One undo stack | Mode switches preserve history and cursor position |
| One plugin surface | An editor plugin works in both modes without knowing modes exist |

Unknown macros from a conference template degrade to plain source instead of
crashing a converter.
[Why it is built this way](https://generalpawz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer).

## Zotero, without the friction 📚

Live library search and cite-as-you-write through Better BibTeX, falling back
through Zotero's local API, a watched `.bib` export, and finally a read-only copy
of the library database.

The active source is always shown, because silently serving a stale library is a
correctness problem in a citation tool, not a graceful fallback.

> [!IMPORTANT]
> The project `.bib` stays the compile-time source of truth. Your document still
> builds on a co-author's machine that has never heard of Zotero — and in CI, and
> at the publisher.

## Obsidian, without a plugin 🔗

A vault is a folder of Markdown, so yaz reads it directly. No companion plugin,
and Obsidian need not be running — which also means it works with any Markdown
vault, not just Obsidian's.

Wikilinks, embeds, callouts and frontmatter map to LaTeX through a mapping file
**you** can edit, because everyone's vault conventions differ. Vaults are
read-only by default: yours is years of work, and this will not be the tool that
mangles it.

## Templates that just work 📄

Two engines, neither a fallback for the other:

| Engine | Good for | Cost |
| --- | --- | --- |
| **Tectonic**, embedded | Installing nothing; native on every architecture | XeTeX-based, so it cannot be `pdflatex` |
| **System TeX** (TeX Live, MiKTeX) | Templates demanding `pdflatex` or `lualatex` | Needs a distribution, often a gigabyte or more |

The choice is per project and stored in `yaz.toml`, so a co-author who opens your
project compiles the same way you do. Engines are **refused, never substituted** —
a silently different engine produces a subtly different PDF, and discovering that
after submission is worse than an error message.
[Choosing an engine](https://generalpawz.github.io/yaz/guide/engines).

## Extensible, and honest about it 🧩

Plugins are TypeScript: `manifest.json` plus a `main.js`. No compiler, no
per-architecture artefacts.

Unlike the tools that inspired this, a plugin has **no ambient authority** — every
filesystem, network and subprocess call is brokered by the Rust core against the
capabilities you granted.

> [!CAUTION]
> Capabilities constrain what leaves your machine and what touches your disk.
> They do **not** isolate a plugin from the application's interface — a plugin
> sharing the DOM can read the open document. That is by design, and saying so
> plainly beats a vague promise. Install plugins you trust.

yaz's own Zotero bridge, Obsidian bridge and Vim mode are **core plugins** on the
exact public API you get, with no back doors. If a core plugin needs something
that does not exist, the answer is new *public* API.
[Writing a plugin](https://generalpawz.github.io/yaz/plugins/writing-a-plugin).

## Actually native on ARM 🦾

Windows and Linux on ARM64 are **tier-1** targets: built and tested on native ARM
runners, never cross-compiled and never under emulation. A dependency without a
native `aarch64` path is a blocker, not a caveat, and performance budgets are
measured on ARM64 too — a budget met only on x86_64 is not met.

## Status 📍

| Phase | Goal | |
| --- | --- | --- |
| 1 | Architecture decided and recorded, repository, CI, release automation | ✅ |
| 2 | Walking skeleton — open a folder, edit a `.tex`, compile, see the PDF | ✅ |
| 3 | Plugin runtime, capability broker, theme engine, i18n runtime | next |
| 4 | Editor depth — Lezer grammar, completion, diagnostics, Vim, visual mode | |
| 5 | Zotero and Obsidian bridges | |
| 6 | Templates, export, community registry | |

**Works today:** open a folder, edit `.tex` files with line numbers, LaTeX
highlighting and optional Vim keys, save, choose an engine, compile, and read the
PDF beside your source.

**Does not exist yet:** visual mode, plugins, user themes, and the Zotero and
Obsidian bridges.

Phase 3 comes before feature work deliberately — every feature after it is built
*on* the plugin API, the theme tokens and the message catalogue, rather than
retrofitted onto them.

## Building from source 🔨

Requires **Rust 1.85+**, **Node 22+** and **pnpm 9+**.

```bash
git clone https://github.com/GeneralPawz/yaz.git
cd yaz
pnpm install
pnpm dev           # run it
pnpm app:build     # release binary + installer
```

> [!CAUTION]
> **Do not build the app with `cargo build --release`.** It produces a binary
> whose window shows the webview's *"cannot reach this page"* error, and nothing
> in that message suggests a build problem — `tauri-build` defaults to
> development mode without the Tauri CLI's environment, so the frontend is never
> embedded. Plain `cargo` is fine for every other crate.

On Windows-on-ARM there are two toolchain traps whose error messages never
mention ARM64. Both are documented, with the exact commands, in
[development setup](https://generalpawz.github.io/yaz/contributing/setup).

## Documentation 📖

| Page | What is in it |
| --- | --- |
| [Getting started](https://generalpawz.github.io/yaz/guide/getting-started) | Build it, open a folder, compile your first document |
| [Choosing an engine](https://generalpawz.github.io/yaz/guide/engines) | Tectonic vs system TeX, and why a choice is never silently substituted |
| [Writing a plugin](https://generalpawz.github.io/yaz/plugins/writing-a-plugin) | The API, the manifest, capabilities, and what they do not protect against |
| [Capability reference](https://generalpawz.github.io/yaz/reference/generated/capabilities) | Every privileged thing a plugin can ask for — generated from the code |
| [Development setup](https://generalpawz.github.io/yaz/contributing/setup) | Platform prerequisites, including the ARM64 Windows traps |
| [Decision records](https://generalpawz.github.io/yaz/reference/generated/adr-index) | Why anything is the way it is |

## Why the decisions are published 🔍

A plugin author asking *why is the API shaped like this* should be able to read
the answer rather than guess. So the reasoning is documentation, not an internal
artefact — including the decisions that turned out to be **wrong**.

ADR-0002 predicted 60–120 MB of memory. Measurement said 384 MB. That correction
is [in the record](https://generalpawz.github.io/yaz/adr/0015-performance-budgets),
with the numbers, the method, and what it does and does not change. Records are
append-only: a reversed decision is superseded, never quietly edited.

## Contributing 🤝

Read [CONTRIBUTING.md](CONTRIBUTING.md) and skim the
[decision records](https://generalpawz.github.io/yaz/reference/generated/adr-index).
A change contradicting an accepted ADR needs a superseding ADR in the same pull
request, not a quiet deviation.

Questions, ideas, and showing off what you have built are welcome in
[Discussions](https://github.com/GeneralPawz/yaz/discussions). Bugs go to
[Issues](https://github.com/GeneralPawz/yaz/issues).

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) —
enforced, and it drives versioning and the changelog automatically.

## Funding 💸

yaz is free and always will be. It runs entirely on your machine, sends your
manuscripts nowhere, and takes no cut of anything.

If it saves you an afternoon of fighting a journal template and you would like to
send something back, [sponsorship is welcome](https://github.com/sponsors/GeneralPawz)
and entirely optional. Bug reports, translations and pull requests are worth just
as much.

## Licence ⚖️

The application is **AGPL-3.0-or-later**. `@yaz/api` and the plugin template are
**MIT**, so plugins may be licensed however their authors choose — including
proprietary. Documentation is **CC BY-SA 4.0**.

There is **no CLA**; contributions are made under the licence of the files they
touch, certified with a [DCO](https://developercertificate.org/) sign-off.

What the AGPL buys, precisely: nobody can ship a closed-source fork, and nobody
can run yaz as a hosted service without publishing their changes. It does *not*
forbid selling copies — it forbids selling them closed. The reasoning, and the
alternatives rejected, are in
[ADR-0018](https://generalpawz.github.io/yaz/adr/0018-licensing).
