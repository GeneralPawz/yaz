# 0004 — Editor core: CodeMirror 6 with a single-buffer visual mode

- **Status:** Accepted
- **Date:** 2026-08-14
- **Superseded in part by:** [0020](0020-stitched-multi-file-editing.md)

> **Amended.** "The buffer content is the file content, byte for byte" holds in
> the default mode and is replaced in the opt-in stitched mode of
> [0020](0020-stitched-multi-file-editing.md), where the buffer is a stitching
> of a document's files and every offset in it belongs to exactly one of them.
> Everything else below — one instance, one keymap, decorations rather than a
> second model — is unchanged and is what 0020 is built on.

## Context

yaz must offer two editing experiences over the same document:

- **Source mode** — the `.tex` as written, with syntax highlighting, line
  numbers, folding, autocompletion, and diagnostics.
- **Visual mode** — a rich-text view for authors who think in documents rather
  than markup, comparable to Overleaf's visual editor.

And a requirement that constrains both: **Vim keybindings must work in visual
mode as well as source mode.**

The obvious design is two editors — a code editor plus a rich-text editor built
on a document model such as ProseMirror — with a converter translating LaTeX to
that model and back. This is the design that kills such projects. The converter
must round-trip arbitrary LaTeX, including user-defined macros and whatever a
journal template does, without losing information. When it fails it corrupts the
author's manuscript. Beyond correctness it fragments everything downstream:
separate undo histories, cursor positions that do not map across a mode switch,
two selection models, two plugin API surfaces, and Vim implemented twice.

## Decision

**One CodeMirror 6 instance holding the `.tex` source text, always. Visual mode
is a set of decorations over that same buffer, not a second document.**

Concretely:

- The buffer content is the file content, byte for byte, in both modes. The
  document on disk is the only source of truth and there is no model to
  synchronise.
- Visual mode installs a CodeMirror extension that walks the Lezer syntax tree
  and applies decorations: markup is hidden with replacement decorations, and
  rendered widgets are drawn in its place. `\section{Intro}` renders as a
  heading; `$\alpha$` renders through KaTeX; `\includegraphics` renders the
  image; `tabular` renders as a table.
- When the cursor or selection enters a decorated node, the decoration steps
  aside and the raw markup is revealed for editing — the standard
  reveal-on-cursor pattern.
- Constructs the renderer does not understand — an exotic macro from a
  conference template, a package we have never seen — are simply left
  undecorated and display as source. **Unknown input degrades to plain text; it
  never fails.**

Supporting choices: **Lezer** for in-editor incremental parsing (CodeMirror's
native parser, fast enough to run on every keystroke); **`@replit/codemirror-vim`**
for Vim; **KaTeX** for math with a MathJax fallback for constructs KaTeX rejects.
Project-wide analysis that is too expensive for the keystroke path — the
cross-file label and reference index, the `\input` graph, `.bib` key resolution —
runs in Rust over tree-sitter and is delivered to the editor asynchronously as
diagnostics and completion sources.

## Consequences

**Vim works in visual mode for free.** There is one editor instance and one
keymap, so this stops being a feature to build and becomes a property of the
architecture. This alone justifies the decision.

**Round-trip loss is not merely unlikely, it is impossible.** There is no
conversion step in which to lose anything. A user can open a 200-page thesis
with a decade of accumulated macros and be certain that toggling modes cannot
alter a byte.

**One undo history, one selection model, one cursor.** Mode switching is
instant and preserves position, because nothing about the document changed.

**One plugin API surface for the editor.** A plugin that adds a completion
source, a diagnostic, or a decoration works in both modes without knowing modes
exist. Under the two-editor design every editor-facing plugin would need two
implementations.

**Complex block structures are harder than they would be with a document model.**
Editing a `tabular` as a real table, or dragging a figure, means writing a
widget that edits the underlying text range precisely. ProseMirror would give
these to us more readily. We accept this: it is bounded, additive work on a
correct foundation, whereas converter fidelity is unbounded work on a fragile
one.

**Visual mode quality is incremental.** Early versions will render headings,
emphasis, math, lists, and images, and show much else as source. This is
acceptable and honest — the alternative design is not usable at all until the
converter is comprehensive.

**We take on Lezer grammar maintenance** for LaTeX, since LaTeX is not a fixed
language and every package extends it. The grammar must be resilient by design:
recognise structure where it can and produce an inert node where it cannot.

## Alternatives considered

**CodeMirror for source + ProseMirror/Tiptap for visual, with a converter.**
The conventional design. Rejected for the reasons above: unbounded converter
fidelity risk against the user's actual manuscript, duplicated Vim, split undo
and cursor state, and two plugin surfaces. Richer table and list editing does
not buy back a correctness risk on the primary artefact.

**Monaco (the VS Code editor) for source mode.** Excellent code editor with a
strong Vim extension. Rejected because it is heavy, its decoration and widget
model is less suited to inline replacement rendering than CodeMirror's, and its
text rendering is oriented towards monospaced code rather than the proportional
typography visual mode needs.

**Start single-buffer, adopt ProseMirror later if tables prove unworkable.**
Considered and set aside as a *plan*, but noted as a genuine escape hatch: since
the buffer is the file, adding a document-model editor later is additive and
does not invalidate the decoration work. If we ever take it, it needs a new ADR.
