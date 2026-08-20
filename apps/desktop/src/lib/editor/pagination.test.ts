/**
 * Where a page ends.
 *
 * These check the arithmetic and not the drawing, because the arithmetic is
 * the part that can be wrong without looking wrong: a break in the right place
 * for the wrong reason and a break in the wrong place look identical on screen
 * until the document changes underneath them.
 */

import { EditorState } from "@codemirror/state";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  charactersPerLine,
  linesPerPage,
  pageStarts,
  paginated,
  pagination,
  turnedRegions,
} from "./pagination";
import type { Layout } from "./pass";
import { layoutOf, richText, richTextEnabled, setRichText } from "./richText";
import { EditorView } from "@codemirror/view";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

beforeAll(() => {
  // CodeMirror measures its own layout; jsdom implements neither of these.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

/** A newline, named so a template literal can hold one. */
const nothing = "\n";

/** Views to tear down, for the tests that need a real one. */
const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

/** A state over some lines, with the sheets switched on. */
function document(lines: string[], perPage = 0): EditorState {
  return EditorState.create({
    doc: lines.join("\n"),
    extensions: [paginated.of(true), linesPerPage.of(perPage)],
  });
}

/** Which line each sheet starts on, which is what the drawing needs. */
function startLines(state: EditorState, perPage: number): number[] {
  return pageStarts(state, perPage).map(
    (offset) => state.doc.lineAt(offset).number,
  );
}

/**
 * Install the packages, the way a running yaz gets them.
 *
 * The real plugin's table rather than a fixture, so what these exercise is
 * what a user has — and so a command moving between core and plugin is caught
 * here rather than in the application.
 */
function withPackages(): void {
  setContributions([
    {
      pluginId: "com.yaz.latex-packages",
      commands: PACKAGE_COMMANDS,
      environments: PACKAGE_ENVIRONMENTS,
    },
  ]);
}

beforeEach(withPackages);
afterEach(() => setContributions([]));

describe("pageStarts", () => {
  it("starts the document on a page", () => {
    const state = document(["Ein Satz."]);
    expect(startLines(state, 0)).toEqual([1]);
  });

  it("breaks where the document breaks", () => {
    // `\clearpage` ends the page it is on, so the *next* line opens the next.
    const state = document(["Erste Seite.", `${B}clearpage`, "Zweite Seite."]);
    expect(startLines(state, 0)).toEqual([1, 3]);
  });

  it("treats every kind of break the same way", () => {
    const state = document([
      "Eins.",
      `${B}newpage`,
      "Zwei.",
      `${B}cleardoublepage`,
      "Drei.",
      `${B}pagebreak`,
      "Vier.",
    ]);
    expect(startLines(state, 0)).toEqual([1, 3, 5, 7]);
  });

  it("opens a page for a chapter, in a class that has chapters", () => {
    const state = document([
      `${B}documentclass{report}`,
      `${B}begin{document}`,
      `${B}chapter{Eins}`,
      "Text.",
      `${B}chapter{Zwei}`,
    ]);
    expect(startLines(state, 0)).toEqual([1, 3, 5]);
  });

  it("does not, in a class that has none", () => {
    // An article has no `\chapter`, and opening a page per section would shred
    // it into a page per heading.
    const state = document([
      `${B}documentclass{article}`,
      `${B}section{Eins}`,
      "Text.",
      `${B}section{Zwei}`,
    ]);
    expect(startLines(state, 0)).toEqual([1]);
  });

  it("breaks again when the sheet fills up", () => {
    const state = document(["a", "b", "c", "d", "e", "f", "g"], 3);
    expect(startLines(state, 3)).toEqual([1, 4, 7]);
  });

  it("starts counting again after a break the document asked for", () => {
    // Otherwise a `\clearpage` two lines into a sheet would be followed by a
    // sheet only one line tall.
    const state = document(
      ["a", "b", `${B}clearpage`, "d", "e", "f", "g", "h"],
      3,
    );
    expect(startLines(state, 3)).toEqual([1, 4, 7]);
  });

  it("never puts an automatic break past the next real one", () => {
    const state = document(["a", "b", "c", `${B}newpage`, "e"], 2);
    expect(startLines(state, 2)).toEqual([1, 3, 5]);
  });

  it("leaves the automatic breaks out when it is not told the size", () => {
    // A document of unknown geometry gets the breaks it asked for and no
    // others, rather than breaks at an invented interval.
    const state = document(["a", "b", "c", "d", "e"], 0);
    expect(startLines(state, 0)).toEqual([1]);
  });

  it("ignores a break that is commented out", () => {
    const state = document(["Eins.", `% ${B}clearpage`, "Zwei."]);
    expect(startLines(state, 0)).toEqual([1]);
  });

  it("copes with a break on the last line", () => {
    // There is no next line to open, and inventing one would be a page with
    // nothing on it.
    const state = document(["Eins.", `${B}clearpage`]);
    expect(startLines(state, 0)).toEqual([1]);
  });

  it("gives each start exactly once", () => {
    // A `\chapter` right after a `\clearpage` is one page break, not two, and
    // a duplicate would draw two sheet edges in the same place.
    const state = document([
      `${B}documentclass{report}`,
      `${B}clearpage`,
      `${B}chapter{Eins}`,
    ]);
    expect(startLines(state, 0)).toEqual([1, 3]);
  });
});

describe("a turned page", () => {
  const doc = [
    "Vorher.",
    "BSLbegin{landscape}",
    "BSLbegin{longtable}{ll}",
    "Eine sehr breite Tabelle",
    "BSLend{longtable}",
    "BSLend{landscape}",
    "Nachher.",
  ].map((line) => line.replace("BSL", B));

  const state = document(doc);

  it("begins where the turn begins and ends where it ends", () => {
    // A sheet cannot be half turned, which is why `pdflscape` breaks the page
    // itself — and why this has to as well.
    expect(startLines(state, 0)).toEqual([1, 2, 7]);
  });

  it("finds the region, for the sheets to be drawn against", () => {
    const regions = turnedRegions(doc.join("\n"));
    expect(regions).toHaveLength(1);
  });

  it("fits fewer lines on it", () => {
    // As tall as the paper is wide: a table that needed turning to fit across
    // also has less room down.
    const long = document([
      "BSLbegin{landscape}".replace("BSL", B),
      "a",
      "b",
      "c",
      "d",
      "BSLend{landscape}".replace("BSL", B),
    ]);
    expect(pageStarts(long, 10, 2).length).toBeGreaterThan(
      pageStarts(long, 10, 10).length,
    );
  });

  it("does not turn a sideways float it was not asked about", () => {
    expect(
      turnedRegions("BSLbegin{figure}x BSLend{figure}".replace(/BSL/g, B)),
    ).toEqual([]);
  });
});

/**
 * The same questions, but asked of what is actually drawn.
 *
 * The tests above hand `pageStarts` a document and nothing else, which is the
 * arithmetic in isolation. These build the real rich-text pass first and give
 * it the layout that pass produced, because the bugs being fixed here are all
 * of one kind: the page view counted lines of *source* when what fills a sheet
 * is rows of *paper*.
 */
describe("counting what is drawn rather than what is written", () => {
  /** A state with rich text really running over it, and its layout. */
  function drawn(
    doc: string,
    options: { perPage?: number; measure?: number } = {},
  ): { state: EditorState; layout: Layout } {
    const state = EditorState.create({
      doc,
      extensions: [
        richText(),
        richTextEnabled.init(() => true),
        paginated.of(true),
        linesPerPage.of(options.perPage ?? 0),
        charactersPerLine.of(options.measure ?? 0),
      ],
    });
    return { state, layout: layoutOf(state) };
  }

  /** Which line each sheet starts on, given a real layout. */
  function sheetsOf(
    doc: string,
    options: { perPage: number; measure?: number },
  ): number[] {
    const { state, layout } = drawn(doc, options);
    return pageStarts(
      state,
      options.perPage,
      options.perPage,
      layout,
      options.measure ?? 0,
    ).map((offset) => state.doc.lineAt(offset).number);
  }

  it("gives a wrapped paragraph the rows it wraps to", () => {
    // Six paragraphs, each six measures long. Wrapped, that is thirty-six rows
    // and needs four sheets of ten; counted as lines it is eleven and fits on
    // two — so the two sheets stretch to nearly twice their height to hold it.
    // That stretch is the bug: the page stops being the size of the paper.
    const paragraph = "x".repeat(60);
    const body = Array.from({ length: 6 }, () => paragraph).join("\n" + "\n");
    const doc = `${B}begin{document}${nothing}${body}${nothing}${B}end{document}`;

    const wrapped = sheetsOf(doc, { perPage: 10, measure: 10 });
    const unwrapped = sheetsOf(doc, { perPage: 10, measure: 0 });

    // The comparison is the test. Counting rows must give *more* sheets than
    // counting lines, because that is exactly the text that was overflowing.
    expect(wrapped.length).toBeGreaterThan(unwrapped.length);
    expect(wrapped.length).toBeGreaterThanOrEqual(4);
  });

  it("spends no rows on a preamble nobody can see", () => {
    // Eighty lines of packages, folded behind one mark. Counted as source they
    // fill two sheets before the document has begun, and every page after that
    // is off by two.
    const preamble = Array.from(
      { length: 80 },
      (_, index) => `${B}usepackage{p${index}}`,
    ).join("\n");
    const doc = `${B}documentclass{article}\n${preamble}\n${B}begin{document}\nOne short line.\n${B}end{document}`;
    const { state, layout } = drawn(doc, { perPage: 20 });
    const rows = [...Array(state.doc.lines).keys()]
      .map((index) => index + 1)
      .filter((number) => !layout.skipped.has(number));
    // The eighty folded lines are not drawn, so they are not counted.
    expect(rows.length).toBeLessThan(20);
  });

  it("keeps the contents off the title page", () => {
    // BimWissT's shape: a title page, then the table of contents. LaTeX clears
    // the page at \end{titlepage}, so the contents cannot share the sheet —
    // and the preview drew them on top of each other.
    const doc = [
      `${B}begin{document}`,
      `${B}begin{titlepage}`,
      "A Thesis",
      `${B}end{titlepage}`,
      `${B}tableofcontents`,
      "First chapter.",
      `${B}end{document}`,
    ].join("\n");
    const { state, layout } = drawn(doc, { perPage: 40 });
    const starts = pageStarts(state, 40, 40, layout).map(
      (offset) => state.doc.lineAt(offset).number,
    );
    const titlePage = state.doc.lines >= 2 ? 2 : 1;
    const contents = 5;
    expect(starts).toContain(contents);
    expect(starts.indexOf(contents)).toBeGreaterThan(starts.indexOf(titlePage));
  });

  it("starts a sheet after a generated list, not underneath it", () => {
    const doc = [
      `${B}begin{document}`,
      `${B}tableofcontents`,
      "The first paragraph of the document.",
      `${B}end{document}`,
    ].join("\n");
    const { state, layout } = drawn(doc, { perPage: 40 });
    const starts = pageStarts(state, 40, 40, layout).map(
      (offset) => state.doc.lineAt(offset).number,
    );
    expect(starts).toContain(2);
    expect(starts).toContain(3);
  });

  it("divides a glossary too long for one sheet", () => {
    // The complaint exactly: a hundred and forty terms drawn as one sheet a
    // hundred and forty rows tall. A listing is the only thing in the preview
    // that makes pages of content out of one line of source, so it is the only
    // thing that has to divide itself.
    const terms = Array.from(
      { length: 60 },
      (_, index) =>
        `${B}newglossaryentry{g${index}}{name={Term ${index}},description={d}}`,
    ).join("\n");
    const doc = [
      `${B}documentclass{article}`,
      terms,
      `${B}begin{document}`,
      `${B}printglossaries`,
      `${B}end{document}`,
    ].join("\n");

    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          richText(),
          richTextEnabled.init(() => true),
          paginated.of(true),
          linesPerPage.of(20),
        ],
      }),
      // `document` is a helper in this file; the global is meant here.
      parent: globalThis.document.body,
    });
    views.push(view);

    const drawnSheets = view.contentDOM.querySelectorAll(".cm-yaz-listing");
    // Sixty terms at eighteen to the sheet is four sheets, not one.
    expect(drawnSheets.length).toBeGreaterThan(1);
    // And every one of them fits: none is taller than the paper.
    for (const sheet of drawnSheets) {
      expect(
        sheet.querySelectorAll(".cm-yaz-listing-entry").length,
      ).toBeLessThanOrEqual(18);
    }
  });

  it("keeps a short listing whole", () => {
    // The division is for lists that do not fit. One that does is one sheet,
    // with its heading, and not a heading followed by a continuation.
    const doc = [
      `${B}documentclass{article}`,
      `${B}newglossaryentry{a}{name={Alpha},description={d}}`,
      `${B}begin{document}`,
      `${B}printglossaries`,
      `${B}end{document}`,
    ].join("\n");
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          richText(),
          richTextEnabled.init(() => true),
          paginated.of(true),
          linesPerPage.of(20),
        ],
      }),
      // `document` is a helper in this file; the global is meant here.
      parent: globalThis.document.body,
    });
    views.push(view);
    expect(view.contentDOM.querySelectorAll(".cm-yaz-listing").length).toBe(1);
    expect(
      view.contentDOM.querySelectorAll(".cm-yaz-listing-continued").length,
    ).toBe(0);
  });

  it("gives the front matter a sheet of its own", () => {
    const doc = `${B}documentclass{article}\n${B}begin{document}\nText.\n${B}end{document}`;
    const { state, layout } = drawn(doc, { perPage: 40 });
    expect(layout.matter.length).toBeGreaterThan(0);
    const starts = pageStarts(state, 40, 40, layout).map(
      (offset) => state.doc.lineAt(offset).number,
    );
    // The text does not share the sheet the machinery is on.
    const afterMatter = layout.matter[0]!.to + 1;
    expect(starts).toContain(afterMatter);
  });
});

/**
 * The sheets a running editor actually draws.
 *
 * Everything above calls `pageStarts` with a layout in hand, which is the
 * arithmetic in isolation — and the arithmetic was right while the page view
 * was visibly wrong, because the *field* never asked for it. Rich text is
 * switched on by an effect carrying no edit, so a page view that redrew only
 * on `docChanged` paginated an empty layout once and never looked again.
 *
 * These mount a view and count what is on the screen. They are slower and they
 * are the ones that would have caught it.
 */
describe("the sheets a running editor draws", () => {
  /** A mounted view with the page on, rich text on, and a known geometry. */
  function paged(doc: string, perPage: number, measure = 0): EditorView {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          richText(),
          pagination(),
          paginated.of(true),
          linesPerPage.of(perPage),
          charactersPerLine.of(measure),
        ],
      }),
      parent: globalThis.document.body,
    });
    views.push(view);
    // Exactly how the application turns it on: an effect, with no edit.
    view.dispatch({ effects: setRichText.of(true) });
    // And out of the way. Collapsing the preamble pushes the caret to the
    // first position after the fold, and whatever is there is shown as source
    // — which is the right behaviour and the wrong place to be standing when
    // the question is what the page looks like.
    view.dispatch({
      selection: { anchor: view.state.doc.length },
      scrollIntoView: false,
    });
    return view;
  }

  /** How many sheets are drawn. */
  function sheetCount(view: EditorView): number {
    return view.contentDOM.querySelectorAll(".cm-yaz-sheet-first").length;
  }

  it("repaginates when rich text is switched on", () => {
    // The bug, exactly. Switching rich text on folds the preamble away and
    // makes every paragraph wrap, and neither changes the document — so a page
    // view watching only for edits kept the sheets it had.
    const preamble = Array.from(
      { length: 40 },
      (_, index) => `${B}usepackage{p${index}}`,
    ).join("\n");
    const doc = [
      `${B}documentclass{article}`,
      preamble,
      `${B}begin{document}`,
      "The first paragraph.",
      `${B}end{document}`,
    ].join("\n");

    const view = paged(doc, 10);
    // Forty folded lines of preamble are no rows at all, so the whole document
    // is one short sheet of matter and one of text. Counted as source it would
    // have been five sheets.
    expect(sheetCount(view)).toBeLessThan(4);
  });

  it("repaginates when wrapping is switched on", () => {
    const paragraph = "x".repeat(60);
    const body = Array.from({ length: 6 }, () => paragraph).join("\n" + "\n");
    const doc = `${B}begin{document}${nothing}${body}${nothing}${B}end{document}`;

    const narrow = sheetCount(paged(doc, 10, 10));
    const wide = sheetCount(paged(doc, 10, 0));
    expect(narrow).toBeGreaterThan(wide);
  });

  it("draws no blank sheet where two page breaks meet", () => {
    // `\clearpage` before a table of contents is two instructions to begin a
    // page, and beginning a page that has already begun is nothing at all. It
    // was drawing an empty sheet of paper between them.
    const doc = [
      `${B}begin{document}`,
      `${B}begin{titlepage}`,
      "A Thesis",
      `${B}end{titlepage}`,
      `${B}clearpage`,
      `${B}tableofcontents`,
      `${B}clearpage`,
      "The first paragraph.",
      `${B}end{document}`,
    ].join("\n");

    const view = paged(doc, 40);
    for (const sheet of view.contentDOM.querySelectorAll(
      ".cm-yaz-sheet-first",
    )) {
      // Every sheet drawn has something on it.
      expect(sheet.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("gives a divided listing its paper", () => {
    // The second sheet of a glossary is a block widget with no line of its
    // own, so nothing puts the margins on it. It came out as tall as its
    // contents and floating in the middle of the document.
    //
    // Deliberately a small document with a small page. A long one is not more
    // realistic here, it is just outside the viewport: CodeMirror renders what
    // it can see, and in jsdom nothing has a height, so a hundred lines
    // collapse into a `cm-gap` and the assertions test nothing.
    const terms = Array.from(
      { length: 8 },
      (_, index) =>
        `${B}newglossaryentry{g${index}}{name={Term ${index}},description={d}}`,
    ).join("\n");
    const doc = [
      `${B}documentclass{article}`,
      terms,
      `${B}begin{document}`,
      `${B}printglossaries`,
      "",
      "A paragraph after it.",
      `${B}end{document}`,
    ].join("\n");

    const view = paged(doc, 5);
    const carried = view.contentDOM.querySelectorAll(".cm-yaz-listing-sheet");
    expect(carried.length).toBeGreaterThan(0);
    for (const sheet of carried) {
      expect(sheet.classList.contains("cm-yaz-sheet-first")).toBe(true);
      expect(sheet.classList.contains("cm-yaz-sheet-last")).toBe(true);
      expect((sheet as HTMLElement).style.minBlockSize).not.toBe("");
    }
  });

  it("numbers the sheets, and does not number the matter", () => {
    const doc = [
      `${B}documentclass{article}`,
      `${B}begin{document}`,
      "One.",
      `${B}clearpage`,
      "Two.",
      `${B}clearpage`,
      "Three.",
      `${B}end{document}`,
    ].join("\n");

    const view = paged(doc, 40);
    const folios = [...view.contentDOM.querySelectorAll(".cm-yaz-folio")].map(
      (node) => node.textContent,
    );
    // Counting from one at the first sheet of paper: the machinery the file
    // wraps the document in is not page one of the document.
    expect(folios.slice(0, 3)).toEqual(["1", "2", "3"]);
  });

  it("keeps the front matter off the first sheet of paper", () => {
    // What the file wraps the document in is not a page of the document. It
    // was taking the title page's sheet, so the first thing on the paper was
    // the machinery.
    const doc = [
      `${B}documentclass{article}`,
      `${B}usepackage{graphicx}`,
      `${B}begin{document}`,
      "The first paragraph.",
      `${B}end{document}`,
    ].join("\n");

    const view = paged(doc, 40);
    const first = view.contentDOM.querySelector(".cm-yaz-sheet-first");
    expect(first?.classList.contains("cm-yaz-sheet-matter")).toBe(true);
    // And it closes there: the text is on the next sheet, not underneath it.
    expect(first?.classList.contains("cm-yaz-sheet-last")).toBe(true);
  });
});
