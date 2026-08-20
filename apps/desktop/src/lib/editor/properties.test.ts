/**
 * Reading and writing the standardised parts of a document.
 *
 * These exist so the ribbon can set an author without the author knowing what
 * `\author` is. The tests are about where things land: a property written to
 * the wrong place in a preamble either does nothing or breaks the compile, and
 * neither says so at the moment it is set.
 */

import { describe, expect, it } from "vitest";

import { isJustified, readProperties, setProperty } from "./properties";
import type { Edit } from "./properties";

/** Apply an edit. */
function apply(text: string, edit: Edit | null): string {
  return edit === null
    ? text
    : text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

const paper = [
  "\\documentclass{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage[a4paper,margin=1in]{geometry}",
  "\\usepackage[ngerman]{babel}",
  "\\title{A Paper}",
  "\\author{Someone}",
  "\\begin{document}",
  "Text.",
  "\\end{document}",
].join("\n");

describe("readProperties", () => {
  it("reads what the document declares", () => {
    expect(readProperties(paper)).toEqual({
      title: "A Paper",
      author: "Someone",
      date: "",
      language: "ngerman",
      paper: "a4paper",
    });
  });

  it("assumes A4 when the document says nothing", () => {
    // Which is what LaTeX does not do — its default is US letter — but is what
    // every reader of this application expects, and the ribbon writes the
    // choice out explicitly the moment it is touched.
    expect(readProperties("\\documentclass{article}").paper).toBe("a4paper");
  });

  it("strips markup out of a title", () => {
    // The ribbon shows a text field, and `\emph{Good}` in one reads as a
    // mistake rather than as emphasis.
    expect(readProperties("\\title{A \\emph{Good} Paper}").title).toBe(
      "A Good Paper",
    );
  });

  it("ignores a commented-out declaration", () => {
    expect(readProperties("% \\title{Draft}\n\\title{Final}").title).toBe(
      "Final",
    );
  });
});

describe("setProperty", () => {
  it("edits a declaration that is already there", () => {
    expect(
      apply(paper, setProperty(paper, "author", "Someone Else")),
    ).toContain("\\author{Someone Else}");
  });

  it("puts a missing one just above \\begin{document}", () => {
    // Where a reader looking for the title expects it, rather than wherever
    // the file happened to end.
    const without =
      "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}";
    const result = apply(without, setProperty(without, "title", "New"));
    expect(result).toBe(
      "\\documentclass{article}\n\\title{New}\n\\begin{document}\nText.\n\\end{document}",
    );
  });

  it("replaces a paper size rather than adding a second", () => {
    // `[a4paper,a5paper]` is not a document with two paper sizes; it is a
    // document with a mistake in it.
    const result = apply(paper, setProperty(paper, "paper", "letterpaper"));
    expect(result).toContain("\\usepackage[margin=1in,letterpaper]{geometry}");
    expect(result).not.toContain("a4paper");
  });

  it("keeps the other options of the package it edits", () => {
    expect(apply(paper, setProperty(paper, "paper", "a5paper"))).toContain(
      "margin=1in",
    );
  });

  it("adds the package when the document does not have it", () => {
    const without =
      "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    expect(apply(without, setProperty(without, "paper", "a4paper"))).toContain(
      "\\usepackage[a4paper]{geometry}",
    );
  });

  it("changes the language babel is loaded with", () => {
    expect(apply(paper, setProperty(paper, "language", "french"))).toContain(
      "\\usepackage[french]{babel}",
    );
  });

  it("does nothing when the value is already what was asked for", () => {
    // An edit that changes nothing is still an undo step, and a ribbon that
    // produced one per keystroke would fill the history with nothing.
    expect(setProperty(paper, "author", "Someone")).toBeNull();
  });

  it("does not add an empty declaration", () => {
    const without =
      "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    expect(setProperty(without, "title", "")).toBeNull();
  });
});

describe("isJustified", () => {
  it("is true for a document that says nothing", () => {
    // LaTeX justifies by default, so silence means justified.
    expect(isJustified("\\documentclass{article}")).toBe(true);
  });

  it("is false when the document turns it off", () => {
    expect(isJustified("\\documentclass{article}\n\\raggedright")).toBe(false);
  });

  it("is false for ragged2e set document-wide", () => {
    // The one form that is an option rather than a command in the text.
    expect(isJustified("\\usepackage[document]{ragged2e}")).toBe(false);
  });

  it("is true for ragged2e without the option", () => {
    // Loading the package only makes its commands available; it changes
    // nothing on its own.
    expect(isJustified("\\usepackage{ragged2e}")).toBe(true);
  });
});
