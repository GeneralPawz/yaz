# Architecture Decision Records

Every decision that is expensive to reverse lives here. If a future contributor
would reasonably ask "why on earth is it done *this* way", the answer belongs in
an ADR, not in a commit message and not in someone's head.

## Format

We use a trimmed [MADR](https://adr.github.io/madr/) layout. Copy
[`template.md`](template.md) and give it the next free number.

## Status values

| Status | Meaning |
| --- | --- |
| `Proposed` | Written down, not yet agreed. Do not build on it. |
| `Accepted` | In force. Code is expected to comply. |
| `Deprecated` | Still true of the code, but we intend to change it. |
| `Superseded by NNNN` | No longer in force. Kept for the historical record. |

**ADRs are append-only.** We never delete or rewrite the reasoning of an accepted
ADR; we supersede it with a new one that explains what changed. The record of a
decision we later reversed is more valuable than a tidy directory.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-application-shell-tauri.md) | Application shell: Tauri v2 over Electron and pure-Rust GUI | Accepted |
| [0003](0003-frontend-framework-svelte.md) | Frontend framework: Svelte 5 + TypeScript | Accepted |
| [0004](0004-editor-core-codemirror-single-buffer.md) | Editor core: CodeMirror 6 with a single-buffer visual mode | Accepted |
| [0005](0005-extensibility-tiers.md) | Extensibility tiers: core, core plugins, community plugins | Accepted |
| [0006](0006-plugin-runtime-and-capabilities.md) | Plugin runtime and capability-based security | Accepted |
| [0007](0007-latex-compilation-engines.md) | LaTeX compilation: Tectonic by default, system TeX as a peer | Accepted |
| [0008](0008-zotero-integration.md) | Zotero integration strategy | Accepted |
| [0009](0009-obsidian-integration.md) | Obsidian integration strategy | Accepted |
| [0010](0010-theming.md) | Theming via CSS custom properties and user theme files | Accepted |
| [0011](0011-localisation.md) | Localisation from the first commit | Accepted |
| [0012](0012-versioning-and-changelog.md) | Semantic versioning and changelog automation | Accepted |
| [0013](0013-update-distribution.md) | Update distribution for app and plugins, and dev-mode behaviour | Accepted |
| [0014](0014-target-platforms-and-arm64.md) | Target platforms and the native ARM64 policy | Accepted |
| [0015](0015-performance-budgets.md) | Performance budgets enforced in CI | Accepted |
| [0016](0016-documentation-strategy.md) | Self-documenting project and the docs site | Accepted |
| [0017](0017-repository-layout.md) | Repository layout and monorepo tooling | Accepted |
| [0018](0018-licensing.md) | Licensing: AGPL-3.0 app, MIT plugin API | Accepted |
| [0019](0019-tls-trust-store.md) | TLS trust: the OS store, bundled roots as fallback | Accepted |
| [0020](0020-stitched-multi-file-editing.md) | Edit a multi-file document as one, behind a mode | Accepted |
