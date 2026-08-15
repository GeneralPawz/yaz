# 0009 — Obsidian integration strategy

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The product thesis is that ideas and sources collected elsewhere become papers
here. Obsidian is where many researchers keep the ideas. So yaz needs to turn a
set of notes into the skeleton of a manuscript, without the user retyping them.

The convenient fact about Obsidian is that a vault is **a folder of Markdown
files on disk** — no database, no proprietary format, no running process. Almost
everything we need is available by reading files.

The hard part is not reading; it is translation. Obsidian Markdown carries
semantics that have LaTeX equivalents but no automatic mapping: `[[wikilinks]]`
are sometimes cross-references and sometimes citations; `![[embeds]]` are
transclusion; callouts are semantically environments; YAML frontmatter carries
metadata that belongs in the preamble.

## Decision

**`yaz-obsidian` reads the vault directly from the filesystem. No Obsidian
plugin is required and Obsidian need not be running.** On top of that, a
Rust-native Markdown → LaTeX pipeline with an explicit, user-inspectable and
user-overridable mapping.

### Reading

- The vault is a directory; we index it with the same machinery as a project
  file tree, watching for external changes.
- We parse frontmatter, headings, wikilinks, embeds, tags, callouts, and block
  references. The vault is treated as **strictly read-only by default** — we do
  not modify a user's notes without an explicit, per-operation action.

### Translation

Implemented in Rust with `pulldown-cmark` and a LaTeX writer, so it is fast, has
no Pandoc dependency, and is testable with snapshot tests over a corpus.

| Obsidian construct                                   | LaTeX result                                               |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `# Heading`                                          | `\section` / `\subsection`, depth-mapped to document class |
| `[[Note]]` → note with a citation key in frontmatter | `\cite{key}`                                               |
| `[[Note]]` → note that maps to a section             | `\ref{sec:...}`                                            |
| `[[Note]]` → otherwise                               | `\hyperref` or footnote, per configuration                 |
| `![[Note]]`                                          | `\input{}` of the translated note                          |
| `![[image.png]]`                                     | `\includegraphics` with the asset copied into the project  |
| `> [!note]` callouts                                 | A configurable environment                                 |
| `$...$`, `$$...$$`                                   | Passed through unchanged                                   |
| Frontmatter                                          | Preamble metadata: title, author, keywords                 |

**The mapping is data, not code** — a TOML file in the project, with our default
shipped and fully overridable. Vault conventions vary enormously between users
and any fixed mapping would be wrong for most of them.

### Provenance

A translated note records where it came from. The user can jump from a manuscript
section back to the source note, and re-translate a note after editing it in
Obsidian without losing manuscript-side edits — the import is a tracked operation
with a diff, not a blind overwrite.

Ships as a **core plugin** with the `obsidian` capability, which is `fs:read` on
the vault path.

## Consequences

- Integration works with any Obsidian version, and with any Markdown vault at all
  — Logseq, Foam, or a plain folder of notes. Not depending on Obsidian is a
  feature.
- No second product to maintain, no Obsidian plugin review cycle, nothing to
  install on the Obsidian side.
- Translation of a real vault will be imperfect. We accept this and design for
  it: the mapping is user-editable, unmappable constructs are passed through with
  a marker comment rather than dropped, and the result is a starting point the
  author edits — not a claim of fidelity.
- Wikilink resolution is genuinely ambiguous and the mapping table above encodes
  a guess. Where we cannot resolve confidently, we emit a marked placeholder and
  list it, rather than guessing silently.
- Read-only-by-default means we cannot offer round-tripping edits back to notes.
  This is the correct default: a user's vault is years of work and we are not
  going to be the tool that mangles it.
- Deep links (`obsidian://`) to open a note in Obsidian are offered where the URI
  handler is registered, as a convenience, never as a dependency.

## Alternatives considered

**Require a companion Obsidian plugin.** Would give live sync, richer metadata
via Dataview, and bidirectional links. Rejected: it makes yaz depend on a plugin
we must publish and maintain in another project's ecosystem, requires Obsidian to
be running, and buys little the filesystem does not already give us. Not ruled
out later as an optional enhancement.

**Shell out to Pandoc.** The most capable Markdown converter in existence and it
already handles most of this. Rejected as a hard dependency: it is a large
external binary the user must install, it is not consistently native on ARM64,
and we would still write the Obsidian-specific layer since Pandoc does not
understand wikilinks, embeds, or callouts. Offered as an _optional_ export path
in the `export` core plugin where the user has it.

**Import by copy-paste only.** Rejected as not integration.

**Treat the vault as the project source and compile Markdown directly.** An
appealing single-source-of-truth story. Rejected because it makes the manuscript
a derived artefact the author cannot edit as LaTeX, which is precisely what
serious paper writing requires — the moment they need a specific `\usepackage`
or a journal's macro, the model collapses.
