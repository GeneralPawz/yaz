# 0023 — The preview knows LaTeX; packages are plugins

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** —
- **Superseded by:** —

## Context

The rich-text preview draws a `.tex` file by recognising commands. By the time
it could render a real thesis it recognised about a hundred of them, and they
had arrived in the order that thesis needed them: `\gls` because the document
had 561 of them, `\parencite` because the bibliography used biblatex,
`\enquote` because the author wrote German, `\textls` because the title page
tracked its letters.

Every one of those is a package. None is defined by `\documentclass{article}`.
And there is no end to the list — the next document brings `\SI` from siunitx,
`\chemfig`, `\lstinline`, a house `\todo`. Left alone, the table grows inside
the application forever, and each entry is a small permanent maintenance
obligation for a package the maintainers may not use.

[ADR-0005](0005-extensibility-tiers.md) already says where features go. It does
not say where _this_ line falls, because the question only appears once the
preview exists: is knowing `\gls` an application feature or a plugin's?

The answer is not obvious in either direction. A preview that cannot draw a
heading is broken. A preview that ships a table of every LaTeX package anyone
uses is unmaintainable. So the line has to be drawn somewhere precise, and it
has to be drawn by a test that a future contributor can apply without asking.

## Decision

**yaz knows LaTeX itself. Everything a `\usepackage` adds belongs to a plugin.**

The test, applied to a single command or environment:

> Does `\documentclass{article}` alone define it?

Yes → it is the application's, in
`apps/desktop/src/lib/editor/vocabulary.ts`. No → it is a plugin's.

The test is deliberately _not_ "does a real document use it". A real thesis uses
`\gls` 561 times and that is still not the test, because usage frequency is a
fact about one document and package membership is a fact about LaTeX.

So `\section`, `\textbf`, `itemize`, `figure`, `tabular`, `equation`, `\ref`,
`\cite`, `\caption`, `\clearpage` are yaz's — they are what a `.tex` file _is_.
And `\gls` (glossaries), `\parencite` (biblatex), `\enquote` (csquotes),
`\autoref` (hyperref), `\cref` (cleveref), `align` (amsmath), `landscape`
(pdflscape) are not.

The first plugin on the far side of the line is
[`yaz-latex-packages`](https://github.com/texyaz/yaz-latex-packages), bundled
and enabled by default under [ADR-0021](0021-plugin-distribution.md). Bundling
it is what makes the split affordable: a new user loses nothing, and the
maintenance boundary is still real, because the plugin releases on its own
schedule and anyone can fork it to add a package we would not have taken.

### A contribution is a declaration, not a scan

A plugin contributes a **table of names and how to draw them**. It does not get
a document, an offset, or a pass over the buffer:

```ts
this.registerLatexVocabulary({
  commands: { gls: { kind: "glossary" }, parencite: { kind: "citation" } },
  environments: { align: { kind: "math" }, landscape: { kind: "turned" } },
});
```

This is forced by [ADR-0015](0015-performance-budgets.md), not by taste. The
whole document is walked exactly once per keystroke; measured against a joined
175 KB thesis that walk costs more than the rest of the decoration pass put
together, and a plugin API that let a dozen plugins each walk it would multiply
the one cost that the keystroke budget cannot absorb. Handing yaz a table keeps
the pass singular no matter how many plugins are installed.

The rendering kinds are a closed set, and that is the price: a plugin can say
"draw this like a citation" but cannot invent a new way of drawing. A package
that needs one needs a change to `Rendering` — public API, for everyone, per
ADR-0005's rule.

### A contribution cannot take a name LaTeX defines

`setContributions` refuses any name already in the core table, silently rather
than by error, and there is a test for it.

Without that rule, installing a plugin could change what `\textbf` looks like,
and the preview would become a picture of the document _plus the plugin set_ —
which is precisely what an editor showing someone their own writing must never
be. Package-provided names have no such protection from each other: two plugins
claiming `\cite` is a genuine conflict, and last-registered wins until there is
a reason to build something better.

`label` and `caption` are core-only for a different reason. Both attach to
their surroundings — a label folds into the heading above it, a caption numbers
the float around it — so they are not "draw this command" at all, and the
public `LatexRendering` union omits them.

### `\usepackage` is not consulted

A document using `\gls` gets it drawn whether or not it loaded glossaries.
Reading the preamble to decide would mean the preview silently stops rendering
when a `\usepackage` line is being edited, and a document that uses a command
it did not load does not compile — reporting that is the compiler's job.

## Consequences

- The application's vocabulary is bounded and stays bounded. Growth happens in
  plugin repositories, where it costs a release rather than a core change.
- Turning off `latex-packages` degrades the preview for documents using those
  packages. That is visible and correct: the plugin is what supplies them.
- Adding a package is a change to a small file grouped one `const` per
  `\usepackage`, which anyone can make without touching the application.
- Every scanner in the editor now asks the vocabulary rather than holding its
  own list, so a command moving between core and plugin is one edit.
- Tests in the application install the _real_ plugin's table rather than a
  fixture, so a command that moves across the line is caught in the editor's
  own tests rather than in the application at runtime.
