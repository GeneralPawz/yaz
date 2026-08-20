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
 * A widget that knows how tall it is, in rows of text.
 *
 * Most widgets are one row: a formula, a page-break rule, a folded label. Two
 * are not — a table is as tall as it has rows, and a generated listing is as
 * tall as the document is long — and those two are exactly the ones that
 * decide where a page ends.
 *
 * A row rather than a pixel because the page view counts rows. It is an
 * estimate either way, and an estimate that does not move while you scroll
 * beats a measurement that does.
 */
export interface Tall {
  /** How many rows of text this stands as tall as. */
  readonly rows: number;
}

/** Whether a widget says how tall it is. */
function tall(widget: WidgetType): widget is WidgetType & Tall {
  return typeof (widget as Partial<Tall>).rows === "number";
}

/**
 * What the pass drew, in rows rather than in characters.
 *
 * The page view needs this and cannot work it out for itself. It counts what
 * fills a sheet, and what fills a sheet is what is *drawn*: a folded preamble
 * is eighty lines of source and no rows at all, a paragraph is one line of
 * source and eight rows once it wraps, a glossary is one line of source and
 * two hundred rows. Paginating over the source instead gives sheets that
 * stretch to any length and a glossary that will not divide.
 *
 * Collected here, during the pass that already knows all of it, rather than by
 * a second walk that would have to work it out again.
 */
export interface Layout {
  /** Lines that are not drawn at all: folded, hidden, or swallowed. */
  readonly skipped: Set<number>;
  /** Characters hidden within a line, which is how much less it wraps. */
  readonly hiddenChars: Map<number, number>;
  /** Rows a widget adds to the line it stands on, beyond that line's own. */
  readonly widgetRows: Map<number, number>;
  /**
   * Lines that are the document's machinery rather than its paper.
   *
   * The front and back matter: what a `.tex` file wraps its text in. It is not
   * on a page in the finished document because it is not *in* the finished
   * document, so the page view gives it a sheet of its own rather than
   * spending the first sheet of the paper on it.
   */
  readonly matter: { from: number; to: number }[];
}

/** A fresh empty layout, for a pass that is about to fill it in. */
export function emptyLayout(): Layout {
  return {
    skipped: new Set(),
    hiddenChars: new Map(),
    widgetRows: new Map(),
    matter: [],
  };
}

/**
 * The layout of a view that is not drawing rich text.
 *
 * One shared value rather than a fresh one each time, because the page view
 * decides whether to redraw by comparing the layout it has against the layout
 * the state holds. A new empty object per call would compare unequal to itself
 * and repaginate the document on every keystroke.
 */
export const NO_LAYOUT: Layout = {
  skipped: new Set(),
  hiddenChars: new Map(),
  widgetRows: new Map(),
  matter: [],
};

/** A line break, by code, so the scan below compares numbers. */
const NEWLINE = 10;

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
  record(pass, from, to, widget);
  return true;
}

/**
 * Note what this replacement did to the shape of the page.
 *
 * Here rather than in each caller because this is the one place every hidden
 * range in the view passes through, and a rule enforced at the choke point is
 * a rule that cannot be forgotten by the next scanner somebody writes.
 *
 * A line wholly inside a replacement is gone: not shortened, *not drawn*. A
 * line partly inside it is shorter by that much, which is how much less it
 * wraps. And a line whose replacement carries a widget is as tall as the
 * widget says it is.
 */
function record(
  pass: Pass,
  from: number,
  to: number,
  widget?: WidgetType,
): void {
  const doc = pass.state.doc;
  if (from >= to || to > doc.length) return;

  // Almost every replacement in the view is a piece of inline markup inside
  // one line — `\textbf{`, a closing brace, a `~`. There are thousands of them
  // on a long document, and asking the document which line each one is on is a
  // search of a balanced tree, thousands of times, on the keystroke path. It
  // measured at 2 ms of the 16 the whole keystroke has.
  //
  // None of those thousands change the shape of the page: hiding eight
  // characters of a four-hundred-character paragraph is a fortieth of a row.
  // So the cheap question — is there a line break inside this at all — is
  // asked first, and the tree is only searched for the replacements that could
  // move a page break.
  // Bounded by the range itself rather than by `indexOf`, which would scan
  // on to the next line break however far past the range it is. A piece of
  // inline markup is a dozen characters; the search should be a dozen
  // characters.
  let withinOneLine = true;
  for (let at = from; at < to; at += 1) {
    if (pass.text.charCodeAt(at) === NEWLINE) {
      withinOneLine = false;
      break;
    }
  }
  if (withinOneLine && !widget) return;

  const first = doc.lineAt(from).number;

  if (withinOneLine) {
    if (tall(widget!)) {
      pass.layout.widgetRows.set(
        first,
        (pass.layout.widgetRows.get(first) ?? 0) + widget!.rows,
      );
    }
    return;
  }

  const last = doc.lineAt(to).number;

  for (let number = first; number <= last; number += 1) {
    const line = doc.line(number);
    // Whole lines vanish — except the first when a widget stands there, since
    // the widget is drawn in that line's place rather than instead of it.
    const whole = from <= line.from && to >= line.to;
    if (whole && !(widget && number === first)) {
      pass.layout.skipped.add(number);
      continue;
    }
    const overlap = Math.min(to, line.to) - Math.max(from, line.from);
    if (overlap > 0) {
      pass.layout.hiddenChars.set(
        number,
        (pass.layout.hiddenChars.get(number) ?? 0) + overlap,
      );
    }
  }

  if (widget && tall(widget)) {
    pass.layout.widgetRows.set(
      first,
      (pass.layout.widgetRows.get(first) ?? 0) + widget.rows,
    );
  }
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
