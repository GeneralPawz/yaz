# @yaz/desktop

The application shell: workspace panes, command palette, settings, theme
application, and the hosts for the two surfaces that manage their own DOM —
CodeMirror and pdf.js.

## What belongs here, and what does not

This package is Svelte. **The plugin API is not.** `@yaz/api` exposes
`HTMLElement`s and plain objects, never Svelte components, stores, or runes —
which is what allows this shell to be rebuilt on a different framework without
breaking a single community plugin
([ADR-0003](../../docs/adr/0003-frontend-framework-svelte.md)).

Nothing here may put IPC on the keystroke path. The editor buffer is
authoritative for editing and lives in this process; Rust does filesystem,
compilation and indexing work asynchronously and in batches
([ADR-0015](../../docs/adr/0015-performance-budgets.md)).

## Structure (phase 2 onward)

```
src/
├── shell/      Panes, tabs, command palette, settings — Svelte
├── editor/     CodeMirror host, Lezer LaTeX, visual-mode decorations, Vim host
├── pdf/        pdf.js host, SyncTeX wiring
├── plugins/    Plugin runtime: loading, lifecycle, the scrubbed global scope
├── theme/      Token application, hot reload
└── i18n/       Catalogue loading, message resolution
```

Editor extensions registered by plugins work in **both** source and visual mode
without knowing modes exist, because there is one buffer and visual mode is
decorations over it
([ADR-0004](../../docs/adr/0004-editor-core-codemirror-single-buffer.md)).
