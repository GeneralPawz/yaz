/**
 * Where a page begins, and how tall a page is.
 *
 * The second question used to be the hard one, and it is not a question any
 * more: a sheet is a fixed box painted behind the text, so it is exactly the
 * size of the paper whatever the content does. What is left to test is the two
 * things that can still be wrong — the instructions an author wrote about where
 * pages start, and the arithmetic that carries a block onto the next sheet.
 *
 * The measuring itself is not tested here. jsdom gives every element a height
 * of zero, so a test that drove the view would be measuring nothing and
 * agreeing with itself.
 */

import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { pitchOf, sheetAt, textBounds } from "./geometry";
import type { Paper } from "./geometry";
import { forcedBreaks, turnedRegions } from "./pagination";
import { richText, richTextEnabled } from "./richText";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);
const NEWLINE = "\n";

/**
 * Install the packages, the way a running yaz gets them.
 *
 * The real plugin's table rather than a fixture, so what these exercise is what
 * a user has — `landscape` is pdflscape's and yaz does not know it alone.
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

/** A4 at 96 dpi, near enough, with the usual margins. */
const A4: Paper = {
  height: 1122,
  width: 794,
  margin: 94,
  gap: 30,
  turnedHeight: 794,
};

/** A state with rich text really running over it. */
function drawn(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [richText(), richTextEnabled.init(() => true)],
  });
}

/** Which line each forced break falls on. */
function breakLines(doc: string): number[] {
  const state = drawn(doc);
  return [...forcedBreaks(state)]
    .map((offset) => state.doc.lineAt(offset).number)
    .sort((a, b) => a - b);
}

describe("the shape of the paper", () => {
  it("puts every sheet exactly one pitch below the last", () => {
    // The whole point of the rewrite. There is no arrangement of content that
    // can make one sheet taller than another, because a sheet is not made of
    // content.
    const pitch = pitchOf(A4);
    expect(pitch).toBe(A4.height + A4.gap);
    for (let index = 0; index < 5; index += 1) {
      const bounds = textBounds(A4, index);
      expect(bounds.to - bounds.from).toBe(A4.height - 2 * A4.margin);
      expect(bounds.from).toBe(index * pitch + A4.margin);
    }
  });

  it("says which sheet a position falls on", () => {
    const pitch = pitchOf(A4);
    expect(sheetAt(A4, 0)).toBe(0);
    expect(sheetAt(A4, A4.height - 1)).toBe(0);
    expect(sheetAt(A4, pitch)).toBe(1);
    expect(sheetAt(A4, pitch * 3 + 10)).toBe(3);
    // Above the first sheet is still the first sheet, not a negative one.
    expect(sheetAt(A4, -50)).toBe(0);
  });
});

describe("the breaks a document asks for", () => {
  it("begins a page after a page break", () => {
    const doc = [
      `${B}begin{document}`,
      "One.",
      `${B}clearpage`,
      "Two.",
      `${B}end{document}`,
    ].join(NEWLINE);
    expect(breakLines(doc)).toContain(4);
  });

  it("clears the page at the end of a title page", () => {
    // `\\end{titlepage}` clears the page in LaTeX itself. Without this the
    // contents was drawn on top of the title, which is not what the document
    // says and not what the PDF does.
    const doc = [
      `${B}begin{document}`,
      `${B}begin{titlepage}`,
      "A Thesis",
      `${B}end{titlepage}`,
      `${B}tableofcontents`,
      `${B}end{document}`,
    ].join(NEWLINE);
    const lines = breakLines(doc);
    expect(lines).toContain(2);
    expect(lines).toContain(5);
  });

  it("gives a generated list a page of its own, and one after it", () => {
    const doc = [
      `${B}begin{document}`,
      `${B}tableofcontents`,
      "The first paragraph.",
      `${B}end{document}`,
    ].join(NEWLINE);
    const lines = breakLines(doc);
    expect(lines).toContain(2);
    expect(lines).toContain(3);
  });

  it("turns the page for a turned environment, and turns it back", () => {
    const doc = [
      `${B}begin{document}`,
      "Before.",
      `${B}begin{landscape}`,
      "A wide table.",
      `${B}end{landscape}`,
      "After.",
      `${B}end{document}`,
    ].join(NEWLINE);
    const lines = breakLines(doc);
    // A sheet cannot be half turned, so the turn begins one and ends one.
    expect(lines).toContain(3);
    expect(lines).toContain(6);
  });

  it("opens a page for a chapter, but only where chapters exist", () => {
    const withChapters = [
      `${B}documentclass{report}`,
      `${B}begin{document}`,
      `${B}chapter{One}`,
      "Text.",
      `${B}end{document}`,
    ].join(NEWLINE);
    expect(breakLines(withChapters)).toContain(3);

    // `article` has no `\\chapter`, and opening a page at every section would
    // shred a paper into a page per heading.
    const withSections = [
      `${B}documentclass{article}`,
      `${B}begin{document}`,
      `${B}section{One}`,
      "Text.",
      `${B}end{document}`,
    ].join(NEWLINE);
    expect(breakLines(withSections)).not.toContain(3);
  });

  it("starts the paper after the matter the file wraps it in", () => {
    // The preamble is not a page of the document — it is what the `.tex`
    // wraps the document in — so the paper begins after it.
    const doc = [
      `${B}documentclass{article}`,
      `${B}usepackage{graphicx}`,
      `${B}begin{document}`,
      "The first paragraph.",
      `${B}end{document}`,
    ].join(NEWLINE);
    const state = drawn(doc);
    const lines = [...forcedBreaks(state)].map(
      (offset) => state.doc.lineAt(offset).number,
    );
    expect(lines.length).toBeGreaterThan(0);
  });

  it("asks for nothing from a document that says nothing", () => {
    const doc = ["Just prose.", "And more of it."].join(NEWLINE);
    expect(breakLines(doc)).toEqual([]);
  });
});

describe("where the paper is turned", () => {
  it("finds a turned environment", () => {
    const doc = `${B}begin{landscape}wide${B}end{landscape}`;
    expect(turnedRegions(doc)).toHaveLength(1);
  });

  it("finds none when the package that provides it is absent", () => {
    // `landscape` is pdflscape's, so a yaz without that plugin does not know
    // it — and a document using it simply has no turned regions, which is the
    // right answer rather than an error.
    setContributions([]);
    const doc = `${B}begin{landscape}wide${B}end{landscape}`;
    expect(turnedRegions(doc)).toEqual([]);
  });
});
