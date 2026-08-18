/**
 * Enter and Tab inside a list.
 *
 * Written as text in, text out. The cursor arithmetic in these is the part that
 * is wrong until it is tested — every one of them moves a line and then has to
 * say where the caret went — so each case asserts the whole document *and* the
 * caret, with `|` marking it.
 */

import { describe, expect, it } from "vitest";

import { continueList, indentItem, outdentItem, inList } from "./listEdit";
import type { Edit } from "./listEdit";

/** Apply an edit, without saying where the cursor went. */
function plain(text: string, edit: Edit | null): string | null {
  if (!edit) return null;
  // Applied back to front so earlier offsets are still valid.
  let out = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
}

/** Apply an edit and put `|` where the cursor ended up. */
function apply(text: string, edit: Edit | null): string | null {
  const out = plain(text, edit);
  return out === null
    ? null
    : `${out.slice(0, edit!.cursor)}|${out.slice(edit!.cursor)}`;
}

/** A document with `|` marking the cursor, split into text and offset. */
function at(marked: string): [string, number] {
  const cursor = marked.indexOf("|");
  return [marked.replace("|", ""), cursor];
}

const simple = [
  "\\begin{itemize}",
  "  \\item one",
  "  \\item two",
  "\\end{itemize}",
];

describe("continueList", () => {
  it("starts the next item", () => {
    const [source, position] = at(
      [
        "\\begin{itemize}",
        "  \\item one|",
        "  \\item two",
        "\\end{itemize}",
      ].join("\n"),
    );
    expect(apply(source, continueList(source, position))).toBe(
      [
        "\\begin{itemize}",
        "  \\item one",
        "  \\item |",
        "  \\item two",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("keeps the indentation the list is written with", () => {
    const [source, position] = at(
      ["\\begin{itemize}", "    \\item one|", "\\end{itemize}"].join("\n"),
    );
    expect(apply(source, continueList(source, position))).toContain(
      "\n    \\item |",
    );
  });

  it("gives a description item its label brackets", () => {
    const [source, position] = at(
      ["\\begin{description}", "  \\item[A] first|", "\\end{description}"].join(
        "\n",
      ),
    );
    expect(apply(source, continueList(source, position))).toContain(
      "\\item[] |",
    );
  });

  it("leaves the list when the item is empty", () => {
    // Enter twice to stop being in a list, as every word processor works.
    // Without it, getting out means reaching for the mouse.
    const [source, position] = at(
      ["\\begin{itemize}", "  \\item one", "  \\item |", "\\end{itemize}"].join(
        "\n",
      ),
    );
    expect(apply(source, continueList(source, position))).toBe(
      ["\\begin{itemize}", "  \\item one", "\\end{itemize}|"].join("\n"),
    );
  });

  it("does nothing outside a list", () => {
    // Enter has a job already, and this must not take it.
    const [source, position] = at("Just a paragraph|of prose.");
    expect(continueList(source, position)).toBeNull();
  });
});

describe("indentItem", () => {
  it("nests the item in a sub-list", () => {
    const [source, position] = at(
      [
        "\\begin{itemize}",
        "  \\item one",
        "  \\item tw|o",
        "\\end{itemize}",
      ].join("\n"),
    );
    expect(apply(source, indentItem(source, position))).toBe(
      [
        "\\begin{itemize}",
        "  \\item one",
        "    \\begin{itemize}",
        "      \\item tw|o",
        "    \\end{itemize}",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("joins the sub-list above rather than starting another", () => {
    // Three Tabs in a row should make one sub-list of three, not three
    // sub-lists of one.
    const source = [
      "\\begin{itemize}",
      "  \\item one",
      "    \\begin{itemize}",
      "      \\item two",
      "    \\end{itemize}",
      "  \\item three",
      "\\end{itemize}",
    ].join("\n");
    const result = plain(source, indentItem(source, source.indexOf("three")));
    expect(result).toContain("      \\item two\n      \\item three");
    expect(result?.match(/\\begin\{itemize\}/g)).toHaveLength(2);
  });

  it("refuses the first item of a list", () => {
    // There is nothing above it to be nested under. LaTeX would take it; a
    // reader would not, and neither does Word.
    const [source, position] = at(
      ["\\begin{itemize}", "  \\item on|e", "\\end{itemize}"].join("\n"),
    );
    expect(indentItem(source, position)).toBeNull();
  });

  it("does nothing outside a list", () => {
    const [source, position] = at("Some prose|here.");
    expect(indentItem(source, position)).toBeNull();
  });
});

describe("outdentItem", () => {
  // Items are named rather than lettered: a single letter finds itself inside
  // `\begin` before it finds the item, and the test then asks about a position
  // in the middle of a command.
  const nested = [
    "\\begin{itemize}",
    "  \\item one",
    "    \\begin{itemize}",
    "      \\item alpha",
    "      \\item beta",
    "    \\end{itemize}",
    "\\end{itemize}",
  ];

  it("unwraps a sub-list holding a single item", () => {
    const source = [
      "\\begin{itemize}",
      "  \\item one",
      "    \\begin{itemize}",
      "      \\item only",
      "    \\end{itemize}",
      "\\end{itemize}",
    ].join("\n");
    // The cursor keeps its place within the item, which was the start of the
    // word — so it lands at the start of the word, two columns to the left.
    expect(apply(source, outdentItem(source, source.indexOf("only")))).toBe(
      [
        "\\begin{itemize}",
        "  \\item one",
        "  \\item |only",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("moves the last item out below the sub-list", () => {
    const source = nested.join("\n");
    const result = plain(source, outdentItem(source, source.indexOf("beta")));
    expect(result).toContain(
      "      \\item alpha\n    \\end{itemize}\n  \\item beta",
    );
  });

  it("splits the list around an item taken from the middle", () => {
    // Anything else would silently reorder the author's items.
    const source = [
      "\\begin{itemize}",
      "  \\item one",
      "    \\begin{itemize}",
      "      \\item alpha",
      "      \\item beta",
      "      \\item gamma",
      "    \\end{itemize}",
      "\\end{itemize}",
    ].join("\n");
    const result = plain(source, outdentItem(source, source.indexOf("beta")))!;
    // alpha stays above, beta comes out, gamma stays below — in that order.
    expect(result.indexOf("item alpha")).toBeLessThan(
      result.indexOf("item beta"),
    );
    expect(result.indexOf("item beta")).toBeLessThan(
      result.indexOf("item gamma"),
    );
    expect(result.match(/\\begin\{itemize\}/g)).toHaveLength(3);
  });

  it("refuses at the outermost level", () => {
    // There is nothing to lift out of, and Tab has its own job.
    const [source, position] = at(
      ["\\begin{itemize}", "  \\item on|e", "\\end{itemize}"].join("\n"),
    );
    expect(outdentItem(source, position)).toBeNull();
  });
});

describe("inList", () => {
  it("knows the difference", () => {
    const source = simple.join("\n");
    expect(inList(source, source.indexOf("two"))).toBe(true);
    expect(inList("Just prose.", 4)).toBe(false);
  });
});
