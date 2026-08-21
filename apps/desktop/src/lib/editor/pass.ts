/**
 * The machinery a decoration pass shares.
 *
 * Rich text is not one scanner but a sequence of them, and they have to agree
 * about one thing: two replacements may not cover the same characters. The
 * claim register below is that agreement, and it lives here rather than in
 * `richText.ts` so that a pass can be written in its own file without either
 * importing the other.
 */

import { Decoration } from "@codemirror/view";
import type { WidgetType } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";

/**
 * What the pass drew, for the page view to use.
 *
 * Once this carried a row count per line — how tall each line was drawn, how
 * much of it was hidden, how many rows a widget stood for — because the page
 * view built a sheet by counting rows. It does not any more: a sheet is a fixed
 * box and the browser is asked how tall the content turned out
 * ([`pagination.ts`](./pagination.ts)). All of that bookkeeping ran on every
 * replacement in the document, on every keystroke, and none of it is needed.
 *
 * What is left is the one thing the pass knows and no measurement can tell:
 * which lines are the file's machinery rather than the document's paper.
 */
export interface Layout {
  /**
   * Lines that wrap the document rather than being part of it.
   *
   * The preamble and the closing line. Not on a page in the finished document
   * because they are not *in* it, so the paper begins after them.
   */
  readonly matter: { from: number; to: number }[];
}

/** A fresh empty layout, for a pass that is about to fill it in. */
export function emptyLayout(): Layout {
  return { matter: [] };
}

/**
 * The layout of a view that is not drawing rich text.
 *
 * One shared value rather than a fresh one each time, because callers compare
 * layouts by identity to decide whether anything has changed.
 */
export const NO_LAYOUT: Layout = { matter: [] };

/** Nothing at all, used to hide markup. */
export const hidden = Decoration.replace({});

/**
 * Ranges already stood in for by a widget.
 *
 * Two replacements may not overlap, and a formula inside a table cell has
 * already been drawn by the table. Anything replacing source inside one of
 * these is dropped; marks are not, because a mark over replaced text simply
 * does not show.
 */
export class Covered {
  /**
   * Claimed ranges, sorted by start and never overlapping.
   *
   * Both properties are held by {@link claim} being the only way in: a range
   * that would overlap is refused rather than stored. That is what lets a
   * lookup be a binary search over two neighbours instead of a walk through
   * everything claimed so far — which on a long document is thousands of
   * ranges, asked thousands of times, on the keystroke path.
   */
  private readonly spans: { from: number; to: number }[] = [];

  /** Take a range, or report that something already holds part of it. */
  claim(from: number, to: number): boolean {
    if (from >= to) return false;
    const at = this.firstFrom(from);
    if (this.collides(at, from, to)) return false;
    this.spans.splice(at, 0, { from, to });
    return true;
  }

  /** Whether anything already holds part of this range. */
  overlaps(from: number, to: number): boolean {
    return from < to && this.collides(this.firstFrom(from), from, to);
  }

  /** Index of the first claimed range starting at or after `from`. */
  private firstFrom(from: number): number {
    let low = 0;
    let high = this.spans.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.spans[middle]!.from < from) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Whether the range meets the claim before `at` or the one at it. */
  private collides(at: number, from: number, to: number): boolean {
    const before = this.spans[at - 1];
    if (before && before.to > from) return true;
    const after = this.spans[at];
    return Boolean(after && after.from < to);
  }
}

/** Everything a build pass needs to hand around. */
export interface Pass {
  state: EditorState;
  text: string;
  ranges: Range<Decoration>[];
  covered: Covered;
  /** What is being drawn, in rows. See {@link Layout}. */
  layout: Layout;
}

/** Whether the selection touches a range, in which case its markup is shown. */
export function touched(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

/** Replace a range with nothing or a widget, unless something already has. */
export function replace(
  pass: Pass,
  from: number,
  to: number,
  widget?: WidgetType,
): boolean {
  if (!pass.covered.claim(from, to)) return false;
  pass.ranges.push(
    (widget ? Decoration.replace({ widget }) : hidden).range(from, to),
  );
  return true;
}

/**
 * Show a range as itself when the caret is in it, and claim it either way.
 *
 * The rule the whole view runs on — what you are editing, you can see — and
 * the claim matters as much as the reveal: source the author is working in
 * must not be decorated by a later pass that does not know it is revealed.
 *
 * Returns whether the caller should go on to draw something.
 */
export function drawable(pass: Pass, from: number, to: number): boolean {
  if (!touched(pass.state, from, to)) return true;
  pass.covered.claim(from, to);
  return false;
}
