/**
 * Pages that are the size of the paper, always.
 *
 * # The mistake this replaces
 *
 * Every earlier version built a page *out of the content*: count the rows a
 * line takes, put so many rows on a sheet, and pad the bottom of a sheet that
 * came up short. Every one of them had the same failure, and no amount of
 * improving the count fixed it — because the count was never the problem. A
 * page made of content can *stretch*. Guess low about one image and the sheet
 * grows to hold it, and a sheet that grows is not a sheet.
 *
 * # The shape of this one
 *
 * **The page is not made of content.** It is a fixed box painted behind the
 * text — a repeating gradient with the paper's height, the gap, and nothing
 * to do with what is written on it. It cannot stretch because there is nothing
 * in it to push.
 *
 * **Content is pushed through it.** A view plugin measures where each block
 * actually sits and, wherever one would cross the bottom margin, inserts a
 * spacer of exactly the height needed to carry it to the top of the next
 * sheet. Nothing is padded and nothing is estimated: the spacer is the
 * difference between two measured numbers.
 *
 * The two halves never argue, because only one of them decides where a page
 * is. The other one just gets out of its way.
 *
 * # Why it settles
 *
 * Inserting a spacer moves everything below it, which changes what needs a
 * spacer. That is a loop, and it closes because every spacer moves content
 * *down* and onto a sheet where it fits — so each pass has strictly less to
 * do than the last, and a block that has been carried to the top of a sheet is
 * never carried again.
 *
 * A block taller than the usable page is the exception: it cannot be made to
 * fit and is left where it is, overflowing, exactly as LaTeX would leave an
 * oversized image sticking off the paper.
 */

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import {
  charactersPerRow,
  NO_EXTENT,
  paginated,
  paper,
  paperExtent,
  rowsPerPage,
  setCharactersPerRow,
  setExtent,
  setRowsPerPage,
  sheetAt,
  textBounds,
} from "./geometry";
import type { Extent, Paper } from "./geometry";
import { listings, pageBreaks } from "./generated";
import { layoutOf } from "./richText";
import { environments, headings } from "./structure";
import { environmentsOfKind } from "./vocabulary";

export { charactersPerRow, paginated, paper, rowsPerPage } from "./geometry";
export type { Paper } from "./geometry";

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

/**
 * Offsets the document itself says must begin a page.
 *
 * Separate from where a page *runs out*, which is arithmetic about heights.
 * These are instructions an author wrote, and they hold whatever the geometry
 * says: `\clearpage` means begin a page even one line in.
 */
export function forcedBreaks(state: EditorState): Set<number> {
  const text = state.doc.toString();
  const at = new Set<number>();

  const startOfLine = (offset: number): void => {
    if (offset >= 0 && offset <= state.doc.length) {
      at.add(state.doc.lineAt(offset).from);
    }
  };
  const lineAfter = (offset: number): void => {
    const line = state.doc.lineAt(Math.min(offset, state.doc.length));
    if (line.number < state.doc.lines) {
      at.add(state.doc.line(line.number + 1).from);
    }
  };

  // `\clearpage` and friends end the page they are on.
  for (const found of pageBreaks(text)) lineAfter(found.to);

  // `\end{titlepage}` clears the page in LaTeX itself — nothing may follow the
  // title onto its sheet.
  for (const found of environments(text, ["titlepage"])) {
    startOfLine(found.from);
    lineAfter(found.to);
  }

  // A generated list is pages of content standing on one line of source.
  for (const listing of listings(text)) {
    startOfLine(listing.from);
    lineAfter(listing.to);
  }

  // A turned sheet begins and ends where the turn does: a sheet cannot be half
  // turned, which is what `pdflscape` itself does.
  for (const region of turnedRegions(text)) {
    startOfLine(region.from);
    lineAfter(region.to);
  }

  // `\chapter` opens a page in every class that has chapters.
  if (/\\documentclass[^{]*\{(report|book|scrreprt|scrbook)\}/.test(text)) {
    for (const heading of headings(text)) {
      if (heading.level === 1) startOfLine(heading.from);
    }
  }

  // The front and back matter are not pages of the document — they are what
  // the file wraps it in — so the paper starts after them.
  for (const range of layoutOf(state).matter) {
    if (range.from >= 1 && range.from <= state.doc.lines) {
      at.add(state.doc.line(range.from).from);
    }
    if (range.to + 1 <= state.doc.lines) {
      at.add(state.doc.line(range.to + 1).from);
    }
  }

  return at;
}

/**
 * Every line that is the file's machinery rather than the document's paper.
 *
 * Asked per block while working out the gaps, so it is a set rather than the
 * ranges it comes from.
 */
function matterLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of layoutOf(state).matter) {
    for (let number = range.from; number <= range.to; number += 1) {
      lines.add(number);
    }
  }
  return lines;
}

/** A gap inserted to carry what follows it onto the next sheet. */
export interface Spacer {
  /** The document offset the gap goes in front of. */
  at: number;
  /** Exactly how tall, in pixels. */
  height: number;
  /** The sheet this closes, counting from one, or zero for the matter. */
  folio: number;
}

/** Replace the gaps. */
export const setSpacers = StateEffect.define<Spacer[]>();

/**
 * The gaps that carry content from one sheet to the next.
 *
 * Held as state rather than worked out while drawing, because working them out
 * needs measurements and drawing must not measure.
 */
export const spacers = StateField.define<Spacer[]>({
  create: () => [],
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setSpacers)) next = effect.value;
    }
    // An edit moves every offset after it. Mapped rather than dropped, so the
    // page does not collapse and rebuild itself on every keystroke — the
    // plugin corrects them within the frame.
    if (transaction.docChanged && next === value) {
      return value
        .map((spacer) => ({
          ...spacer,
          at: transaction.changes.mapPos(spacer.at, 1),
        }))
        .filter((spacer) => spacer.at <= transaction.newDoc.length);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (found) => drawSpacers(found)),
});

/** The gap at the foot of a sheet, carrying its number. */
class SpacerWidget extends WidgetType {
  constructor(
    readonly height: number,
    readonly folio: number,
  ) {
    super();
  }

  override eq(other: SpacerWidget): boolean {
    // To the pixel: a spacer that compared equal at a different height would
    // leave the sheet below it in the wrong place.
    return other.height === this.height && other.folio === this.folio;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("div");
    node.className = "cm-yaz-page-gap";
    node.style.blockSize = `${this.height}px`;

    if (this.folio > 0) {
      const number = document.createElement("span");
      number.className = "cm-yaz-folio";
      number.textContent = String(this.folio);
      // Decorative: a screen reader announcing a page number that is not the
      // compiler's page number would be telling the reader something false.
      number.setAttribute("aria-hidden", "true");
      node.append(number);
    } else {
      node.setAttribute("aria-hidden", "true");
    }
    return node;
  }
}

/** The gaps, as decorations. */
function drawSpacers(found: readonly Spacer[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const spacer of [...found].sort((a, b) => a.at - b.at)) {
    if (spacer.height <= 0) continue;
    builder.add(
      spacer.at,
      spacer.at,
      Decoration.widget({
        widget: new SpacerWidget(spacer.height, spacer.folio),
        block: true,
        side: -1,
      }),
    );
  }
  return builder.finish();
}

/**
 * How close two heights have to be to count as the same.
 *
 * Sub-pixel differences arrive constantly from rounding and font loading, and
 * rewriting the spacers for those would be a transaction a frame forever.
 */
const CLOSE_ENOUGH = 0.5;

/** Work out where the gaps go, from where the blocks actually are. */
const paginator = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.startState.facet(paper) !== update.state.facet(paper) ||
        update.startState.facet(paginated) !== update.state.facet(paginated)
      ) {
        this.schedule();
      }
    }

    private schedule(): void {
      this.view.requestMeasure({
        read: (view) => this.read(view),
        write: (found, view) => {
          if (found) view.dispatch({ effects: found });
        },
      });
    }

    /** What to change, or `null` when nothing has. */
    private read(view: EditorView): StateEffect<unknown>[] | null {
      const sheet = view.state.facet(paper);
      const on = view.state.facet(paginated);
      const effects: StateEffect<unknown>[] = [];

      // How many rows fit, for the listings that divide themselves.
      const rowHeight = view.defaultLineHeight;
      const rows =
        on && sheet && rowHeight > 0
          ? Math.max(
              1,
              Math.floor((sheet.height - 2 * sheet.margin) / rowHeight),
            )
          : 0;
      if (rows !== view.state.field(rowsPerPage, false)) {
        effects.push(setRowsPerPage.of(rows));
      }

      const characterWidth = view.defaultCharacterWidth;
      const across =
        on && sheet && characterWidth > 0
          ? Math.max(
              1,
              Math.floor((sheet.width - 2 * sheet.margin) / characterWidth),
            )
          : 0;
      if (across !== view.state.field(charactersPerRow, false)) {
        effects.push(setCharactersPerRow.of(across));
      }

      // Where the paper starts and stops, before anything is measured against
      // it: the front matter is above the first sheet, not on it.
      const had = view.state.field(paperExtent, false) ?? NO_EXTENT;
      const extent = on && sheet ? this.extentOf(view, sheet, had) : NO_EXTENT;
      if (
        Math.abs(extent.offset - had.offset) > CLOSE_ENOUGH ||
        Math.abs(extent.extent - had.extent) > CLOSE_ENOUGH
      ) {
        effects.push(setExtent.of(extent));
      }

      const wanted =
        on && sheet ? this.spacersFor(view, sheet, extent.offset) : [];
      if (this.differs(wanted, view.state.field(spacers, false) ?? [])) {
        effects.push(setSpacers.of(wanted));
      }

      return effects.length > 0 ? effects : null;
    }

    /** Whether the gaps we want differ from the ones that are there. */
    private differs(wanted: Spacer[], have: readonly Spacer[]): boolean {
      if (wanted.length !== have.length) return true;
      return wanted.some((spacer, index) => {
        const other = have[index]!;
        return (
          spacer.at !== other.at ||
          spacer.folio !== other.folio ||
          Math.abs(spacer.height - other.height) > CLOSE_ENOUGH
        );
      });
    }

    /**
     * The gaps the blocks on screen call for.
     *
     * Every block, not every *line*. A line is not the only thing that takes
     * room: a divided glossary is a stack of block widgets, and the front
     * matter's mark is one too. Walking lines meant those were never carried
     * onto a fresh sheet — they simply ran off the bottom of one and into the
     * space below it, which is what a glossary leaking between pages was.
     *
     * Only the blocks on screen: the rest of a hundred-page document has never
     * been laid out and has no honest height. What is off screen keeps the gaps
     * it already had, and gets them corrected when it arrives — before it is
     * drawn, so the correction is not visible.
     */
    private spacersFor(
      view: EditorView,
      sheet: Paper,
      offset: number,
    ): Spacer[] {
      const forced = forcedBreaks(view.state);
      const matter = matterLines(view.state);
      const kept = new Map<number, Spacer>();
      for (const spacer of view.state.field(spacers, false) ?? []) {
        kept.set(spacer.at, spacer);
      }

      const usable = sheet.height - 2 * sheet.margin;
      // A gap of our own belongs to the block after it, not to itself: the
      // question is always where that block *would* be without one.
      let gapAbove = 0;

      for (const block of view.viewportLineBlocks) {
        if (block.widget instanceof SpacerWidget) {
          gapAbove += block.height;
          continue;
        }

        const at = block.from;
        const top = block.top - gapAbove;
        gapAbove = 0;

        // The matter is not on the paper at all — the paper begins below it —
        // so it is never carried anywhere.
        if (matter.has(view.state.doc.lineAt(at).number)) {
          kept.delete(at);
          continue;
        }

        const index = sheetAt(sheet, top, offset);
        const bounds = textBounds(sheet, index, offset);
        const mustStart = forced.has(at);
        const overruns = top + block.height > bounds.to + CLOSE_ENOUGH;
        const atTop = Math.abs(top - bounds.from) <= CLOSE_ENOUGH;

        if (mustStart ? atTop : !overruns) {
          kept.delete(at);
          continue;
        }
        // Taller than any sheet: it can never be made to fit, so carrying it
        // would only put an empty page in front of it every time.
        if (!mustStart && block.height > usable) {
          kept.delete(at);
          continue;
        }

        // A block already above the first sheet is carried onto it rather than
        // onto the one after: `sheetAt` floors at zero, so without this the
        // first thing after the matter would skip a page.
        const next = top < textBounds(sheet, 0, offset).from ? 0 : index + 1;
        kept.set(at, {
          at,
          height: textBounds(sheet, next, offset).from - top,
          folio: next,
        });
      }

      return [...kept.values()]
        .filter((spacer) => spacer.height > CLOSE_ENOUGH)
        .sort((a, b) => a.at - b.at);
    }

    /**
     * Where the paper starts, and how far it runs.
     *
     * The paper begins *below* the front matter, so what the `.tex` wraps the
     * document in — the class, the packages, the mark that opens them — sits on
     * a strip of its own above the first sheet. It is not a page of the
     * document, and putting it on one meant the title page opened with the
     * document's machinery printed across the top of it.
     *
     * Measured as the bottom of the last matter block rather than from the
     * lines it covers: when the matter is folded it *is* a block widget, and a
     * line that has been replaced has no height to measure.
     *
     * Only re-measured while the relevant end of the document is on screen.
     * Elsewhere the last answer stands, which is right — the matter does not
     * change height while it is out of sight.
     */
    private extentOf(view: EditorView, sheet: Paper, before: Extent): Extent {
      const matter = matterLines(view.state);
      const pitch = sheet.height + sheet.gap;
      let offset = before.offset;

      if (view.viewport.from === 0) {
        offset = 0;
        let gap = 0;
        for (const block of view.viewportLineBlocks) {
          if (block.widget instanceof SpacerWidget) {
            gap += block.height;
            continue;
          }
          if (!matter.has(view.state.doc.lineAt(block.from).number)) break;
          // The paper starts below it, with the same space between as there is
          // between two sheets.
          offset = Math.max(0, block.bottom - gap + sheet.gap);
        }
      }

      let tail = 0;
      if (view.viewport.to >= view.state.doc.length) {
        const last = view.state.doc.lines;
        if (matter.has(last)) {
          const block = view.lineBlockAt(view.state.doc.line(last).from);
          tail = Math.max(0, view.contentHeight - block.top);
        }
      }

      const runs = Math.max(0, view.contentHeight - offset - tail);
      return { offset, extent: Math.max(1, Math.ceil(runs / pitch)) * pitch };
    }
  },
);

/**
 * The paper itself, painted behind the text.
 *
 * A repeating gradient rather than an element per sheet, which is the whole
 * point: it is drawn from the page size and the gap and knows nothing about
 * the content, so there is no way for the content to stretch it. Every sheet is
 * the same height as every other sheet because they are the same gradient.
 *
 * The measurements arrive as custom properties on the content box rather than
 * being baked in here, so that changing the paper or the magnification repaints
 * without rebuilding anything.
 */
const paperAttributes = EditorView.contentAttributes.compute(
  [paper, paginated, paperExtent],
  (state) => {
    const sheet = state.facet(paper);
    if (!state.facet(paginated) || !sheet) return {};
    const reach = state.field(paperExtent, false) ?? NO_EXTENT;
    return {
      class: "cm-yaz-paper",
      style:
        `--yaz-sheet-height:${sheet.height}px;` +
        `--yaz-sheet-pitch:${sheet.height + sheet.gap}px;` +
        `--yaz-sheet-gap:${sheet.gap}px;` +
        `--yaz-sheet-margin:${sheet.margin}px;` +
        // Where the paper begins and how far it runs, so the matter at either
        // end of the file sits on a strip beside it rather than on a page.
        `--yaz-paper-from:${reach.offset}px;` +
        `--yaz-paper-extent:${reach.extent > 0 ? `${reach.extent}px` : "100%"}`,
    };
  },
);

const theme = EditorView.baseTheme({
  ".cm-content.cm-yaz-paper": {
    backgroundImage:
      "repeating-linear-gradient(to bottom," +
      "var(--yaz-bg-primary) 0 var(--yaz-sheet-height)," +
      "transparent var(--yaz-sheet-height) var(--yaz-sheet-pitch))",
    // Painted once, over a stated extent, rather than repeated for ever: what
    // is above the paper and what is below it are the file's machinery — the
    // preamble and the closing line — and those are not pages of the document.
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% var(--yaz-paper-extent)",
    backgroundPosition: "0 var(--yaz-paper-from)",
  },
  ".cm-yaz-page-gap": {
    position: "relative",
    inlineSize: "100%",
  },
  /*
   * The folio, at the foot of the paper.
   *
   * Not the number the compiler will print — this measures the screen and
   * LaTeX typesets — so it is set quietly, because a number that is not the
   * printed one should not be read as if it were.
   */
  ".cm-yaz-folio": {
    position: "absolute",
    insetBlockEnd:
      "calc(var(--yaz-sheet-gap, 1rem) + var(--yaz-sheet-margin, 1rem) / 3)",
    insetInline: "0",
    textAlign: "center",
    fontSize: "0.85em",
    color: "var(--yaz-text-muted)",
    userSelect: "none",
  },
});

/** Everything the page view adds. */
export function pagination(): Extension {
  return [
    spacers,
    rowsPerPage,
    charactersPerRow,
    paginator,
    paperAttributes,
    theme,
  ];
}
