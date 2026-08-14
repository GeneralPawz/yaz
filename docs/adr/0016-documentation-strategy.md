# 0016 — Self-documenting project and the docs site

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

yaz has three documentation audiences with incompatible needs: **users** (how do
I do this), **plugin authors** (what exactly does this API do and what does it
guarantee), and **contributors** (how is this built and why).

The requirement is that the project be self-documenting as far as possible, so
that publishing to GitHub Pages is cheap. The word that matters is *possible* —
hand-written prose cannot be generated, and generated API dumps are not a user
manual. The distinction worth drawing is between documentation that **restates
facts already in the code**, which must be generated because hand-maintained
copies always drift, and documentation that **explains intent**, which must be
written.

The reliably-wrong documentation in an application like this is the enumerable
kind: the list of commands, the list of settings, the list of keyboard shortcuts,
the capability vocabulary. These change constantly and hand-written copies are
wrong within a month.

## Decision

**A VitePress site in `docs/`, published to GitHub Pages by CI, in which
everything enumerable is generated from the code at build time and everything
explanatory is written by hand.**

### Generated — never hand-written

| Content | Source |
| --- | --- |
| Command reference | The command registry, dumped to JSON at build |
| Settings reference | The settings schema, including defaults and types |
| Keyboard shortcut reference | The default keymap, per platform |
| Capability reference | The capability enum in `yaz-plugin` |
| Plugin API reference | TypeDoc over `@yaz/api` |
| Rust internals reference | `cargo doc` over the workspace, published under `/rust/` |
| Theme token reference | The CSS custom property contract |
| Supported platform matrix | The CI build matrix |
| Changelog | release-please ([0012](0012-versioning-and-changelog.md)) |
| Performance trends | Benchmark results ([0015](0015-performance-budgets.md)) |

The mechanism: the application exposes a `--dump-docs` mode emitting its
registries as JSON, and the docs build consumes it. The registries already exist
because the application needs them at runtime — we are publishing them, not
maintaining a second copy.

**A generated page is never edited by hand**, and CI fails if a generated file is
dirty in the working tree, which is what stops someone "fixing" a generated page
and having it silently reverted.

### Written by hand

User guide, plugin author guide, theme author guide, contributor setup, the
security model, and the ADRs. These explain intent and cannot be derived.

### Rules

- **The ADRs are published**, not internal. A plugin author asking why the API is
  shaped this way should be able to read the answer ([0001](0001-record-architecture-decisions.md)).
- **Every public Rust item and every exported `@yaz/api` symbol carries a doc
  comment**, enforced by `#![deny(missing_docs)]` and a TypeDoc coverage check.
  For `@yaz/api` this is the primary documentation, so the standard is high:
  what it does, what it guarantees, what it may throw, which capability it needs.
- **`@yaz/api` doc comments carry runnable examples**, tested in CI. An example
  that does not compile is worse than none.
- **Docs are versioned with the application.** A user on 1.2 reads the 1.2 docs.
  This matters most for the plugin API, where "which version added this" is a
  question authors ask constantly, so every API entry carries a `@since` tag.
- Documentation changes ship in the same pull request as the code. A feature
  without docs is incomplete, and CI checks that a new command or setting has a
  description string — which is what the generated reference renders.
- The site is **searchable offline-capable static output**, no external service.

## Consequences

- The reference documentation cannot drift, because there is no second copy of
  the facts.
- Publishing is a CI job, so the docs site is never stale relative to `main`.
- Adding a command or setting produces documentation automatically, which lowers
  the cost of doing it properly.
- The generation pipeline is machinery to build and maintain, and a broken
  generator breaks the docs build.
- `deny(missing_docs)` and description strings on every command are friction on
  every change. Deliberate: it is what makes the generated output worth reading.
- Generated reference is only as good as the doc comments. A description of
  `"Toggles the thing"` generates a useless page, and review is the only defence.
- Versioned docs mean maintaining published output for released versions, which
  grows over time and needs a retention policy.

## Alternatives considered

**mdBook.** Rust-native, simple, good output. Rejected because the primary
documentation audience beyond users is plugin authors writing TypeScript, and
integrating TypeDoc output into a Vite/TypeScript-native site is markedly easier.
`cargo doc` output is published alongside regardless.

**Docusaurus.** More capable, strong versioning and i18n. Rejected as heavier
than needed and slower to build, for features VitePress covers adequately.

**A hand-written wiki.** Rejected: not in the repository, not reviewed with the
code, and drifts immediately — which is the specific failure this ADR exists to
prevent.

**Generated API reference only, no prose.** Cheapest. Rejected because a
reference tells you what exists and never how to build a plugin, and the
onboarding guide is what determines whether an ecosystem forms.
