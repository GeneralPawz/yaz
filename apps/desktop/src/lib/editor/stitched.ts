/**
 * Stitched mode, inside the editor.
 *
 * [`stitch.ts`](./stitch.ts) does the arithmetic; this puts it in CodeMirror.
 * The segment map lives in a `StateField` rather than in the shell, for one
 * reason: an edit has to be judged *before* it applies. A map held outside the
 * editor is a map that arrives a frame late, and a frame late is after the
 * character is already in the wrong file.
 *
 * So the field moves the map through every change ({@link mapSegments}), and a
 * transaction filter reads the map as it was *before* the change to decide
 * whether the change can be written at all
 * ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)).
 */

import { EditorState, StateEffect, StateField } from "@codemirror/state";
import type { ChangeSet, Extension, Transaction } from "@codemirror/state";
import { isWritable, mapSegments } from "./stitch";
import type { Change, Segment } from "./stitch";

/** Hand the editor a freshly built segment map. */
export const setSegments = StateEffect.define<Segment[]>();

/**
 * Which file every offset in the buffer belongs to.
 *
 * Empty in single-file mode, which is what makes everything below inert there:
 * no segments means nothing to refuse and nothing to mark.
 */
export const segments = StateField.define<Segment[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSegments)) return effect.value;
    }
    if (!transaction.docChanged || value.length === 0) return value;
    // A change that could not be mapped should have been refused before it got
    // here. If one arrives anyway the map is no longer a description of the
    // buffer, and an empty map — no seams, no refusals — is a safer wrong
    // answer than a map that points into the wrong file.
    return mapSegments(value, changesOf(transaction)) ?? [];
  },
});

/**
 * A change set, in the coordinates the document had before it.
 *
 * Which is the same coordinate system the segment map is in, and the reason
 * both the field and the shell can use the map without adjusting anything.
 */
export function changesIn(changes: ChangeSet): Change[] {
  const list: Change[] = [];
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    list.push({ from, to, insert: inserted.toString() });
  });
  return list;
}

/** The same, for a transaction. */
export function changesOf(transaction: Transaction): Change[] {
  return changesIn(transaction.changes);
}

/**
 * Refuse an edit that would span a seam, before it happens.
 *
 * The alternative is to let it apply and undo it afterwards, which flickers and
 * loses the selection. Refusing outright means the keystroke does nothing and
 * `onRefused` says why — which is the honest report of a change that has no
 * correct destination.
 */
export function refuseAcrossSeams(onRefused: () => void): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) return transaction;
    // The transaction that installs a new map replaces the whole document, so
    // it spans every seam there is. It is the map, not an edit against it.
    if (transaction.effects.some((effect) => effect.is(setSegments))) {
      return transaction;
    }

    const map = transaction.startState.field(segments, false);
    if (!map || map.length === 0) return transaction;

    const changes = changesOf(transaction);
    if (changes.every((change) => isWritable(map, change))) return transaction;

    onRefused();
    return [];
  });
}

/*
 * There are no seam markers.
 *
 * There were: a small pill naming the file, where each one's text began. It
 * read as `Vorbemerkungen.tex` immediately in front of that chapter's heading,
 * which is precisely what this mode exists to remove — the claim of a joined
 * document is that it reads as one document, and a filename before a chapter
 * title tells the reader otherwise once per chapter.
 *
 * Which file a stretch belongs to is still known and still answerable: it is
 * what every edit is mapped through, and what the file list navigates by. It
 * simply is not written across the page.
 */

/**
 * Everything stitched mode adds to the editor.
 *
 * Inert until a map arrives, so this can sit in a compartment that is only
 * reconfigured when the mode is switched rather than being added and removed.
 */
export function stitched(onRefused: () => void): Extension {
  return [segments, refuseAcrossSeams(onRefused)];
}
