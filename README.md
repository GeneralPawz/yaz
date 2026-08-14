<div align="center">

# yaz

**A modern LaTeX writing environment that turns collected ideas and sources into papers.**

Rust core · Tauri v2 · Svelte 5 · CodeMirror 6 · native on x86_64 and ARM64

[Documentation](https://generalpawz.github.io/yaz) ·
[Architecture decisions](docs/adr/) ·
[Contributing](CONTRIBUTING.md)

</div>

---

> **Status: pre-alpha.** The architecture is decided and recorded; the
> application is being built. Nothing here is usable yet. See the
> [roadmap](#roadmap).

## What this is

Most LaTeX tools compile `.tex` to PDF and stop there. yaz starts from where the
writing actually begins — the references in your Zotero library and the notes in
your Obsidian vault — and carries them through to a manuscript that satisfies a
journal's template.

**Write however you think.** A source mode with syntax highlighting,
autocompletion, line numbers, and diagnostics; and a visual mode that renders the
document as rich text. They are the *same editor over the same buffer*, so Vim
keybindings work in both, undo history is shared, and switching modes cannot
change a byte of your file. See
[ADR-0004](docs/adr/0004-editor-core-codemirror-single-buffer.md).

**Zotero, without the friction.** Live library search and cite-as-you-write via
Better BibTeX when Zotero is running, falling back through the local API, an
exported `.bib`, and finally a read-only copy of the library database. The
project `.bib` stays the compile-time source of truth, so your document builds on
a co-author's machine that has never heard of Zotero.
([ADR-0008](docs/adr/0008-zotero-integration.md))

**Obsidian, without a plugin.** A vault is a folder of Markdown, so yaz reads it
directly — no companion plugin, Obsidian need not be running. Wikilinks,
embeds, callouts, and frontmatter map to LaTeX through a mapping file *you* can
edit, because everyone's vault conventions are different.
([ADR-0009](docs/adr/0009-obsidian-integration.md))

**Journal templates that just work.** Tectonic is embedded, so a fresh install
compiles with no TeX distribution and no missing-package archaeology. When a
template demands `pdflatex` or `lualatex`, yaz detects your system TeX Live or
MiKTeX and uses it. ([ADR-0007](docs/adr/0007-latex-compilation-engines.md))

**Extensible like the tools you already use.** Plugins are TypeScript —
`manifest.json` plus a `main.js`, installed from GitHub or from a file. Unlike
the tools that inspired this, plugins declare their capabilities and every
filesystem, network, and subprocess call is brokered by the Rust core against
what you granted. ([ADR-0006](docs/adr/0006-plugin-runtime-and-capabilities.md))

**Yours to look at.** Light and dark themes by default, and a CSS file of your
own if you want something else, hot-reloaded as you write it.
([ADR-0010](docs/adr/0010-theming.md))

**Actually native on ARM.** Not an x86_64 build under emulation. Windows ARM64
and Linux ARM64 are tier-1 targets, built and tested on native ARM CI runners,
with performance budgets enforced on both architectures.
([ADR-0014](docs/adr/0014-target-platforms-and-arm64.md))

## Architecture at a glance

```
┌──────────────────────── webview (Svelte 5 + TypeScript) ────────────────────────┐
│  workspace · command palette · settings · themes                                │
│  ┌───────────────────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ CodeMirror 6              │  │ pdf.js       │  │ plugins (TS)              │ │
│  │ one .tex buffer           │  │ + SyncTeX    │  │ core + community,          │ │
│  │ source ⇄ visual = decor.  │  │              │  │ no ambient authority      │ │
│  └───────────────────────────┘  └──────────────┘  └───────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────────────────┘
                        IPC — batched, never on the keystroke path
┌────────────────────────────────────┴────────────────────────────────────────────┐
│  Rust core          ← the security boundary; all privileged work lives here      │
│  yaz-core · yaz-latex · yaz-compile · yaz-plugin · yaz-zotero · yaz-obsidian     │
│  file I/O · project index (tree-sitter) · Tectonic / system TeX · capability     │
│  broker · updater                                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Three extensibility tiers, and the rule that keeps the plugin API honest: **our
own Zotero bridge, Obsidian bridge, and Vim mode are core *plugins*, built on the
exact public API a community author gets, with no privileged access.**
([ADR-0005](docs/adr/0005-extensibility-tiers.md))

## Roadmap

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Architecture decided and recorded, repository, CI, release automation | ✅ done |
| 2 | Walking skeleton — open a folder, edit a `.tex`, compile, see the PDF | in progress |
| 3 | Plugin runtime, capability broker, theme engine, i18n runtime | |
| 4 | Editor depth — Lezer grammar, completion, diagnostics, Vim, visual mode | |
| 5 | Zotero and Obsidian bridges | |
| 6 | Templates, export, community registry | |

Phase 3 comes before feature work deliberately: every feature after it is built
on the public plugin API, the theme tokens, and the message catalogue, rather
than retrofitted onto them.

## Building from source

Requires **Rust 1.85+**, **Node 22+**, and **pnpm 9+**. On Windows-on-ARM you
also need the ARM64 MSVC toolchain — see
[docs/contributing/setup.md](docs/contributing/setup.md), it is not installed by
default and the error it produces is not self-explanatory.

```bash
git clone https://github.com/GeneralPawz/yaz.git
cd yaz
pnpm install
pnpm tauri dev
```

Development mode never contacts the update server or the live plugin registry.
([ADR-0013](docs/adr/0013-update-distribution.md))

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and skim the
[ADRs](docs/adr/) — they record why things are the way they are, and a change
that contradicts one needs a new ADR rather than a new pull request.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/); this
is enforced, and it drives versioning and the changelog automatically.

## Licence

The application is **AGPL-3.0-or-later**. The plugin API package
(`packages/api`) and the plugin template are **MIT**, so plugins may be licensed
however their authors choose — including proprietary. Documentation is
**CC BY-SA 4.0**.

There is **no CLA**; contributions are made under the licence of the files they
touch, certified with a [DCO](https://developercertificate.org/) `Signed-off-by`
line.

What the AGPL buys, precisely: nobody can ship a closed-source fork of yaz, and
nobody can run it as a hosted service without publishing their changes. It does
*not* forbid selling copies — it forbids selling them closed. The reasoning, and
the alternatives that were rejected, are in
[ADR-0018](docs/adr/0018-licensing.md).
