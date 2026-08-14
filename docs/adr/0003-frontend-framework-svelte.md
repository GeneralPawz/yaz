# 0003 — Frontend framework: Svelte 5 + TypeScript

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

[0002](0002-application-shell-tauri.md) puts the user interface in a webview. We
need a component framework for the application shell — panes, sidebars, command
palette, settings, dialogs. It is *not* responsible for the editor surface
(CodeMirror owns its own DOM) or the PDF surface (pdf.js owns its canvas), both
of which are framework-agnostic.

Two constraints shape the choice. Memory and startup time are stated project
goals, which argues against a large runtime. And whatever we pick, we must not
let it leak into the plugin API — a framework choice that plugin authors depend
on is a framework choice we can never revisit.

## Decision

**Svelte 5 with TypeScript**, built by Vite.

Separately and more importantly: **the plugin API exposes DOM elements and a
plain `App` object, never Svelte components, stores, or runes.** A plugin
receives an `HTMLElement` to render into and calls documented methods. It has no
idea Svelte exists.

## Consequences

- Svelte compiles components to direct DOM operations. There is no virtual DOM
  diff at runtime and the framework runtime that ships in the bundle is small —
  the right shape for the startup and memory budgets in [0015](0015-performance-budgets.md).
- Runes give fine-grained reactivity with explicit dependency tracking, which
  keeps large reactive surfaces (a settings tree, a bibliography list of 10,000
  entries) from re-computing wholesale.
- Because the plugin contract is DOM-level, **this decision stays reversible.**
  We could migrate the shell to another framework across a major version without
  breaking a single community plugin. Almost nothing else in this project has
  that property, so we spend our irreversibility budget elsewhere.
- Plugin authors write plain TypeScript and direct DOM code. This is a lower
  ceiling than handing them a component framework, and deliberately so: it is
  what makes the contract stable and the learning curve shallow.
- Svelte's component ecosystem is smaller than React's. For the widgets a
  document editor actually needs — split panes, virtualised lists, tree views —
  we expect to write or vendor a small number rather than install a suite.
- Contributors are more likely to know React than Svelte. Mitigated by the shell
  being a modest fraction of the codebase: the hard work is in Rust and in
  CodeMirror extensions, neither of which is Svelte.

## Alternatives considered

**SolidJS.** Near-identical runtime characteristics and JSX, which some
contributors prefer. Lost on ecosystem size and tooling maturity rather than on
technical merit; this was close, and the DOM-level plugin API means picking
wrong is cheap.

**React.** Largest ecosystem and talent pool. Rejected on runtime weight and
reconciliation overhead, which work directly against a stated project goal. For
an application whose shell is comparatively simple and whose hot paths are
elsewhere, we are paying React's cost without using its strengths.

**No framework — plain TypeScript and DOM.** Tempting given that the two most
complex surfaces manage their own DOM. Rejected because the settings UI, command
palette, and multi-pane workspace involve enough stateful, list-driven rendering
that we would end up writing a worse framework by accident.
