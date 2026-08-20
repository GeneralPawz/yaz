# 0020 — Edit a multi-file document as one, behind a mode

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** part of [0004](0004-editor-core-codemirror-single-buffer.md)
- **Superseded by:** —

## Context

[ADR-0004](0004-editor-core-codemirror-single-buffer.md) says: *one CodeMirror
instance holding the `.tex` source text, always; the buffer content is the file
content, byte for byte.* Everything good about the editor follows from it — Vim
works in both views because there is one keymap over one document, undo is one
stack, and round-trip loss is impossible rather than merely unlikely.

It also assumed something that a real thesis does not honour: that a document is
a file.

The project this was tested against splits into a root, a title page, a
glossary, three chapters and a bibliography, tied together with `\include`. A
reader of the compiled PDF sees one document. An author using yaz sees seven
files and does their own bookkeeping: which file was that paragraph in, what is
the word count of the whole thing, where does this section sit in the order.
Every one of those questions has an answer the editor could give and did not.

The obvious cheap answer is a read-only preview: render an `\include` as the
file's text, clearly marked, and open the real file to edit it. That is honest
and it is not what anyone wants — it gives the *reading* experience of one
document while leaving the *writing* experience as seven files, and writing is
what an editor is for.

What makes the real thing hard is that ADR-0004's guarantee is exactly what
would be given up. If the buffer is a concatenation, the buffer is no longer any
file, byte for byte, and "the document on disk is the only source of truth"
stops being true the moment a character is typed.

## Decision

**A mode, and the document chooses it.**

- **Single-file mode** is unchanged. One buffer, one file, byte for byte, and
  every guarantee ADR-0004 makes still holds.
- **Stitched mode** holds the root document with every `\include` and `\input`
  expanded in place, and edits inside an expanded region are written back to
  the file they came from.

A document whose root pulls in other files opens stitched; one that does not
opens as itself. Either can be switched from View at any time.

> **Amended.** This was first decided as *off by default for everyone*, on the
> reasoning that a single-file document should not pay for machinery it does
> not need. Using it against a real thesis showed the reasoning was answering
> the wrong question. The cost was never the issue — the root of a multi-file
> document is a preamble and a list of `\include` lines, so the single-file view
> of it is not a view of the document at all. It is a view of the list of its
> parts, with an empty contents page and an empty glossary, and it looks like a
> broken editor rather than like a document that has not been joined.
>
> Making the *document* decide costs a single-file document nothing, because
> the condition is never true for one. What is preserved is the thing worth
> preserving: where the buffer can be one file, it is one file.

ADR-0004's rule is therefore narrowed rather than abandoned: *one buffer,
always* stands; *the buffer is one file* holds in single-file mode and is
replaced in stitched mode by **the buffer is a stitching of files, and every
offset in it belongs to exactly one of them.**

### How the stitching works

- A **segment map** records, for each stretch of the buffer, which file it came
  from and at what offset. The map is total: every offset is in exactly one
  segment, and segments never overlap.
- The `\include{...}` command itself is **not** in the stitched text. It is
  replaced by the file's content, so what is on screen is the document rather
  than the document plus its plumbing. A seam is marked by a decoration, which
  is a rendering concern and costs the text nothing.
- Every change is mapped back through the segment map to a change in one file.
  Nothing is written to disk until the author saves, at which point every file
  the changes touched is written.

### What is refused

**An edit that spans a seam is refused, not guessed at.** Selecting from the end
of one chapter into the start of the next and typing has no correct answer —
the replacement text belongs to one file or the other and nothing in the
document says which. Refusing is a message; guessing is a corrupted chapter that
nobody notices until the compile.

**At a seam, the included file takes the boundary.** A seam has two edges and
they pull in opposite directions: at the start of a chapter the natural answer
is that chapter, and at its end the natural answer is also that chapter. A rule
of "whichever segment ends here" gets the second right and the first wrong —
typing at the top of a chapter would put the text in the root file, between
`\begin{document}` and the `\include`, where it looks identical and is in the
wrong file. Between two adjacent chapters the depths are equal and the earlier
one takes it, because the end of what you were typing continues what you were
typing.

That rule was written the other way round first, and the tests caught it.

### What stays the author's

- **The `\include` commands are not rewritten.** yaz never adds, removes or
  reorders them from stitched mode; a document's structure is the author's, and
  an editor that quietly restructured a thesis because a paragraph was dragged
  would be unusable at exactly the moment it mattered.
- **A file is expanded once, wherever it is first included.** A second
  `\include` of the same file would put two copies of its text in the buffer,
  and an edit to one copy would leave the other stale with nothing saying so —
  the map cannot answer which copy a file's text belongs to, because both are
  it. The second command stays in the buffer, where it is clickable and visibly
  is what it is.
- A file that cannot be read — missing, or outside the project — is left as its
  `\include` line, undecorated. A document that silently loses a chapter because
  a path was wrong is worse than one that shows a line the author can see is
  wrong.
- Recursion is followed to a fixed depth and cycles are broken. A file that
  includes itself is a mistake, and hanging is not a diagnosis of it.

### And in single-file mode, links

The `\include{...}` and `\input{...}` commands become clickable in both modes.
That is the smaller half of the problem — moving between files — and it does not
need any of the above.

## Consequences

**The word count, the outline and inverse search become right for the first
time.** All three already worked on "the buffer"; in stitched mode the buffer is
the document, so a count is the thesis's count and the outline is the thesis's
structure. This is the strongest argument for the feature and it costs nothing
extra.

**Undo stays one stack, and that is not a coincidence.** Undo produces changes
in the buffer's coordinates, which is where the segment map operates, so it maps
back exactly as typing does. Had this been built as several editors kept in
step, undo across a seam would have been the hardest problem in the project.

**Save becomes a multi-file operation**, and so does every failure mode attached
to it. A save that half-succeeds leaves a document in a state no single file
records. Writes are therefore per-file and reported per-file, and a failure
names the file rather than the document.

**External change is harder.** A file edited outside yaz while stitched
invalidates a segment map that is still on screen. The map is rebuilt when the
document is re-stitched, and a stale map is refused rather than applied — the
same refusal as a seam-spanning edit, for the same reason.

**Performance is bounded by the whole document rather than the open file.**
Everything on the keystroke path — decorations, the word count, the outline —
already scales linearly with the buffer and is measured against a hundred-page
manuscript ([0015](0015-performance-budgets.md)). Stitched mode makes the
hundred-page case the *normal* case rather than the pathological one, which is
an argument for keeping those budgets honest rather than against the feature.

**Two modes is two code paths**, and the second one is only exercised when
someone switches it on. The mitigation is that the mapping is a pure function of
(text, segment map, changes) and is tested as one, rather than being observable
only by driving the editor.

**The map is moved, not rebuilt.** Re-stitching after every keystroke would be
correct and would put the whole document on the keystroke path, which
[0015](0015-performance-budgets.md) does not allow. Instead a change lengthens
the segment it lands in and shifts everything after it — two shifts, because a
segment's offset *within its file* moves only by the changes before it in that
same file. The property test for it is that moving the map and re-stitching
agree, checked edit by edit against a real thesis rather than a fixture.

**The map lives in the editor, not in the shell.** An edit has to be judged
before it applies, and a map held outside CodeMirror arrives a frame late —
which is after the character is already in the wrong file. So the map is a
`StateField`, a transaction filter reads it as it was *before* a change to
decide whether to allow it, and the shell keeps its own copy only to know which
file to write to.

## Alternatives considered

**Read-only preview of included files.** Cheap, safe, and preserves ADR-0004
untouched. Rejected because it answers the reading half of the problem and
leaves the writing half exactly where it was, and writing is the job.

**Several editor instances, one per file, presented as a continuous scroll.**
What some editors do. Rejected because every cross-cutting feature has to be
rebuilt per instance and then coordinated: one undo stack becomes seven, a
search across the document becomes seven searches, and Vim — which ADR-0004
bought for free — has to be told which instance it is in.

**Always stitched, no mode.** Simpler in the code and worse everywhere else. A
single-file document would pay for machinery it does not need, and the
guarantee that made ADR-0004 worth writing would be gone for everyone rather
than for the people who asked for this.

**Rewriting the document into one file.** Solves it permanently and destroys the
author's structure. Not seriously considered; recorded because it is the first
thing anyone suggests.
