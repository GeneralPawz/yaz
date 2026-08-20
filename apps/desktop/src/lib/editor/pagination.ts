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

import { RangeSetBuilder, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import {
  charactersPerLine,
  linesPerLandscapePage,
  linesPerPage,
  paginated,
} from "./geometry";
import { listings, pageBreaks } from "./generated";
import { layoutOf } from "./richText";
import type { Layout } from "./pass";
import { emptyLayout } from "./pass";
import { environments, headings } from "./structure";
import { environmentsOfKind } from "./vocabulary";

// Re-exported so a caller configures the page view from the module that draws
// it, without having to know the facets live one file over.
export {
  charactersPerLine,
  linesPerLandscapePage,
  linesPerPage,
  paginated,
} from "./geometry";

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
 * How many rows each line of the document is drawn as.
 *
 * The number that makes a page a page. A line of source is not a row on the
 * paper: a folded preamble is eighty lines and no rows, a paragraph is one
 * line and eight rows once it wraps, a glossary is one line and two hundred
 * rows. Counting source lines gives sheets that stretch to any length, which
 * is the complaint the page view exists to answer.
 *
 * Everything here comes from the pass that already drew it
 * ([`pass.ts`](./pass.ts)); nothing is measured and nothing is walked twice.
 */
function rowsOf(
  state: EditorState,
  layout: Layout,
  measure: number,
): (line: number) => number {
  return (number) => {
    if (layout.skipped.has(number)) return 0;
    const line = state.doc.line(number);
    const visible = line.length - (layout.hiddenChars.get(number) ?? 0);
    // A line that wraps takes as many rows as it has measures. Without
    // wrapping it takes one however long it is, because it runs off the side.
    const wrapped =
      measure > 0 ? Math.max(1, Math.ceil(Math.max(visible, 0) / measure)) : 1;
    return wrapped + (layout.widgetRows.get(number) ?? 0);
  };
}

/**
 * Whether an offset is inside the front or back matter.
 *
 * That matter gets a sheet to itself — see {@link pageStarts} — so the sheet
 * it is on must not also be filled by the text that follows it.
 */
function isMatter(layout: Layout, line: number): boolean {
  return layout.matter.some((range) => line >= range.from && line <= range.to);
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
  layout: Layout = emptyLayout(),
  measure = 0,
): number[] {
  const text = state.doc.toString();
  const starts = new Set<number>([0]);
  const turned = turnedRegions(text);

  const startOfLine = (number: number): void => {
    if (number >= 1 && number <= state.doc.lines) {
      starts.add(state.doc.line(number).from);
    }
  };

  // A turned page begins and ends where the turn does — which is what
  // `pdflscape` itself does, because a sheet cannot be half turned.
  for (const region of turned) {
    starts.add(state.doc.lineAt(region.from).from);
    startOfLine(state.doc.lineAt(region.to).number + 1);
  }

  // The document's own breaks. `\clearpage` and friends end the page they are
  // on, so the next line begins the next one.
  for (const found of pageBreaks(text)) {
    startOfLine(state.doc.lineAt(found.to).number + 1);
  }

  // `\end{titlepage}` clears the page in LaTeX itself — a title page is a
  // page, and nothing may follow it onto the sheet. Without this the table of
  // contents is drawn underneath the title, which is not what the document
  // says and not what the PDF does.
  for (const found of environments(text, ["titlepage"])) {
    starts.add(state.doc.lineAt(found.from).from);
    startOfLine(state.doc.lineAt(found.to).number + 1);
  }

  // A generated list is pages of content standing on one line of source, so it
  // opens a sheet and the text after it opens another.
  for (const listing of listings(text)) {
    starts.add(state.doc.lineAt(listing.from).from);
    startOfLine(state.doc.lineAt(listing.to).number + 1);
  }

  if (chaptersOpenPages(text)) {
    for (const heading of headings(text)) {
      if (heading.level !== 1) continue;
      starts.add(state.doc.lineAt(heading.from).from);
    }
  }

  // The front and back matter stand apart from the paper entirely: they are
  // what the file wraps the document in, not anything that is printed. Each
  // gets a sheet, and the text resumes on a fresh one after it.
  for (const range of layout.matter) {
    startOfLine(range.from);
    startOfLine(range.to + 1);
  }

  const ordered = [...starts].sort((a, b) => a - b);
  if (perPage <= 0) return ordered;

  const rows = rowsOf(state, layout, measure);

  // And the sheet simply filling up. Walked rather than computed per break, so
  // a long stretch between two of the document's own breaks is divided evenly
  // instead of the remainder landing on the last sheet.
  const filled: number[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const from = ordered[index]!;
    const until = ordered[index + 1] ?? Number.MAX_SAFE_INTEGER;
    filled.push(from);

    const firstLine = state.doc.lineAt(from).number;
    // Matter is its own short sheet however many lines it runs to. It is not
    // paper, so it does not fill paper.
    if (isMatter(layout, firstLine)) continue;

    // A turned sheet holds fewer rows, because it is as tall as the paper is
    // wide. Chosen per stretch rather than per row: a turn always begins a
    // sheet, so a stretch is entirely turned or entirely not.
    const fits = isTurned(turned, from) ? perTurnedPage : perPage;
    if (fits <= 0) continue;

    let used = 0;
    for (
      let number = firstLine;
      number <= state.doc.lines && state.doc.line(number).from < until;
      number += 1
    ) {
      const height = rows(number);
      // A single line taller than the sheet — a long table, a wide formula —
      // still starts one sheet rather than none. Breaking before it would put
      // an empty sheet in front of it every time.
      if (used > 0 && used + height > fits) {
        filled.push(state.doc.line(number).from);
        used = height;
        continue;
      }
      used += height;
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
  const layout = layoutOf(state);
  const measure = state.facet(charactersPerLine);
  const starts = pageStarts(state, perPage, perTurned, layout, measure);
  const rows = rowsOf(state, layout, measure);
  const builder = new RangeSetBuilder<Decoration>();
  const startLines = new Set(
    starts.map((offset) => state.doc.lineAt(offset).number),
  );
  const turned = turnedRegions(state.doc.toString());

  let onThisSheet = 0;
  let sheetTurned = false;
  let sheetIsMatter = false;
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const first = startLines.has(number);
    const last = startLines.has(number + 1) || number === state.doc.lines;

    if (first) {
      onThisSheet = 0;
      sheetTurned = isTurned(turned, line.from);
      sheetIsMatter = isMatter(layout, number);
    }
    onThisSheet += rows(number);

    const classes = [
      "cm-yaz-sheet",
      sheetTurned ? "cm-yaz-sheet-turned" : "",
      sheetIsMatter ? "cm-yaz-sheet-matter" : "",
      first ? "cm-yaz-sheet-first" : "",
      last ? "cm-yaz-sheet-last" : "",
    ]
      .filter(Boolean)
      .join(" ");
    builder.add(line.from, line.from, Decoration.line({ class: classes }));

    // The rest of the sheet, where the text stopped short of the bottom. The
    // matter has no rest: it is a label on the file rather than a page of it,
    // and padding it out to a full sheet would say it was a page.
    const fits = sheetTurned ? perTurned : perPage;
    if (last && !sheetIsMatter && fits > 0 && onThisSheet < fits) {
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
  /*
   * The front and back matter: a short sheet rather than a sheet of paper.
   *
   * What it holds is not in the finished document — it is the LaTeX that wraps
   * what is. Giving it a full sheet of A4 says it is a page of the paper, and
   * the first thing the reader would see is a mostly-blank one.
   */
  ".cm-yaz-sheet-matter": {
    paddingBlock: "var(--yaz-space-2)",
    background: "none",
    boxShadow: "none",
  },
  ".cm-yaz-sheet-matter.cm-yaz-sheet-first": {
    paddingBlockStart: "var(--yaz-space-2)",
    marginBlockStart: "var(--yaz-space-2)",
    boxShadow: "none",
  },
  ".cm-yaz-sheet-matter.cm-yaz-sheet-last": {
    paddingBlockEnd: "var(--yaz-space-2)",
    boxShadow: "none",
  },
  /* Sized with everything else on the page; see the note above. */
});

/** Everything the page view adds. */
export function pagination(): Extension {
  return [decorations, theme];
}
