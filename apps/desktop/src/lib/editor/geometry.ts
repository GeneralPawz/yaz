/**
 * The shape of the paper, as editor state.
 *
 * These live apart from `pagination.ts` because two different parts of the
 * view need them and neither may import the other. The page view needs them to
 * decide where a sheet ends; the rich text needs them because a generated
 * listing produces *pages* of content from one line of source, so it has to
 * know how much fits on one before it can draw them.
 *
 * All four are supplied by the component that knows the paper, the margins,
 * the font and the zoom. Nothing here measures anything.
 */

import { Facet } from "@codemirror/state";

/** Whether the sheets are drawn at all. */
export const paginated = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/**
 * How many rows fit on a sheet.
 *
 * Zero or less turns the automatic breaks off and leaves only the document's
 * own, which is what a document of unknown geometry should get.
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
 * How many characters fit across the measure, or zero when lines do not wrap.
 *
 * This is what makes a page a page once wrapping is on. A paragraph of a
 * thesis is *one line of source* and eight rows on the paper, so a sheet
 * counted in source lines holds eight sheets' worth of text and stretches to
 * fit — which is the page view failing at the one thing it is for.
 *
 * An average character width is an estimate, and deliberately so: it depends
 * on the font and the zoom and not on what has been scrolled into view, so a
 * break derived from it does not move while the reader scrolls.
 */
export const charactersPerLine = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});
