/**
 * Pages that actually separate.
 *
 * # What these page breaks are, and what they are not
 *
 * They are not LaTeX's. LaTeX breaks pages by typesetting the document — line
 * by line, with penalties, widow and orphan control, and floats moved around
 * the text — and reproducing that in an editor would mean writing a second
 * typesetter that agreed with the first. It would not agree, and two different
 * sets of page breaks in front of one author is worse than one honest set.
 *
 * So a break here happens where the *document* says it does — `\clearpage`,
 * `\newpage`, `\pagebreak`, and the start of every `\chapter`, which begins a
 * page in every class that has chapters — and otherwise every `linesPerPage`
 * lines, which is the sheet filling up. That is deterministic, it is arithmetic
 * over the source rather than measurement of the screen, and it does not move
 * while you scroll.
 *
 * The consequence worth stating: page 14 here is not page 14 in the PDF. What
 * the page view is for is *shape* — the measure, the proportions of the sheet,
 * where a chapter opens, how much of a page a table takes — and shape is right
 * long before the numbering is.
 *
 * # Why the count and not the height
 *
 * Measuring is the obvious alternative and it is worse. CodeMirror knows the
 * height of the lines it has rendered and estimates the rest, so breaks derived
 * from measurement would land in one place and then move as the reader scrolled
 * past them. A count is stable, and a wrapped line making a sheet a little long
 * is a smaller lie than a break that will not hold still.
 */

import { Facet, RangeSetBuilder, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { pageBreaks } from "./generated";
import { environments, headings } from "./structure";
import { environmentsOfKind } from "./vocabulary";

/** Whether the sheets are drawn at all. */
export const paginated = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/**
 * How many lines fit on a sheet.
 *
 * Supplied by the component that knows the paper, the margins and the line
 * height. Zero or less turns the automatic breaks off and leaves only the
 * document's own, which is what a document of unknown geometry should get.
 */
export const linesPerPage = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});

/**
 * How many fit on a sheet that has been turned.
 *
 * Fewer, and that is the point: a landscape page is as tall as the paper is
 * wide, so a table that needed turning to fit across also has less room down.
 */
export const linesPerLandscapePage = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});

/**
 * Where the paper is turned, as ranges of the document.
 *
 * Which environments turn it is not decided here: `landscape` is pdflscape's
 * and `sidewaystable` is rotating's, so both arrive from a plugin
 * ([`vocabulary.ts`](./vocabulary.ts)). A document with neither package simply
 * has no turned regions, which is the right answer for it.
 */
export function turnedRegions(text: string): { from: number; to: number }[] {
  return environments(text, environmentsOfKind("turned")).map((found) => ({
    from: found.from,
    to: found.to,
  }));
}

/** Whether an offset falls inside a turned region. */
function isTurned(
  regions: readonly { from: number; to: number }[],
  offset: number,
): boolean {
  return regions.some((region) => offset >= region.from && offset < region.to);
}

/**
 * Whether a chapter begins a page.
 *
 * True for `report` and `book`, false for `article`, which has no `\chapter` at
 * all. Read from the document rather than assumed, because opening every
 * section on a new page would shred an article into a page per heading.
 */
function chaptersOpenPages(text: string): boolean {
  return /\\documentclass[^{]*\{(report|book|scrreprt|scrbook)\}/.test(text);
}

/**
 * Where each sheet begins, as offsets into the document.
 *
 * Always includes 0: the document starts on a page.
 */
export function pageStarts(
  state: EditorState,
  perPage: number,
  perTurnedPage = perPage,
): number[] {
  const text = state.doc.toString();
  const starts = new Set<number>([0]);
  const turned = turnedRegions(text);

  // A turned page begins and ends where the turn does — which is what
  // `pdflscape` itself does, because a sheet cannot be half turned.
  for (const region of turned) {
    starts.add(state.doc.lineAt(region.from).from);
    const after = state.doc.lineAt(region.to).number + 1;
    if (after <= state.doc.lines) starts.add(state.doc.line(after).from);
  }

  // The document's own breaks. `\clearpage` and friends end the page they are
  // on, so the next line begins the next one.
  for (const found of pageBreaks(text)) {
    const line = state.doc.lineAt(found.to);
    const next = line.number + 1;
    if (next <= state.doc.lines) starts.add(state.doc.line(next).from);
  }

  if (chaptersOpenPages(text)) {
    for (const heading of headings(text)) {
      if (heading.level !== 1) continue;
      starts.add(state.doc.lineAt(heading.from).from);
    }
  }

  const ordered = [...starts].sort((a, b) => a - b);
  if (perPage <= 0) return ordered;

  // And the sheet simply filling up. Walked rather than computed per break, so
  // a long stretch between two of the document's own breaks is divided evenly
  // instead of the remainder landing on the last sheet.
  const filled: number[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const from = ordered[index]!;
    const until = ordered[index + 1] ?? Number.MAX_SAFE_INTEGER;
    filled.push(from);

    // A turned sheet holds fewer lines, because it is as tall as the paper is
    // wide. Chosen per stretch rather than per line: a turn always begins a
    // sheet, so a stretch is entirely turned or entirely not.
    const fits = isTurned(turned, from) ? perTurnedPage : perPage;
    if (fits <= 0) continue;

    let line = state.doc.lineAt(from).number + fits;
    while (line <= state.doc.lines && state.doc.line(line).from < until) {
      filled.push(state.doc.line(line).from);
      line += fits;
    }
  }

  return filled;
}

/**
 * The blank part of a sheet that the text did not reach.
 *
 * A chapter that ends a third of the way down still ends on a whole sheet of
 * paper, and drawing it as a third of a sheet would make the page view lie
 * about the one thing it is for.
 */
class FillWidget extends WidgetType {
  constructor(
    readonly lines: number,
    readonly turned: boolean,
  ) {
    super();
  }

  override eq(other: FillWidget): boolean {
    return other.lines === this.lines && other.turned === this.turned;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("div");
    node.className = this.turned
      ? "cm-yaz-page-fill cm-yaz-page-fill-turned"
      : "cm-yaz-page-fill";
    node.style.blockSize = `calc(${this.lines} * var(--yaz-line-height, 1.6) * 1em)`;
    node.setAttribute("aria-hidden", "true");
    return node;
  }
}

/** Draw the sheets. */
function sheets(state: EditorState): DecorationSet {
  if (!state.facet(paginated)) return Decoration.none;

  const perPage = state.facet(linesPerPage);
  const perTurned = state.facet(linesPerLandscapePage) || perPage;
  const starts = pageStarts(state, perPage, perTurned);
  const builder = new RangeSetBuilder<Decoration>();
  const startLines = new Set(
    starts.map((offset) => state.doc.lineAt(offset).number),
  );
  const turned = turnedRegions(state.doc.toString());

  let onThisSheet = 0;
  let sheetTurned = false;
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const first = startLines.has(number);
    const last = startLines.has(number + 1) || number === state.doc.lines;

    if (first) {
      onThisSheet = 0;
      sheetTurned = isTurned(turned, line.from);
    }
    onThisSheet += 1;

    const classes = [
      "cm-yaz-sheet",
      sheetTurned ? "cm-yaz-sheet-turned" : "",
      first ? "cm-yaz-sheet-first" : "",
      last ? "cm-yaz-sheet-last" : "",
    ]
      .filter(Boolean)
      .join(" ");
    builder.add(line.from, line.from, Decoration.line({ class: classes }));

    // The rest of the sheet, where the text stopped short of the bottom.
    const fits = sheetTurned ? perTurned : perPage;
    if (last && fits > 0 && onThisSheet < fits) {
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new FillWidget(fits - onThisSheet, sheetTurned),
          block: true,
          side: 1,
        }),
      );
    }
  }

  return builder.finish();
}

/**
 * The sheets, as editor state.
 *
 * A state field rather than a view plugin, because block widgets and line
 * decorations that change the document's line structure may only come from one
 * — the same reason rich text lives in a field.
 */
const decorations = StateField.define<DecorationSet>({
  create: (state) => sheets(state),
  update(value, transaction) {
    const reconfigured =
      transaction.startState.facet(paginated) !==
        transaction.state.facet(paginated) ||
      transaction.startState.facet(linesPerPage) !==
        transaction.state.facet(linesPerPage) ||
      transaction.startState.facet(linesPerLandscapePage) !==
        transaction.state.facet(linesPerLandscapePage);
    if (transaction.docChanged || reconfigured)
      return sheets(transaction.state);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.baseTheme({
  // A sheet of paper: the page's own background, its margins, and a shadow at
  // the edges where one sheet ends and the next begins.
  /*
   * The paper itself — its width, its margins, its centring — is *not* set
   * here. It is set in `Editor.svelte` on every direct child of the content
   * box, because a line is not the only thing on a page: the marks that open
   * and close the text are block widgets, and CodeMirror puts a block widget
   * beside the lines rather than inside one. Styling only the lines left those
   * marks off the paper and hard against the left edge.
   *
   * What is left here is what only a line can know: which sheet it opens and
   * which it closes.
   */
  ".cm-yaz-sheet-first": {
    paddingBlockStart: "var(--yaz-page-margin, 25mm)",
    marginBlockStart: "var(--yaz-space-6)",
    borderStartStartRadius: "2px",
    borderStartEndRadius: "2px",
    boxShadow: "0 -1px 6px var(--yaz-pdf-page-shadow)",
  },
  ".cm-yaz-sheet-last": {
    paddingBlockEnd: "var(--yaz-page-margin, 25mm)",
    borderEndStartRadius: "2px",
    borderEndEndRadius: "2px",
    boxShadow: "0 2px 8px var(--yaz-pdf-page-shadow)",
  },
  /* Sized with everything else on the page; see the note above. */
});

/** Everything the page view adds. */
export function pagination(): Extension {
  return [decorations, theme];
}
