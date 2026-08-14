# 0008 — Zotero integration strategy

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Seamless Zotero integration is a headline goal. There are four ways to reach a
Zotero library, and they differ sharply in capability and reliability:

1. **Zotero's local HTTP server** (`127.0.0.1:23119`). Zotero 7 exposes a
   read-only local API mirroring the web API. Requires Zotero to be running.
2. **Better BibTeX (BBT)**, a very widely installed Zotero plugin, adding a
   JSON-RPC endpoint, stable citation keys, and a cite-as-you-write picker.
   Stable citation keys are the thing that actually matters for LaTeX, and
   Zotero does not provide them natively.
3. **A `.bib` file exported from Zotero**, optionally kept current by BBT's auto-export.
4. **Reading `zotero.sqlite` directly.** Works offline with Zotero closed, but
   Zotero holds an exclusive lock while running, so it requires copying the file,
   and the schema is private and changes between releases.

None is sufficient alone. The HTTP paths need Zotero running. The `.bib` path
works always but is a stale snapshot without live search. The SQLite path is the
only offline one and is the most fragile.

## Decision

**A layered strategy in `yaz-zotero`, presenting one interface over several
sources, degrading rather than failing, and always telling the user which source
is live.**

| Priority | Source | Provides | Requires |
| --- | --- | --- | --- |
| 1 | Better BibTeX JSON-RPC | Live search, stable citation keys, CAYW picker, auto-export | Zotero running + BBT |
| 2 | Zotero 7 local API | Live search, collections, attachments | Zotero running |
| 3 | Watched `.bib` file | Full offline read, whatever was exported | An export exists |
| 4 | `zotero.sqlite` (read-only copy) | Offline library read | Zotero data directory found |

Behaviour:

- Sources are probed at startup and on reconnect. The **highest available source
  is the live one**, and the UI states which — "Zotero: connected via Better
  BibTeX" versus "Zotero: offline, reading exported .bib" — because silent
  degradation to a stale library is a correctness problem in a citation tool.
- **Citation keys come from Better BibTeX when available**, since BBT keys are
  what appear in `.bib` files and in collaborators' documents. Without BBT we
  generate deterministic keys and flag that they may not match a collaborator's.
- The **project `.bib` is the compile-time source of truth**, always. We never
  require Zotero to be running in order to build. Inserting a citation ensures
  the entry exists in the project `.bib`, so a project stays self-contained and
  compiles on a co-author's machine that has no Zotero at all.
- `zotero.sqlite` is opened **read-only, on a copy**, never in place. The schema
  is treated as unstable: version-checked, and on an unrecognised version we
  disable the source and say so rather than mis-parse a library.
- Attachment paths are resolved so a cited PDF can be opened from the citation.
- Ships as a **core plugin** ([0005](0005-extensibility-tiers.md)) requiring the
  `zotero` capability ([0006](0006-plugin-runtime-and-capabilities.md)). A user
  who does not use Zotero can disable it entirely.

Writing back to Zotero (creating items, syncing annotations) is explicitly out of
scope for now. It carries a real risk of corrupting a user's library, and the
read path delivers nearly all of the value.

## Consequences

- Users with the common Zotero + BBT setup get live search, correct keys, and
  cite-as-you-write.
- Users with Zotero closed, or a Zotero version we do not recognise, still work
  from the exported `.bib`.
- Projects compile without Zotero installed, which matters for co-authors, CI,
  and publisher submission.
- Four sources is genuinely more implementation and test surface than one, and
  the abstraction over them must not paper over their differences — hence the
  explicit source indicator.
- We depend on a third-party Zotero plugin for the best experience. Acceptable
  given BBT's ubiquity, and every lower tier is a real fallback.
- Zotero schema changes can disable tier 4 until we adapt. Detected and reported,
  never silently wrong.

## Alternatives considered

**Better BibTeX only.** Simplest, and covers most users well. Rejected because it
fails completely when Zotero is closed, which is most of the time for many
writers, and it makes a third-party plugin a hard dependency.

**`.bib` export only.** Trivially reliable and fully offline. Rejected because
live library search and cite-as-you-write are the features that make integration
feel seamless, and they are exactly what this cannot provide.

**Zotero web API with the user's account.** Works without a local Zotero and
across devices. Rejected as the primary path: it requires an API key, network
access, and sends library queries off-machine, which is wrong for a local-first
tool holding unpublished work. Possible later as an explicit opt-in tier.

**Ship an official Zotero plugin of our own.** Would give the cleanest integration.
Rejected for now as a second product with its own review and release cycle,
delivering little that BBT does not already.
