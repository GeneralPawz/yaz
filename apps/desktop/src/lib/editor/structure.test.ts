/**
 * Structure scanning.
 *
 * The cases here are the ones that appear in real papers and quietly break a
 * naive scan: nested braces in a title, a commented-out section, the starred
 * form, the optional short title, and an unclosed brace.
 */

import { describe, expect, it } from "vitest";

import {
  braceCommands,
  commentRanges,
  documentTitle,
  environments,
  headings,
  itemMarkers,
  mathSpans,
  matchBrace,
  plainText,
  preamble,
} from "./structure";

describe("matchBrace", () => {
  it("finds the end of a simple group", () => {
    expect(matchBrace("{abc}", 0)).toBe(5);
  });

  it("counts nesting", () => {
    // `\section{The \emph{good} bit}` is entirely ordinary.
    const text = "{The \\emph{good} bit}";
    expect(matchBrace(text, 0)).toBe(text.length);
  });

  it("honours escaped braces", () => {
    // A literal brace in a title is written `\{`, and must not close the group.
    const text = "{a \\{ b}";
    expect(matchBrace(text, 0)).toBe(text.length);
  });

  it("returns null rather than guessing at an unclosed group", () => {
    // Guessing turns one missing brace into every later heading being wrong.
    expect(matchBrace("{never closed", 0)).toBeNull();
  });

  it("refuses to start anywhere but a brace", () => {
    expect(matchBrace("abc", 0)).toBeNull();
  });
});

describe("headings", () => {
  it("finds sections with their levels", () => {
    const text = "\\section{One}\n\\subsection{Two}\n\\subsubsection{Three}";
    const found = headings(text);
    expect(found.map((h) => h.title)).toEqual(["One", "Two", "Three"]);
    expect(found.map((h) => h.level)).toEqual([2, 3, 4]);
  });

  it("does not mistake a longer command for a shorter one", () => {
    // `subsubsection` starts with `subsection`, so order of matching matters.
    const found = headings("\\subsubsection{Deep}");
    expect(found).toHaveLength(1);
    expect(found[0]!.command).toBe("subsubsection");
    expect(found[0]!.level).toBe(4);
  });

  it("is not fooled by a command that merely starts the same way", () => {
    // `\sectioning` is not a section.
    expect(headings("\\sectioning{no}")).toHaveLength(0);
  });

  it("handles the starred form", () => {
    const found = headings("\\section*{Acknowledgements}");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("Acknowledgements");
    expect(found[0]!.starred).toBe(true);
  });

  it("skips the optional short title and reports the real one", () => {
    // The short form exists for the contents page; the outline should say what
    // the section is actually called.
    const found = headings("\\section[Short]{A rather longer title}");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("A rather longer title");
  });

  it("keeps nested markup in the title but reports it plainly", () => {
    const found = headings("\\section{The \\emph{good} bit}");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("The \\emph{good} bit");
    expect(plainText(found[0]!.title)).toBe("The good bit");
  });

  it("ignores a commented-out section", () => {
    // Commenting a section out is exactly what people do, and seeing it in the
    // outline would be worse than not having an outline.
    const found = headings("% \\section{Not really}\n\\section{Real}");
    expect(found.map((h) => h.title)).toEqual(["Real"]);
  });

  it("does not treat an escaped percent as a comment", () => {
    // `50\% faster` is prose, not a comment.
    const found = headings("\\section{50\\% faster}");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("50\\% faster");
  });

  it("skips an unclosed heading rather than swallowing the document", () => {
    const found = headings("\\section{Unclosed\n\\section{Fine}");
    // The first cannot be matched; the second is inside it as far as brace
    // counting is concerned, so nothing is reported rather than something wrong.
    expect(found.every((h) => h.title !== "Unclosed")).toBe(true);
  });

  it("reports offsets that address the source", () => {
    const text = "intro\n\\section{Body}\nmore";
    const [heading] = headings(text);
    expect(text.slice(heading!.from, heading!.to)).toBe("\\section{Body}");
    expect(text.slice(heading!.titleFrom, heading!.titleTo)).toBe("Body");
  });

  it("finds nothing in a document with no sections", () => {
    expect(headings("Just prose.\n\nMore prose.")).toEqual([]);
    expect(headings("")).toEqual([]);
  });
});

describe("commentRanges", () => {
  it("runs a comment to the end of the line", () => {
    const text = "a % comment\nb";
    expect(commentRanges(text)).toEqual([{ from: 2, to: 11 }]);
  });

  it("ignores an escaped percent", () => {
    expect(commentRanges("100\\% done")).toEqual([]);
  });
});

describe("plainText", () => {
  it("keeps the words and drops the markup", () => {
    expect(plainText("The \\emph{good} bit")).toBe("The good bit");
    expect(plainText("\\textbf{Bold} and \\textit{italic}")).toBe(
      "Bold and italic",
    );
  });

  it("keeps escaped characters as themselves", () => {
    expect(plainText("Cost \\& risk")).toBe("Cost & risk");
    expect(plainText("50\\% faster")).toBe("50% faster");
  });

  it("collapses whitespace", () => {
    expect(plainText("Spread   over\n  lines")).toBe("Spread over lines");
  });
});

describe("documentTitle", () => {
  it("reads the title", () => {
    expect(documentTitle("\\title{A Paper}\n\\begin{document}")).toBe(
      "A Paper",
    );
  });

  it("strips markup from it", () => {
    expect(documentTitle("\\title{A \\emph{Good} Paper}")).toBe("A Good Paper");
  });

  it("is null when there is none", () => {
    expect(documentTitle("\\section{No title here}")).toBeNull();
  });

  it("ignores a commented-out title", () => {
    expect(documentTitle("% \\title{Draft}\n\\title{Final}")).toBe("Final");
  });
});

describe("braceCommands", () => {
  it("finds a command and its argument", () => {
    const text = String.raw`some \textbf{bold} text`;
    const [found] = braceCommands(text, ["textbf"]);
    expect(text.slice(found!.from, found!.to)).toBe(String.raw`\textbf{bold}`);
    expect(text.slice(found!.argFrom, found!.argTo)).toBe("bold");
  });

  it("reports nested commands as well as the outer one", () => {
    // The rich-text view styles them independently, so both are needed.
    const found = braceCommands(String.raw`\textbf{very \emph{good}}`, [
      "textbf",
      "emph",
    ]);
    expect(found.map((f) => f.command).sort()).toEqual(["emph", "textbf"]);
  });

  it("is not fooled by a longer command name", () => {
    expect(braceCommands(String.raw`\textbfx{no}`, ["textbf"])).toHaveLength(0);
    // And matches the longest name that does apply.
    const found = braceCommands(String.raw`\textit{x}`, ["textit", "text"]);
    expect(found[0]!.command).toBe("textit");
  });

  it("skips a command with no brace argument", () => {
    expect(braceCommands(String.raw`\emph and then`, ["emph"])).toHaveLength(0);
  });

  it("ignores commands inside comments", () => {
    const found = braceCommands(`% \\emph{hidden}\n\\emph{shown}`, ["emph"]);
    expect(found).toHaveLength(1);
    expect(found[0]!.argFrom).toBeGreaterThan(15);
  });
});

describe("environments", () => {
  it("pairs begin with end", () => {
    const text = "\\begin{itemize}\nbody\n\\end{itemize}";
    const [found] = environments(text, ["itemize"]);
    expect(text.slice(found!.from, found!.to)).toBe(text);
    expect(text.slice(found!.bodyFrom, found!.bodyTo)).toBe("\nbody\n");
  });

  it("nests the same environment correctly", () => {
    // A list inside a list is ordinary, and pairing by position rather than by
    // a stack would close the outer one at the inner `\end`.
    const text =
      "\\begin{itemize}\n\\begin{itemize}\nx\n\\end{itemize}\n\\end{itemize}";
    const found = environments(text, ["itemize"]);
    expect(found).toHaveLength(2);
    expect(found[0]!.from).toBe(0);
    expect(found[0]!.to).toBe(text.length);
    expect(found[1]!.depth).toBe(1);
  });

  it("reports them in reading order", () => {
    // The stack closes them innermost-first, which is not the order a reader
    // or a decoration builder wants.
    const found = environments("\\begin{a}\\begin{b}\\end{b}\\end{a}");
    expect(found.map((environment) => environment.name)).toEqual(["a", "b"]);
  });

  it("ignores an unmatched end", () => {
    // Half-written source is the normal state of a document being typed.
    const found = environments(
      "\\end{itemize}\n\\begin{itemize}\nx\n\\end{itemize}",
    );
    expect(found).toHaveLength(1);
  });

  it("is not fooled by a command that starts the same way", () => {
    expect(environments("\\beginning{x}")).toHaveLength(0);
  });

  it("skips a commented-out environment", () => {
    expect(environments("% \\begin{itemize}\n\\end{itemize}")).toHaveLength(0);
  });

  it("keeps the star in the name", () => {
    expect(environments("\\begin{align*}x\\end{align*}")[0]!.name).toBe(
      "align*",
    );
  });
});

describe("mathSpans", () => {
  it("finds inline and display delimiters", () => {
    const text = "a $x$ b $$y$$ c \\(z\\) d \\[w\\]";
    const found = mathSpans(text);
    expect(found.map((span) => text.slice(span.bodyFrom, span.bodyTo))).toEqual(
      ["x", "y", "z", "w"],
    );
    expect(found.map((span) => span.display)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("does not read an escaped dollar as mathematics", () => {
    // `\$5` is a price.
    expect(mathSpans("costs \\$5 and \\$10")).toEqual([]);
  });

  it("refuses to run across a blank line", () => {
    // Which is what stops two prices in a draft turning the words between them
    // into a formula. It is also LaTeX's own rule.
    expect(mathSpans("costs $5 and\n\n$10 more")).toEqual([]);
  });

  it("ignores mathematics in a comment", () => {
    expect(mathSpans("% $x$\n$y$")).toHaveLength(1);
  });

  it("leaves an unterminated formula alone", () => {
    expect(mathSpans("half written $x^2")).toEqual([]);
  });

  it("ignores empty delimiters", () => {
    expect(mathSpans("nothing $$ here")).toEqual([]);
  });
});

describe("preamble", () => {
  it("runs to the end of the begin", () => {
    const text = "\\documentclass{article}\n\\begin{document}\nBody";
    const found = preamble(text);
    expect(text.slice(found!.from, found!.to)).toBe(
      "\\documentclass{article}\n\\begin{document}",
    );
  });

  it("is null for a fragment", () => {
    // An `\input`-ed chapter has no preamble, and folding its first line away
    // would hide the author's actual first paragraph.
    expect(preamble("\\section{Chapter}\nText.")).toBeNull();
  });

  it("ignores a commented-out one", () => {
    const text = "% \\begin{document}\n\\begin{document}\nBody";
    expect(preamble(text)!.to).toBe(text.indexOf("\\begin{document}", 5) + 16);
  });
});

describe("itemMarkers", () => {
  it("finds items and the space after them", () => {
    const text = "\\item one\n\\item two";
    const found = itemMarkers(text);
    expect(found).toHaveLength(2);
    expect(text.slice(found[0]!.from, found[0]!.to)).toBe("\\item ");
  });

  it("reads the optional label", () => {
    const text = "\\item[Term] meaning";
    const [found] = itemMarkers(text);
    expect(text.slice(found!.labelFrom!, found!.labelTo!)).toBe("Term");
    expect(text.slice(found!.from, found!.to)).toBe("\\item[Term] ");
  });

  it("is not fooled by a longer command", () => {
    expect(itemMarkers("\\itemsep 2pt")).toHaveLength(0);
  });

  it("skips a commented-out item", () => {
    expect(itemMarkers("% \\item hidden\n\\item shown")).toHaveLength(1);
  });
});
