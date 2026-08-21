/**
 * How tall each line actually turned out.
 *
 * # Why this exists
 *
 * The page view used to decide where a sheet ends by *counting*: a line was a
 * row, a wrapped line was as many rows as it had measures, a widget said how
 * many rows it stood for. That is stable and it is cheap, and it was wrong
 * often enough to matter — because the count is a guess about something the
 * browser already knows exactly.
 *
 * An image is the clearest case. `\includegraphics[width=0.5\textwidth]` is one
 * line of source and, once the picture loads, four hundred pixels of paper. A
 * glossary entry is one entry and three rows once its definition wraps. A title
 * set in `\LARGE` is one line and one-and-three-quarter rows. Guessing each of
 * those low does not make the sheet a little short — it makes it *overflow*,
 * and an overflowing sheet has nowhere to go. The filler at the foot can pad a
 * sheet that came up short; nothing can shrink one that ran over. So a sheet
 * with an image on it simply grew, and stopped being A4.
 *
 * # Why measuring is safe here
 *
 * The objection to measuring was that breaks derived from measurement move
 * while the reader scrolls. That objection is about measuring *the page*: if
 * where a sheet ends depends on how tall the sheet is, the two chase each
 * other.
 *
 * What is measured here is **a line**, and a line's height does not depend on
 * which sheet it lands on. Measure it once, paginate from it, and the answer
 * does not move. The one exception is the sheet's own margins, which are
 * padding on the first and last line of each sheet — so those are subtracted,
 * and what is stored is the height the line would have had anywhere.
 *
 * Lines that have never been drawn have no measurement. Those keep the old
 * estimate, which is what it was always for: a sensible answer before the
 * browser has one.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/** Heights that have changed, in rows, by line number. */
export const setMeasuredRows = StateEffect.define<Map<number, number>>();

/**
 * How many rows tall each measured line is.
 *
 * Rows rather than pixels so that the page view keeps one unit: the sheet holds
 * so many rows, and this says how many of them a line takes. It also makes the
 * value independent of the zoom, since the line height it is measured against
 * is scaled by exactly the same amount.
 */
export const measuredRows = StateField.define<Map<number, number>>({
  create: () => new Map(),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setMeasuredRows)) next = effect.value;
    }
    // An edit moves every line after it, so measurements keyed by line number
    // stop meaning anything. Dropped rather than remapped: the plugin
    // re-measures what is on screen within the frame, and a wrong height held
    // confidently is worse than no height at all.
    if (transaction.docChanged) return new Map();
    return next;
  },
});

/**
 * A height worth reporting a change for.
 *
 * Sub-pixel differences arrive constantly from font loading and rounding, and
 * dispatching for those would be a transaction per frame for no visible
 * change.
 */
const WORTH_REPORTING = 0.05;

/** Measure what is on screen, and tell the state when it differs. */
const measurer = ViewPlugin.fromClass(
  class {
    /** Watches for heights that change without the document changing. */
    private readonly observer: ResizeObserver | null;

    constructor(private readonly view: EditorView) {
      // An image finishing loading changes a line's height and nothing else:
      // no transaction, no update, no reason for CodeMirror to tell anybody.
      // Without this the page an image is on stays paginated as though the
      // image were one row, which is exactly the case this module exists for.
      this.observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(() => this.schedule());
      this.observer?.observe(view.contentDOM);
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (
        update.geometryChanged ||
        update.viewportChanged ||
        update.docChanged
      ) {
        this.schedule();
      }
    }

    destroy(): void {
      this.observer?.disconnect();
    }

    /**
     * Read the heights after the browser has laid out, and dispatch.
     *
     * Through `requestMeasure` rather than straight away, because reading a
     * height in the middle of an update is what makes a browser lay out twice
     * per frame.
     */
    private schedule(): void {
      this.view.requestMeasure({
        read: (view) => this.read(view),
        write: (found: Map<number, number> | null, view) => {
          if (found) view.dispatch({ effects: setMeasuredRows.of(found) });
        },
      });
    }

    /** The heights on screen, or `null` when nothing has changed. */
    private read(view: EditorView): Map<number, number> | null {
      const rowHeight = view.defaultLineHeight;
      if (rowHeight <= 0) return null;

      const known = view.state.field(measuredRows, false) ?? new Map();
      const found = new Map(known);
      let changed = false;

      for (const block of view.viewportLineBlocks) {
        const number = view.state.doc.lineAt(block.from).number;
        const height = this.withoutSheetMargins(view, block.from, block.height);
        const rows = height / rowHeight;
        const before = found.get(number);
        if (before === undefined || Math.abs(before - rows) > WORTH_REPORTING) {
          found.set(number, rows);
          changed = true;
        }
      }

      return changed ? found : null;
    }

    /**
     * The height this line would have had on any sheet.
     *
     * The first and last line of a sheet carry the paper's margins as padding,
     * so measuring them raw would say the top line of every page is enormous —
     * and paginating from that would move the break, which would move which
     * line is at the top, which would move the break again. Taking the padding
     * off is what stops the two chasing each other.
     */
    private withoutSheetMargins(
      view: EditorView,
      from: number,
      height: number,
    ): number {
      const element = view.domAtPos(from).node;
      const line =
        element instanceof HTMLElement
          ? element.closest(".cm-line")
          : (element.parentElement?.closest(".cm-line") ?? null);
      if (!(line instanceof HTMLElement)) return height;
      if (
        !line.classList.contains("cm-yaz-sheet-first") &&
        !line.classList.contains("cm-yaz-sheet-last")
      ) {
        return height;
      }

      const style = getComputedStyle(line);
      const padding =
        Number.parseFloat(style.paddingTop || "0") +
        Number.parseFloat(style.paddingBottom || "0");
      return Math.max(0, height - padding);
    }
  },
);

/** Everything the measurement needs. */
export function measuredHeights(): Extension {
  return [measuredRows, measurer];
}
