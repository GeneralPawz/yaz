/**
 * The line-number gutter, in the three states a writer wants it in.
 *
 * Off, because a manuscript is prose and prose does not have line numbers.
 * Absolute, because a compiler error names a line. Relative, because `12j` is
 * how a Vim user moves and counting to twelve by eye is not.
 *
 * # Why relative numbering is not just a `formatNumber`
 *
 * CodeMirror's `lineNumbers()` takes a `formatNumber`, which looks like the
 * whole answer — but its gutter only re-renders when its own configuration
 * changes, not when the selection moves. Relative numbers written that way are
 * correct exactly once, at the position the cursor happened to be in when the
 * editor was built, and then silently wrong for the rest of the session.
 *
 * So the relative gutter is its own, with a `lineMarkerChange` that fires when
 * the cursor's *line* changes. The line rather than the selection: moving along
 * a line changes nothing in the gutter, and redrawing it on every horizontal
 * keystroke would put work on the keystroke path for no visible difference.
 */

import type { EditorState, Extension } from "@codemirror/state";
import { GutterMarker, gutter, lineNumbers } from "@codemirror/view";

/** How the gutter numbers lines. */
export type LineNumbering = "off" | "absolute" | "relative";

/** Every value, in the order the menu offers them. */
export const LINE_NUMBERING: readonly LineNumbering[] = [
  "off",
  "absolute",
  "relative",
];

/** The gutter for a numbering mode. */
export function lineNumbering(mode: LineNumbering): Extension {
  if (mode === "off") return [];
  if (mode === "absolute") return lineNumbers();
  return relativeLineNumbers();
}

/** Which line the cursor is on. */
function cursorLine(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number;
}

/** One number in the gutter. */
class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: NumberMarker): boolean {
    return other.text === this.text;
  }

  override toDOM(): Text {
    return document.createTextNode(this.text);
  }
}

/**
 * Distance from the cursor, with the cursor's own line numbered absolutely.
 *
 * The hybrid form — Vim's `number` plus `relativenumber` — because a relative
 * gutter that also shows nothing absolute leaves you unable to answer "which
 * line is the error on?" without counting.
 */
function relativeLineNumbers(): Extension {
  return gutter({
    // The same class the built-in gutter uses, so the theme, the active-line
    // highlight and the gutter's width all keep working.
    class: "cm-lineNumbers",
    renderEmptyElements: false,
    lineMarker(view, line) {
      const number = view.state.doc.lineAt(line.from).number;
      const current = cursorLine(view.state);
      return new NumberMarker(
        number === current
          ? String(number)
          : String(Math.abs(current - number)),
      );
    },
    lineMarkerChange: (update) =>
      cursorLine(update.startState) !== cursorLine(update.state),
    // Sized to the widest number that can appear, so the gutter does not
    // change width — and the text does not shift sideways — as you move.
    initialSpacer: (view) => new NumberMarker(String(view.state.doc.lines)),
    updateSpacer: (spacer, update) => {
      const widest = String(update.view.state.doc.lines);
      return spacer instanceof NumberMarker && spacer.text === widest
        ? spacer
        : new NumberMarker(widest);
    },
    side: "before",
  });
}
