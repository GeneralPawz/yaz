<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# Architecture decisions

Every decision that is expensive to reverse, and the reasoning behind it. These
are published rather than kept internal: a plugin author asking why the API is
shaped a particular way should be able to read the answer.

Records are append-only. A reversed decision is superseded by a new record
rather than edited, because the history of a decision we later changed is more
useful than a tidy directory.

| Decision | Status |
| --- | --- |
| [0001 — Record architecture decisions](/adr/0001-record-architecture-decisions) | Accepted |
| [0002 — Application shell: Tauri v2 over Electron and pure-Rust GUI](/adr/0002-application-shell-tauri) | Accepted |
| [0003 — Frontend framework: Svelte 5 + TypeScript](/adr/0003-frontend-framework-svelte) | Accepted |
| [0004 — Editor core: CodeMirror 6 with a single-buffer visual mode](/adr/0004-editor-core-codemirror-single-buffer) | Accepted |
| [0005 — Extensibility tiers: core, core plugins, community plugins](/adr/0005-extensibility-tiers) | Accepted |
| [0006 — Plugin runtime and capability-based security](/adr/0006-plugin-runtime-and-capabilities) | Accepted |
| [0007 — LaTeX compilation: Tectonic by default, system TeX as a peer](/adr/0007-latex-compilation-engines) | Accepted |
| [0008 — Zotero integration strategy](/adr/0008-zotero-integration) | Accepted |
| [0009 — Obsidian integration strategy](/adr/0009-obsidian-integration) | Accepted |
| [0010 — Theming via CSS custom properties and user theme files](/adr/0010-theming) | Accepted |
| [0011 — Localisation from the first commit](/adr/0011-localisation) | Accepted |
| [0012 — Semantic versioning and changelog automation](/adr/0012-versioning-and-changelog) | Accepted |
| [0013 — Update distribution for app and plugins, and dev-mode behaviour](/adr/0013-update-distribution) | Accepted |
| [0014 — Target platforms and the native ARM64 policy](/adr/0014-target-platforms-and-arm64) | Accepted |
| [0015 — Performance budgets enforced in CI](/adr/0015-performance-budgets) | Accepted |
| [0016 — Self-documenting project and the docs site](/adr/0016-documentation-strategy) | Accepted |
| [0017 — Repository layout and monorepo tooling](/adr/0017-repository-layout) | Accepted |
| [0018 — Licensing: AGPL-3.0 application, MIT plugin API](/adr/0018-licensing) | Accepted |
