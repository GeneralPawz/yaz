/**
 * Formatting a selection.
 *
 * The toggling is the part worth pinning. A command that only wraps turns
 * `\textbf{word}` into `\textbf{\textbf{word}}` on the second press, and a
 * shortcut you cannot press twice is one you have to look at the document
 * before using.
 */

import { describe, expect, it } from "vitest";

import {
  clearFormatting,
  toggleEnvironment,
  toggleHeading,
  toggleInline,
} from "./formatting";
import type { Edit } from "./formatting";

/** Apply an edit and mark the selection with «». */
function apply(text: string, edit: Edit): string {
  let out = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return `${out.slice(0, edit.from)}«${out.slice(edit.from, edit.to)}»${out.slice(edit.to)}`;
}

/** A document with «» marking the selection. */
function select(marked: string): [string, number, number] {
  const from = marked.indexOf("«");
  const to = marked.indexOf("»") - 1;
  return [marked.replace("«", "").replace("»", ""), from, to];
}

describe("toggleInline", () => {
  it("wraps a selection", () => {
    const [text, from, to] = select("make «this» bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make \\textbf{«this»} bold",
    );
  });

  it("takes it off again", () => {
    const [text, from, to] = select("make \\textbf{«this»} bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make «this» bold",
    );
  });

  it("un-bolds from anywhere inside the run", () => {
    // Pressing the shortcut in the middle of bold text means "stop this being
    // bold", not "bold one word inside it".
    const [text, from, to] = select("make \\textbf{a whole «run» of it} bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make a whole «run» of it bold",
    );
  });

  it("leaves a different command alone", () => {
    // Italic inside bold is a real thing to want.
    const [text, from, to] = select("\\textbf{make «this» italic}");
    expect(apply(text, toggleInline(text, from, to, "textit"))).toBe(
      "\\textbf{make \\textit{«this»} italic}",
    );
  });

  it("puts the cursor between the braces with nothing selected", () => {
    const text = "type here: ";
    const edit = toggleInline(text, text.length, text.length, "textbf");
    expect(apply(text, edit)).toBe("type here: \\textbf{«»}");
  });
});

describe("toggleEnvironment", () => {
  it("quotes whole lines", () => {
    // A quotation is a block. Quoting half a line would produce something that
    // compiles and reads as a mistake.
    const [text, from, to] = select("Before\nA «quoted» passage\nAfter");
    const result = apply(text, toggleEnvironment(text, from, to, "quote"));
    expect(result).toContain(
      "\\begin{quote}\nA «quoted» passage\n\\end{quote}",
    );
    expect(result).toContain("Before\n");
  });

  it("unquotes what is already quoted", () => {
    const [text, from, to] = select(
      "\\begin{quote}\nA «quoted» passage\n\\end{quote}",
    );
    expect(apply(text, toggleEnvironment(text, from, to, "quote"))).toBe(
      "A «quoted» passage",
    );
  });
});

describe("toggleHeading", () => {
  it("makes a line a heading", () => {
    const text = "Introduction";
    expect(apply(text, toggleHeading(text, 4, 1))).toBe(
      "\\section{Introduction«»}",
    );
  });

  it("takes the heading off when the same level is asked for again", () => {
    const text = "\\section{Introduction}";
    expect(apply(text, toggleHeading(text, 12, 1))).toBe("«Introduction»");
  });

  it("changes level rather than nesting", () => {
    // Asking for a subsection while on a section means "make it a subsection",
    // not "put a subsection inside the section's title".
    const text = "\\section{Introduction}";
    expect(apply(text, toggleHeading(text, 12, 2))).toBe(
      "\\subsection{Introduction«»}",
    );
  });

  it("keeps the line's indentation", () => {
    const text = "  Nested heading";
    expect(apply(text, toggleHeading(text, 5, 3))).toBe(
      "  \\subsubsection{Nested heading«»}",
    );
  });
});

describe("clearFormatting", () => {
  it("removes the formatting it knows", () => {
    const [text, from, to] = select("«\\textbf{bold} and \\textit{italic}»");
    expect(apply(text, clearFormatting(text, from, to))).toBe(
      "«bold and italic»",
    );
  });

  it("leaves commands it did not apply", () => {
    // A "clear formatting" button that also removed a citation would be a
    // data-loss button wearing a tidy label.
    const [text, from, to] = select("«\\textbf{bold} \\cite{smith2020}»");
    expect(apply(text, clearFormatting(text, from, to))).toContain(
      "\\cite{smith2020}",
    );
  });

  it("does nothing when there is nothing to clear", () => {
    const [text, from, to] = select("«plain text»");
    expect(clearFormatting(text, from, to).changes).toEqual([]);
  });
});
