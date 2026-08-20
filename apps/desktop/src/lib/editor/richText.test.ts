/**
 * What rich text actually renders.
 *
 * These drive a real CodeMirror view, because the questions worth asking are
 * about the rendered result: is the markup gone, does it come back when the
 * cursor arrives, and — the one that matters most — is the buffer still the
 * `.tex` the compiler will see (ADR-0004).
 *
 * `textContent` of the content element is what the reader sees: replaced ranges
 * are not in the DOM at all, and a widget contributes its own text.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { richText, setRichText, setWrapperCollapsed } from "./richText";

beforeAll(() => {
  // CodeMirror measures its own layout; jsdom implements neither of these.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

/** A view over `doc`, with rich text on unless told otherwise. */
function mount(doc: string, rich = true): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: document.body,
  });
  views.push(view);
  if (rich) view.dispatch({ effects: setRichText.of(true) });
  return view;
}

/**
 * What the reader sees, with typeset mathematics taken out.
 *
 * KaTeX embeds the original TeX in a MathML `<annotation>` so that a screen
 * reader can say it and a copy carries it. That text is in `textContent`, so
 * without removing it a rendered formula reads as though its source were still
 * on the page — which is the very thing these tests ask about.
 */
function visible(view: EditorView): string {
  const clone = view.contentDOM.cloneNode(true) as HTMLElement;
  for (const rendered of clone.querySelectorAll(".katex")) rendered.remove();
  return clone.textContent ?? "";
}

/** Put the cursor at an offset. */
function caret(view: EditorView, at: number): void {
  view.dispatch({ selection: EditorSelection.cursor(at) });
}

describe("the buffer", () => {
  it("is the LaTeX, whatever is rendered over it", () => {
    // The load-bearing assertion of ADR-0004. If this ever fails, rich text has
    // become a second document model and the round-trip guarantee is gone.
    const doc = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Results}",
      "The value $x^2$ holds.",
      "\\begin{itemize}",
      "\\item one",
      "\\end{itemize}",
      "\\end{document}",
    ].join("\n");
    const view = mount(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("renders as itself with rich text off", () => {
    const doc = "\\section{Plain}\nA $\\gamma$ here.";
    const view = mount(doc, false);
    expect(visible(view)).toContain("\\section{Plain}");
    expect(visible(view)).toContain("$\\gamma$");
  });
});

describe("mathematics", () => {
  it("typesets inline mathematics and hides its delimiters", () => {
    const view = mount("The value $x^2$ holds.");
    expect(view.contentDOM.querySelector(".katex")).not.toBeNull();
    expect(visible(view)).not.toContain("$x^2$");
  });

  it("gives the source back when the cursor reaches it", () => {
    const doc = "The value $x^2$ holds.";
    const view = mount(doc);
    expect(visible(view)).not.toContain("$x^2$");
    caret(view, doc.indexOf("x^2"));
    expect(visible(view)).toContain("$x^2$");
  });

  it("puts the cursor in the formula when it is clicked", () => {
    // Without this the widget swallows the click and the only way into the
    // source is to arrow in from outside, which nobody would guess.
    const doc = "Before $a+b$ after.";
    const view = mount(doc);
    const widget = view.contentDOM.querySelector(".cm-yaz-math");
    expect(widget).not.toBeNull();

    widget!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.state.selection.main.head).toBe(doc.indexOf("$a+b$"));
    expect(visible(view)).toContain("$a+b$");
  });

  it("typesets a display environment", () => {
    const view = mount("Then:\n\\begin{equation}\nE = mc^2\n\\end{equation}");
    expect(
      view.contentDOM.querySelector(".cm-yaz-math-display"),
    ).not.toBeNull();
    expect(visible(view)).not.toContain("\\begin{equation}");
  });

  it("leaves mathematics KaTeX will not take as source", () => {
    // Half-written mathematics is the normal state of mathematics being
    // written, and an error message in its place would be worse than the source.
    const view = mount("Broken $\\frac{1$ here.");
    expect(visible(view)).toContain("$\\frac{1$");
  });

  it("does not treat two prices as a formula", () => {
    const doc = "It costs $5 and\n\n$10 more.";
    const view = mount(doc);
    expect(visible(view)).toContain("$5 and");
  });
});

describe("lists", () => {
  it("draws bullets and hides the environment", () => {
    const view = mount(
      "Points:\n\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}",
    );
    const shown = visible(view);
    expect(shown).not.toContain("\\begin{itemize}");
    expect(shown).not.toContain("\\item");
    expect(shown).toContain("•one");
    expect(shown).toContain("•two");
  });

  it("numbers an enumeration", () => {
    const view = mount(
      "Steps:\n\\begin{enumerate}\n\\item first\n\\item second\n\\end{enumerate}",
    );
    const shown = visible(view);
    expect(shown).toContain("1.first");
    expect(shown).toContain("2.second");
  });

  it("uses a different bullet inside a nested list", () => {
    const view = mount(
      [
        "Points:",
        "\\begin{itemize}",
        "\\item outer",
        "\\begin{itemize}",
        "\\item inner",
        "\\end{itemize}",
        "\\end{itemize}",
      ].join("\n"),
    );
    const shown = visible(view);
    expect(shown).toContain("•outer");
    expect(shown).toContain("◦inner");
  });

  it("shows the label a description item was given", () => {
    const view = mount(
      "Terms:\n\\begin{description}\n\\item[Term] meaning\n\\end{description}",
    );
    expect(visible(view)).toContain("Term");
  });

  it("gives the marker back when the cursor is on it", () => {
    const doc = "Points:\n\\begin{itemize}\n\\item one\n\\end{itemize}";
    const view = mount(doc);
    expect(visible(view)).not.toContain("\\item");
    caret(view, doc.indexOf("\\item") + 2);
    expect(visible(view)).toContain("\\item");
  });
});

describe("tables", () => {
  const doc = [
    "Results:",
    "\\begin{tabular}{lr}",
    "\\hline",
    "Name & Count \\\\",
    "\\hline",
    "Alpha & 1 \\\\",
    "Beta & 2 \\\\",
    "\\hline",
    "\\end{tabular}",
  ].join("\n");

  it("draws the table", () => {
    const view = mount(doc);
    const table = view.contentDOM.querySelector("table.cm-yaz-table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tr")).toHaveLength(3);
    expect(visible(view)).not.toContain("\\begin{tabular}");
  });

  it("reads the first row as a heading when a rule follows it", () => {
    const view = mount(doc);
    const headings = view.contentDOM.querySelectorAll("th");
    expect([...headings].map((cell) => cell.textContent)).toEqual([
      "Name",
      "Count",
    ]);
  });

  it("aligns cells as the column specification says", () => {
    const view = mount(doc);
    const cells = view.contentDOM.querySelectorAll("tbody td");
    expect(cells[0]!.className).toContain("cm-yaz-align-left");
    expect(cells[1]!.className).toContain("cm-yaz-align-right");
  });

  it("gives the source back when the cursor is inside it", () => {
    const view = mount(doc);
    caret(view, doc.indexOf("Alpha"));
    expect(visible(view)).toContain("\\begin{tabular}");
    expect(view.contentDOM.querySelector("table.cm-yaz-table")).toBeNull();
  });

  it("shows a table it would draw wrongly as source", () => {
    // `\multirow` spans rows, which this parser does not model. Drawing it
    // anyway would silently move a cell.
    const view = mount(
      "Results:\n\\begin{tabular}{ll}\n\\multirow{2}{*}{A} & 1 \\\\\n & 2 \\\\\n\\end{tabular}",
    );
    expect(view.contentDOM.querySelector("table.cm-yaz-table")).toBeNull();
    expect(visible(view)).toContain("\\multirow");
  });
});

describe("the marks that bound the text", () => {
  const doc = [
    "\\documentclass{article}",
    "\\usepackage{amsmath}",
    "\\begin{document}",
    "The body.",
    "\\end{document}",
  ].join("\n");

  it("hides the LaTeX at both ends", () => {
    const view = mount(doc);
    const shown = visible(view);
    expect(shown).not.toContain("\\documentclass");
    expect(shown).not.toContain("\\usepackage");
    expect(shown).not.toContain("\\end{document}");
    expect(shown).toContain("The body.");
  });

  it("draws a mark at the start and a mark at the end", () => {
    const view = mount(doc);
    const marks = view.contentDOM.querySelectorAll(".cm-yaz-boundary");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.className).toContain("cm-yaz-boundary-start");
    expect(marks[1]!.className).toContain("cm-yaz-boundary-end");
  });

  it("says what each mark is, for a reader who cannot see it", () => {
    // The glyph carries no meaning to a screen reader, so the button does.
    const view = mount(doc);
    const marks = [...view.contentDOM.querySelectorAll(".cm-yaz-boundary")];
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Start of the text",
      "End of the text",
    ]);
  });

  it("expands and collapses when a mark is clicked", () => {
    const view = mount(doc);
    const mark = view.contentDOM.querySelector(".cm-yaz-boundary");
    expect(mark).not.toBeNull();

    mark!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(visible(view)).toContain("\\usepackage{amsmath}");
    expect(visible(view)).toContain("\\end{document}");

    const open = view.contentDOM.querySelector(".cm-yaz-boundary");
    open!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(visible(view)).not.toContain("\\usepackage{amsmath}");
  });

  it("keeps both marks when the wrapper is showing", () => {
    // They are how it is put back, so they cannot disappear when it opens.
    const view = mount(doc);
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    expect(view.contentDOM.querySelectorAll(".cm-yaz-boundary")).toHaveLength(
      2,
    );
  });

  it("says whether it is open", () => {
    const view = mount(doc);
    expect(
      view.contentDOM
        .querySelector(".cm-yaz-boundary")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    expect(
      view.contentDOM
        .querySelector(".cm-yaz-boundary")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("will not let the cursor sit inside the folded LaTeX", () => {
    // Opening a file puts the cursor at offset zero, which is inside the
    // opening fold. A cursor inside a replacement is invisible, so typing
    // there would edit `\usepackage` lines the author cannot see.
    const view = mount(doc);
    expect(view.state.selection.main.head).toBe(doc.indexOf("The body."));

    caret(view, 5);
    expect(view.state.selection.main.head).toBe(doc.indexOf("The body."));
  });

  it("will not let the cursor sit inside the closing fold either", () => {
    const view = mount(doc);
    caret(view, doc.indexOf("\\end{document}") + 4);
    expect(view.state.selection.main.head).toBe(
      doc.indexOf("The body.") + "The body.".length,
    );
  });

  it("types into the body, not the preamble", () => {
    const view = mount(doc);
    view.dispatch(view.state.replaceSelection("Hello. "));
    expect(view.state.doc.toString()).toContain("Hello. The body.");
    expect(view.state.doc.toString()).toContain("\\usepackage{amsmath}");
  });

  it("lets a selection cover the preamble", () => {
    // Select-all and type means replace everything, preamble included. Only an
    // empty selection — a place to type — is moved.
    const view = mount(doc);
    view.dispatch({ selection: { anchor: 0, head: doc.length } });
    expect(view.state.selection.main.from).toBe(0);
  });

  it("lets the cursor back in once the wrapper is showing", () => {
    const view = mount(doc);
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    caret(view, 5);
    expect(view.state.selection.main.head).toBe(5);
  });

  it("hides \\maketitle with the rest of the machinery", () => {
    // It produces the title block from what the preamble already declared, so
    // leaving it stranded above the first paragraph shows the seam the mark
    // exists to hide.
    const view = mount(
      [
        "\\documentclass{article}",
        "\\title{A Paper}",
        "\\begin{document}",
        "\\maketitle",
        "",
        "The body.",
        "\\end{document}",
      ].join("\n"),
    );
    expect(visible(view)).not.toContain("\\maketitle");
    expect(visible(view)).toContain("The body.");
  });

  it("does not eat a blank line when there is no title block", () => {
    // Absorbing trailing blank lines unconditionally would pull the first
    // paragraph up against the mark.
    const doc = [
      "\\documentclass{article}",
      "\\begin{document}",
      "",
      "The body.",
      "\\end{document}",
    ].join("\n");
    const view = mount(doc);
    expect(view.state.doc.toString()).toBe(doc);
    expect(visible(view)).toContain("The body.");
  });

  it("marks the start alone when the document does not close", () => {
    // A file being written has no `\end{document}` yet, and inventing a
    // closing mark for one would be marking the end of nothing.
    const view = mount("\\documentclass{article}\n\\begin{document}\nText.");
    const marks = view.contentDOM.querySelectorAll(".cm-yaz-boundary");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.className).toContain("cm-yaz-boundary-start");
  });

  it("leaves a fragment with no preamble alone", () => {
    // An `\input`-ed chapter is all text, so there is no boundary to draw, and
    // folding its first line away would hide the author's first paragraph.
    const view = mount("Intro.\n\\section{Chapter}\nText.");
    expect(view.contentDOM.querySelector(".cm-yaz-boundary")).toBeNull();
    expect(visible(view)).toContain("Chapter");
  });
});

describe("headings and emphasis", () => {
  it("still styles a heading that contains a formula", () => {
    const view = mount("Intro.\n\\section{The $\\alpha$ case}");
    expect(view.contentDOM.querySelector(".cm-yaz-heading")).not.toBeNull();
    expect(view.contentDOM.querySelector(".katex")).not.toBeNull();
    expect(visible(view)).not.toContain("\\section{");
  });

  it("hides the markup around emphasis", () => {
    const view = mount("A \\textbf{bold} word.");
    expect(visible(view)).toBe("A bold word.");
    expect(view.contentDOM.querySelector(".cm-yaz-strong")?.textContent).toBe(
      "bold",
    );
  });
});

describe("a whole paper", () => {
  // Everything at once, nested and adjacent. CodeMirror rejects a decoration
  // set whose replacements overlap by throwing, so a document that exercises
  // every construct together is the cheapest guard against the ways they can
  // claim the same characters.
  const paper = [
    "\\documentclass{article}",
    "\\usepackage{amsmath,booktabs}",
    "\\title{A \\emph{Short} Paper}",
    "\\begin{document}",
    "\\maketitle",
    "",
    "\\section{Introduction}",
    "We show that $e^{i\\pi} + 1 = 0$, and that \\textbf{everything} follows.",
    "",
    "\\begin{equation}\\label{eq:main}",
    "  \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
    "\\end{equation}",
    "",
    "\\subsection{Method}",
    "\\begin{enumerate}",
    "  \\item Collect the data, costing \\$40.",
    "  \\begin{itemize}",
    "    \\item One source is \\texttt{zotero}.",
    "    \\item Another is $x \\in \\mathbb{R}$.",
    "  \\end{itemize}",
    "  \\item Fit the model.",
    "\\end{enumerate}",
    "",
    "\\begin{table}[t]",
    "\\begin{tabular}{@{}lrr@{}}",
    "\\toprule",
    "Model & $R^2$ & \\% error \\\\",
    "\\midrule",
    "Linear & 0.81 & 12 \\\\",
    "\\multicolumn{2}{c}{Pooled} & 9 \\\\",
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Results.}",
    "\\end{table}",
    "",
    "% \\section{Cut for space}",
    "\\section*{Acknowledgements}",
    "Thanks to \\textsc{everyone}.",
    "\\end{document}",
  ].join("\n");

  it("renders without CodeMirror rejecting the decorations", () => {
    const view = mount(paper);
    expect(view.state.doc.toString()).toBe(paper);
    expect(view.contentDOM.querySelector("table.cm-yaz-table")).not.toBeNull();
    expect(
      view.contentDOM.querySelector(".cm-yaz-math-display"),
    ).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-yaz-heading")).not.toBeNull();
  });

  it("survives being typed into", () => {
    // Every keystroke rebuilds the whole decoration set, so the interesting
    // failures are the ones a half-finished construct causes.
    const view = mount(paper);
    caret(view, paper.indexOf("We show") + "We show".length);
    for (const character of " $\\alpha_{") {
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: head, insert: character },
        selection: { anchor: head + character.length },
      });
    }
    expect(view.state.doc.toString()).toContain("We show $\\alpha_{");
  });

  it("keeps the LaTeX wrapper out of the way when it is collapsed", () => {
    const view = mount(paper);
    expect(visible(view)).not.toContain("\\usepackage");
    expect(visible(view)).toContain("Introduction");
  });
});

describe("the parts LaTeX generates", () => {
  const doc = [
    "\\" + "documentclass{report}",
    "\\" + "begin{document}",
    "\\" + "tableofcontents",
    "\\" + "cleardoublepage",
    "\\" + "addcontentsline{toc}{chapter}{Glossar}",
    "\\" + "chapter{Vorbemerkungen}",
    "Der Anlass war ein anderer.",
    "\\" + "section{Anlass}",
    "\\" + "end{document}",
  ].join("\n");

  /**
   * Mounted with the caret in the prose.
   *
   * Folding the preamble puts the caret on the first line below it, which in a
   * document like this one is the `\tableofcontents` — so it is revealed, and a
   * test that did not move the caret would be asking about the revealed state
   * while believing it asked about the drawn one.
   */
  function reading(source = doc): EditorView {
    const view = mount(source);
    const prose = source.indexOf("Der Anlass");
    caret(view, prose === -1 ? source.length - 1 : prose + 4);
    return view;
  }

  it("draws the contents from the document's own headings", () => {
    // Which is the point: the list is what the document says about itself, and
    // it is right the moment a heading is typed rather than after a compile.
    const shown = visible(reading());
    expect(shown).toContain("Vorbemerkungen");
    expect(shown).not.toContain("\\" + "tableofcontents");
  });

  it("titles the list, so an empty one is still legible", () => {
    expect(visible(reading())).toContain("Contents");
  });

  it("draws a page break instead of the word for it", () => {
    expect(visible(reading())).not.toContain("cleardoublepage");
  });

  it("hides the bookkeeping", () => {
    // `addcontentsline` says nothing to a reader; it arranges for a heading to
    // appear in a list that is already drawn above it.
    expect(visible(reading())).not.toContain("addcontentsline");
  });

  it("gives the source back when the caret arrives", () => {
    // The rule the whole view runs on: what you are editing, you can see.
    const view = mount(doc);
    caret(view, doc.indexOf("\\" + "tableofcontents") + 3);
    expect(visible(view)).toContain("\\" + "tableofcontents");
  });

  it("leaves the buffer exactly as it was", () => {
    // ADR-0004 again. Everything above is decoration over this text.
    expect(reading().state.doc.toString()).toBe(doc);
  });

  it("says so when there is nothing to list", () => {
    // A `main.tex` on its own holds no headings at all, and a box that explains
    // itself beats one that looks broken.
    const alone = [
      "\\" + "begin{document}",
      "\\" + "tableofcontents",
      "Ein Satz, damit der Cursor woanders steht.",
      "\\" + "end{document}",
    ].join("\n");
    const view = mount(alone);
    caret(view, alone.indexOf("Ein Satz") + 4);
    expect(visible(view)).toContain("No headings in this file");
  });

  it("does nothing at all in source view", () => {
    const view = mount(doc, false);
    expect(visible(view)).toContain("\\" + "tableofcontents");
    expect(visible(view)).toContain("\\" + "addcontentsline");
  });
});
