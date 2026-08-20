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
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

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

/** The name a seam marker shows: the file, without the folders above it. */
function leafName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/** The label at the top of an included file's text. */
class SeamWidget extends WidgetType {
  constructor(readonly file: string) {
    super();
  }

  override eq(other: SeamWidget): boolean {
    return other.file === this.file;
  }

  override toDOM(): HTMLElement {
    const tag = document.createElement("span");
    tag.className = "cm-yaz-seam";
    tag.textContent = leafName(this.file);
    tag.title = this.file;
    // Not part of the text: a screen reader reading the document should read
    // the document, and the file a paragraph happens to live in is furniture.
    tag.setAttribute("aria-hidden", "true");
    return tag;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Where each file's text starts, marked once.
 *
 * Once per file rather than once per segment: a chapter that itself includes a
 * figure comes back to the chapter afterwards, and labelling the return would
 * mark the same file twice on one screen for no new information.
 */
function seamMarkers(map: readonly Segment[]): DecorationSet {
  const seen = new Set<string>();
  const marks = [];

  for (const segment of map) {
    if (seen.has(segment.file)) continue;
    seen.add(segment.file);
    // The root is where the document starts, not a seam in it.
    if (segment.depth === 0) continue;
    marks.push(
      Decoration.widget({
        widget: new SeamWidget(segment.file),
        side: -1,
      }).range(segment.from),
    );
  }

  return Decoration.set(marks, true);
}

/** The seam markers, recomputed whenever the map moves. */
const markers = EditorView.decorations.compute([segments], (state) =>
  seamMarkers(state.field(segments)),
);

const theme = EditorView.baseTheme({
  ".cm-yaz-seam": {
    display: "inline-block",
    fontSize: "0.72em",
    fontFamily: "var(--yaz-font-sans)",
    color: "var(--yaz-text-muted)",
    background: "var(--yaz-bg-tertiary)",
    borderRadius: "var(--yaz-radius-sm)",
    padding: "0 0.4em",
    marginInlineEnd: "0.5em",
    verticalAlign: "middle",
    userSelect: "none",
  },
});

/**
 * Everything stitched mode adds to the editor.
 *
 * Inert until a map arrives, so this can sit in a compartment that is only
 * reconfigured when the mode is switched rather than being added and removed.
 */
export function stitched(onRefused: () => void): Extension {
  return [segments, refuseAcrossSeams(onRefused), markers, theme];
}
