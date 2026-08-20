/**
 * The two languages written here rather than pulled in.
 *
 * A highlighter is hard to assert about directly — the output is colours — so
 * what these check is the property that actually breaks: that the tokeniser
 * always advances. A stream language that returns without consuming a
 * character hangs CodeMirror in a loop, which is the one failure mode worth a
 * test, and it is invisible until a particular file opens.
 */

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { bibtex } from "./bibtex";
import { markdown } from "./markdown";

const B = String.fromCharCode(92);

/**
 * Parse a document, and report how far the parse actually got.
 *
 * `ensureSyntaxTree` is what forces it: a `StreamLanguage` parses lazily, so
 * merely building a state runs nothing and a test written against that would
 * pass for a tokeniser that cannot tokenise. A tree that reaches the end of the
 * document is the evidence that every line was consumed.
 */
function parsedTo(language: Extension, doc: string): number {
  const state = EditorState.create({ doc, extensions: [language] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  return tree?.length ?? -1;
}

describe("the Markdown language", () => {
  const language = markdown();

  it("gets through a document without hanging", () => {
    const doc = [
      "# Ein Titel",
      "",
      "Ein Absatz mit **fett** und *kursiv* und `code`.",
      "",
      "- Ein Punkt",
      "- Noch einer",
      "",
      "> Ein Zitat",
      "",
      "[ein Link](https://example.com)",
      "",
      "---",
      "",
      "```ts",
      "# nicht eine Überschrift",
      "const x = 1;",
      "```",
      "",
      "Danach.",
    ].join("\n");
    expect(parsedTo(language, doc)).toBe(doc.length);
  });

  it("copes with the shapes that could stall it", () => {
    // Unclosed emphasis, an unterminated fence, a lone asterisk: each one is a
    // branch that could match nothing and consume nothing.
    for (const doc of ["*", "**", "`", "```", "[", "![](", "#", "- ", ">"]) {
      expect(parsedTo(language, doc)).toBe(doc.length);
    }
  });
});

describe("the BibTeX language", () => {
  const language = bibtex();

  it("gets through an entry without hanging", () => {
    const doc = [
      "% Ein Kommentar",
      "@article{meister2021,",
      "  author = {Meister, Anna and Schmidt, Bernd},",
      "  title = {Ein {BIM} Titel},",
      "  year = 2021,",
      '  journal = "Eine Zeitschrift"',
      "}",
    ].join("\n");
    expect(parsedTo(language, doc)).toBe(doc.length);
  });

  it("copes with the shapes that could stall it", () => {
    for (const doc of [
      "@",
      "@article{",
      "{",
      "}",
      "=",
      '"',
      "@article{a,b={",
    ]) {
      expect(parsedTo(language, doc)).toBe(doc.length);
    }
  });

  it("is not confused by a LaTeX command in a field", () => {
    const doc = `@book{x, title = {Ein ${B}emph{gutes} Buch}}`;
    expect(parsedTo(language, doc)).toBe(doc.length);
  });
});
