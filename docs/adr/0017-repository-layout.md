# 0017 — Repository layout and monorepo tooling

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The project contains a Rust workspace, a TypeScript application, a published npm
package (`@yaz/api`), a set of first-party plugins that must build exactly as
third-party plugins do, a docs site, and shared assets — locales and themes —
consumed by several of those.

These are coupled. The plugin API types must match the Rust IPC surface. Core
plugins must build against the published API package, not against internal paths
([0005](0005-extensibility-tiers.md)). Version bumps must be coordinated
([0012](0012-versioning-and-changelog.md)). Splitting them across repositories
would mean every change touching the API becomes a multi-repository dance with
version pinning between steps.

## Decision

**A single repository containing a Cargo workspace and a pnpm workspace side by
side.**

```
yaz/
├── crates/                  Rust — Cargo workspace
│   ├── yaz-core/            Project & document model, settings, workspace
│   ├── yaz-latex/           Parsing, cross-file indexing, .bib
│   ├── yaz-compile/         Engine abstraction, Tectonic, system TeX, logs
│   ├── yaz-plugin/          Manifests, loading, capability broker
│   ├── yaz-zotero/          Zotero sources (BBT, local API, .bib, sqlite)
│   ├── yaz-obsidian/        Vault reading, Markdown → LaTeX
│   └── yaz-app/             The Tauri binary — thin; wiring only
├── apps/desktop/            Svelte 5 frontend
├── packages/
│   ├── api/                 @yaz/api — the public plugin API (published)
│   └── plugin-template/     Starter template for plugin authors
├── plugins/                 Core plugins, one directory each
├── docs/                    VitePress site, ADRs, guides
├── locales/                 Message catalogues
├── themes/                  yaz-light, yaz-dark
├── scripts/                 Build, codegen, release helpers
└── tests/                   Cross-cutting fixtures and template corpus
```

### Rules

- **`yaz-app` stays thin.** It wires crates to Tauri commands and holds no domain
  logic, so the domain crates remain testable without a running application and
  reusable by a future CLI or language server.
- **Crate boundaries follow ADR boundaries.** `yaz-zotero` exists because
  [0008](0008-zotero-integration.md) exists. The layout is the architecture made
  visible on disk.
- **Core plugins depend on `@yaz/api` by its published name**, resolved through
  the workspace during development. They cannot import internal frontend modules,
  enforced by lint — this is the mechanical half of the forcing function in
  [0005](0005-extensibility-tiers.md).
- **`locales/` and `themes/` are at the root**, not nested inside the frontend,
  because both Rust and TypeScript consume them and neither owns them.
- **pnpm, not npm or yarn**, for its strict `node_modules` layout — a package
  cannot import a dependency it did not declare, which is what keeps the API
  boundary above from being bypassed accidentally.
- **`Cargo.lock` and `pnpm-lock.yaml` are committed.** This is an application,
  not a library.
- Shared Rust dependency versions live in `[workspace.dependencies]`, so crates
  cannot drift onto different versions of the same dependency.
- **One CI pipeline** over both toolchains, with path filters so a docs-only
  change does not run the full four-way build matrix.

## Consequences

- An atomic change across the Rust IPC surface, the API package, and a core
  plugin is one commit and one review, which is the main reason for this layout.
- `@yaz/api` is developed alongside its consumers and published from here, so the
  published package is always the one core plugins were tested against.
- Core plugins are structurally identical to community plugins, which is what
  keeps the claim in [0005](0005-extensibility-tiers.md) honest.
- The repository is large and a full build is slow, mitigated by path-filtered CI
  and caching. A contributor fixing one Rust crate should not need a working
  Node toolchain, and vice versa — documented in the contributor setup.
- Two package managers and two dependency graphs to keep healthy.
- Release tooling must understand both ecosystems; release-please supports this
  and it is the reason it was chosen in [0012](0012-versioning-and-changelog.md).
- A single issue tracker for the application, the API, and core plugins needs
  labels to stay navigable. Community plugins have their own repositories, so the
  tracker does not have to scale to the whole ecosystem.

## Alternatives considered

**Separate repositories per component.** Cleaner boundaries and independent
release cadence. Rejected because the API-to-implementation coupling is real and
frequent: every such change would become a sequence of pull requests across
repositories with version pinning in between, which is slow enough that people
stop making the changes.

**A single crate rather than a workspace.** Simpler and faster to compile early
on. Rejected because the module boundaries are exactly the architectural
boundaries we want enforced by the compiler, and a single crate makes it easy for
`yaz-zotero`-shaped logic to leak into the Tauri layer.

**Nx or Turborepo for task orchestration.** Better caching and task graphs.
Rejected as premature: pnpm workspaces plus Cargo cover the current need, and
adding a third build system now is complexity for a problem we do not yet have.

**Core plugins as separate repositories.** Would prove the third-party path even
more strongly — an external author's exact workflow. Rejected because it
sacrifices atomic API changes, which is a daily cost against an occasional
benefit. The lint boundary buys most of the same assurance.
