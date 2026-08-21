/**
 * The paper, in pixels.
 *
 * # Why this is not measured
 *
 * A sheet of A4 is 297 mm tall. That is not a fact about the font, the zoom, or
 * what has been scrolled into view — it is a fact about the paper — so it is
 * arithmetic and not a measurement. Everything here comes straight from the
 * page size the author chose and the magnification they are looking at.
 *
 * That matters because measuring it was a bug. The magnification is a CSS
 * custom property, and setting it does not resize anything until the browser
 * gets a turn; reading a line height straight afterwards paired the old height
 * with the new zoom. The page size never needed measuring, so it no longer is.
 *
 * What *does* need measuring is how tall the content turned out — and that is
 * [`pagination.ts`](./pagination.ts)'s business, where it belongs.
 */

import { Facet, StateEffect, StateField } from "@codemirror/state";

/** Whether the sheets are drawn at all. */
export const paginated = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/** A sheet of paper, in CSS pixels at the magnification now in force. */
export interface Paper {
  /** The whole sheet, edge to edge. */
  height: number;
  width: number;
  /** What the sheet leaves around its text, on every side. */
  margin: number;
  /** The space between one sheet and the next. */
  gap: number;
  /** A turned sheet is as tall as the paper is wide. */
  turnedHeight: number;
}

/**
 * The paper, or `null` when the page view is off.
 *
 * One facet rather than four, because the four are only ever meaningful
 * together: a page height without its margin says nothing about how much text
 * fits on it.
 */
export const paper = Facet.define<Paper | null, Paper | null>({
  combine: (values) => values.find((value) => value !== null) ?? null,
});

/** How far it is from the top of one sheet to the top of the next. */
export function pitchOf(sheet: Paper): number {
  return sheet.height + sheet.gap;
}

/** Where the text may start and where it must stop, on sheet `index`. */
export function textBounds(
  sheet: Paper,
  index: number,
): { from: number; to: number } {
  const top = index * pitchOf(sheet);
  return { from: top + sheet.margin, to: top + sheet.height - sheet.margin };
}

/** Which sheet a position in the content falls on. */
export function sheetAt(sheet: Paper, top: number): number {
  return Math.max(0, Math.floor(top / pitchOf(sheet)));
}

/**
 * How many rows of text fit on a sheet, and how many characters across it.
 *
 * These *are* measurements — they depend on the font — and they live here
 * rather than in `pagination.ts` because a generated listing needs them and
 * `pagination.ts` needs what the listing drew. Putting them in the module
 * both can import is what keeps the two from importing each other.
 *
 * A listing is the one thing that still needs a row count: it has to divide
 * *itself* into sheets, because a gap cannot be put inside a widget.
 */
export const setRowsPerPage = StateEffect.define<number>();

/** See {@link setRowsPerPage}. */
export const rowsPerPage = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRowsPerPage)) return effect.value;
    }
    return value;
  },
});

/** How many characters lie across the measure, or zero without wrapping. */
export const setCharactersPerRow = StateEffect.define<number>();

/** See {@link setCharactersPerRow}. */
export const charactersPerRow = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCharactersPerRow)) return effect.value;
    }
    return value;
  },
});
