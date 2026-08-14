# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

yaz is a long-lived desktop application with a third-party plugin ecosystem. Two
properties make undocumented decisions unusually expensive here:

1. **A public plugin API is a promise.** Once community plugins depend on a
   behaviour, changing it breaks other people's work. We need to know *why* an
   API is shaped the way it is before we consider reshaping it.
2. **The interesting choices are architectural, not local.** Whether the visual
   editor shares a buffer with the source editor, or whether plugins get DOM
   access, is not visible from reading any single file.

Without a record, the reasoning behind such choices decays into folklore within
months, and the project re-litigates settled questions every time a new
contributor arrives.

## Decision

We keep Architecture Decision Records in `docs/adr/`, numbered sequentially, in
the format described by `docs/adr/README.md`.

- An ADR is required for anything that constrains code we have not written yet:
  dependencies at the framework tier, the plugin contract, the file formats we
  read or write, the platform matrix, the release process.
- An ADR is *not* required for reversible, local choices — which crate parses
  TOML, how a function is named.
- ADRs are append-only. A reversed decision is recorded by a new ADR that
  supersedes the old one; the old one stays in the tree with its status updated.
- The ADR index is published as part of the docs site (see [0016](0016-documentation-strategy.md)),
  so the reasoning is visible to plugin authors, not only to committers.

## Consequences

- Every significant change carries a documentation cost before it carries a code
  cost. This is deliberate: it is the cheapest point at which to discover that a
  decision is wrong.
- New contributors have a single, ordered place to read the project's reasoning.
- The `Superseded by` chain means the directory grows monotonically and will
  eventually contain records that no longer describe the system. The `Status`
  column in the index is the authority on what is currently in force.
- Reviewers gain a concrete objection to reach for: "this contradicts ADR-000N".

## Alternatives considered

**Long-form design docs in a wiki.** Wikis drift out of sync with the code
because they are not in the same review as the change. ADRs live in the repo and
move through the same pull request.

**Nothing — rely on code comments and commit messages.** Comments explain local
mechanics well and cross-cutting rationale badly. `git log` records what changed,
almost never the alternatives that were rejected, which is the expensive part to
reconstruct.
