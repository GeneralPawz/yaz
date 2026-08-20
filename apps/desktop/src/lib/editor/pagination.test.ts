/**
 * Where a page ends.
 *
 * These check the arithmetic and not the drawing, because the arithmetic is
 * the part that can be wrong without looking wrong: a break in the right place
 * for the wrong reason and a break in the wrong place look identical on screen
 * until the document changes underneath them.
 */

import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  linesPerPage,
  pageStarts,
  paginated,
  turnedRegions,
} from "./pagination";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

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
