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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  richText,
  setRichText,
  setShowComments,
  setShowLineBreaks,
  setShowMachinery,
  setWrapperCollapsed,
} from "./richText";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

/** A line break, named so a template literal can hold one. */
const nothing = "\n";

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

describe("the front and back matter, opened", () => {
  const doc = [
    "\\" + "documentclass{article}",
    "\\" + "usepackage{amsmath}",
    "\\" + "begin{document}",
    "Der Text selbst.",
    "\\" + "end{document}",
  ].join("\n");

  /** Every line the band covers, as the DOM has them. */
  function banded(view: EditorView): string[] {
    return [...view.contentDOM.querySelectorAll(".cm-yaz-matter")].map(
      (line) => line.textContent ?? "",
    );
  }

  it("is one row while it is closed", () => {
    // Closed, there is nothing to band: the mark is the whole of it.
    expect(banded(mount(doc))).toEqual([]);
  });

  it("bands every line of it once opened", () => {
    const view = mount(doc);
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    const rows = banded(view);
    expect(rows.some((row) => row.includes("documentclass"))).toBe(true);
    expect(rows.some((row) => row.includes("usepackage"))).toBe(true);
    expect(rows.some((row) => row.includes("begin{document}"))).toBe(true);
  });

  it("bands the closing line too", () => {
    const view = mount(doc);
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    expect(banded(view).some((row) => row.includes("end{document}"))).toBe(
      true,
    );
  });

  it("leaves the text alone", () => {
    // The band is the machinery around the document, not the document.
    const view = mount(doc);
    view.dispatch({ effects: setWrapperCollapsed.of(false) });
    expect(banded(view).some((row) => row.includes("Der Text selbst"))).toBe(
      false,
    );
  });
});

describe("commands that stand for something else", () => {
  const doc = [
    "\\" + "documentclass{report}",
    "\\" + "usepackage[ngerman]{babel}",
    "\\" + "begin{document}",
    "\\" + "newglossaryentry{BIM}{name={BIM}, description={Eine Methode}}",
    "\\" + "chapter{Grundlagen}" + "\\" + "label{ch:grund}",
    "Ein Satz zum Anhalten des Cursors.",
    "\\" + "section{Methodik}",
    "Wie in " +
      "\\" +
      "ref{ch:grund} gezeigt, ist " +
      "\\" +
      "gls{BIM} z." +
      "\\" +
      ",B. eine Methode.",
    "\\" +
      "noindent " +
      "\\" +
      "enquote{Ein Zitat} " +
      "\\" +
      "parencite{meister2021}",
    "\\" + "begin{itemize}[nosep]",
    "\\" + "item Eins",
    "\\" + "end{itemize}",
    "\\" + "end{document}",
  ].join("\n");

  /** Mounted with the caret parked in ordinary prose. */
  function reading(): EditorView {
    const view = mount(doc);
    caret(view, doc.indexOf("Ein Satz") + 4);
    return view;
  }

  it("draws a glossary entry as the word it stands for", () => {
    // 561 of these in the thesis this was built against, which is why it is
    // the first thing worth getting right.
    const shown = visible(reading());
    expect(shown).not.toContain("\\" + "gls{BIM}");
    expect(shown).toContain("BIM");
  });

  it("draws a reference as the number it will print", () => {
    const shown = visible(reading());
    expect(shown).not.toContain("\\" + "ref{ch:grund}");
    expect(shown).toContain("Wie in 1 gezeigt");
  });

  it("numbers the headings the way LaTeX will", () => {
    expect(visible(reading())).toContain("1.1");
  });

  it("folds a label into the heading it labels", () => {
    // Nothing of it is left on screen; the heading carries it on hover.
    const view = reading();
    expect(visible(view)).not.toContain("ch:grund");
    const heading = view.contentDOM.querySelector(".cm-yaz-heading");
    expect(heading?.getAttribute("title")).toContain("ch:grund");
  });

  it("quotes with the marks the document's language uses", () => {
    // csquotes takes these from babel, so a German document gets German marks
    // without anyone saying so twice.
    const shown = visible(reading());
    expect(shown).toContain("\u201eEin Zitat\u201c");
    expect(shown).not.toContain("\\" + "enquote");
  });

  it("draws a citation as a citation", () => {
    const shown = visible(reading());
    expect(shown).not.toContain("\\" + "parencite");
    expect(shown).toContain("[meister2021]");
  });

  it("marks a reference the document does not define", () => {
    // The failure worth designing against: a reference that looks fine and
    // prints `??`.
    const view = reading();
    expect(view.contentDOM.querySelector(".cm-yaz-unresolved")).not.toBeNull();
  });

  it("sets a thin space as a space", () => {
    const shown = visible(reading());
    expect(shown).not.toContain("z." + "\\" + ",B.");
    expect(shown).toContain("z.");
  });

  it("hides what only changes the setting", () => {
    expect(visible(reading())).not.toContain("noindent");
  });

  it("hides a list's layout options", () => {
    // `[nosep]` is an instruction to the typesetter, not something to read.
    expect(visible(reading())).not.toContain("nosep");
  });

  it("leaves the buffer exactly as it was", () => {
    expect(reading().state.doc.toString()).toBe(doc);
  });

  it("gives the source back when the caret arrives", () => {
    const view = mount(doc);
    caret(view, doc.indexOf("\\" + "gls{BIM}") + 2);
    expect(visible(view)).toContain("\\" + "gls{BIM}");
  });

  it("does none of it in source view", () => {
    const shown = visible(mount(doc, false));
    expect(shown).toContain("\\" + "gls{BIM}");
    expect(shown).toContain("\\" + "ref{ch:grund}");
    expect(shown).toContain("nosep");
  });
});

describe("the author's comments", () => {
  const doc = [
    "\\begin{document}",
    "% Diese Zeile ist eine Anmerkung.",
    "Ein Satz. % und eine Anmerkung dahinter",
    "\\end{document}",
  ].join("\n");

  it("shows them, because the author wrote them", () => {
    const view = mount(doc);
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(visible(view)).toContain("Anmerkung");
  });

  it("hides them when asked", () => {
    const view = mount(doc);
    view.dispatch({ effects: setShowComments.of(false) });
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(visible(view)).not.toContain("Anmerkung");
    expect(visible(view)).toContain("Ein Satz");
  });

  it("closes the gap where a whole line was one", () => {
    // Otherwise a heavily commented document becomes a document full of holes.
    const view = mount(doc);
    view.dispatch({ effects: setShowComments.of(false) });
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(visible(view)).not.toContain("\n\n");
  });

  it("does not delete anything", () => {
    // Hidden is not gone: ADR-0004 again.
    const view = mount(doc);
    view.dispatch({ effects: setShowComments.of(false) });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("brings them back", () => {
    const view = mount(doc);
    view.dispatch({ effects: setShowComments.of(false) });
    view.dispatch({ effects: setShowComments.of(true) });
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(visible(view)).toContain("Anmerkung");
  });
});

describe("a title page", () => {
  // The shape of a real one: a template that carries its metadata in commands
  // of its own, and sets it with size declarations and vertical space.
  const doc = [
    "BSLdocumentclass{report}",
    "BSLtitle{Building Information Modeling}",
    "BSLsubtitle{Endbericht}",
    "BSLauthor{Friedrich Schrödter}",
    "BSLbegin{document}",
    "BSLbegin{titlepage}",
    "BSLcentering",
    "{BSLLarge Bauhaus-Universität WeimarBSLpar}",
    "BSLvspace{1cm}",
    "{BSLhugeBSLbfseries BSLthetitle BSLpar}",
    "{BSLLargeBSLitshape BSLthesubtitle BSLpar}",
    "BSLvfill",
    "{BSLlarge BSLtheauthorBSLpar}",
    "BSLend{titlepage}",
    "Ein Satz danach.",
    "BSLend{document}",
  ]
    .map((line) => line.split("BSL").join(B))
    .join("\n");

  function reading(): EditorView {
    const view = mount(doc);
    caret(view, doc.indexOf("Ein Satz") + 4);
    return view;
  }

  it("shows the title the document declares, not the command for it", () => {
    // The heart of it: a title page writes the command, never the title.
    const shown = visible(reading()).split("BSL").join(B);
    expect(shown).toContain("Building Information Modeling");
    expect(shown).not.toContain("thetitle");
  });

  it("resolves the ones a template defines for itself", () => {
    const shown = visible(reading());
    expect(shown).toContain("Endbericht");
    expect(shown).toContain("Friedrich Schrödter");
  });

  it("sets the title at the size the document asks for", () => {
    const view = reading();
    const sized = [...view.contentDOM.querySelectorAll(".cm-yaz-sized")];
    expect(sized.length).toBeGreaterThan(0);
    expect(
      sized.some((node) => node.getAttribute("style")?.includes("2.07em")),
    ).toBe(true);
  });

  it("centres what centering centres", () => {
    const view = reading();
    expect(
      view.contentDOM.querySelector(".cm-yaz-align-center"),
    ).not.toBeNull();
  });

  it("draws the space as space", () => {
    const view = reading();
    const spaces = [...view.contentDOM.querySelectorAll(".cm-yaz-vspace")];
    expect(spaces.length).toBeGreaterThan(0);
    expect(visible(view)).not.toContain("vspace");
  });

  it("hides the declarations themselves", () => {
    const shown = visible(reading());
    expect(shown).not.toContain("bfseries");
    expect(shown).not.toContain("Large");
  });

  it("leaves the buffer exactly as it was", () => {
    expect(reading().state.doc.toString()).toBe(doc);
  });

  it("does none of it in source view", () => {
    const shown = visible(mount(doc, false));
    expect(shown).toContain("thetitle");
    expect(shown).toContain("vspace");
  });
});

describe("a figure", () => {
  const doc = [
    "BSLdocumentclass{report}",
    "BSLbegin{document}",
    "BSLchapter{Grundlagen}",
    "Ein Satz zum Anhalten des Cursors.",
    "BSLbegin{figure}[H]",
    "  BSLcentering",
    "  BSLincludegraphics[width=0.9BSLlinewidth]{images/ablauf}",
    "  BSLcaption{Flussdiagramm des Gesamtablaufs}",
    "  BSLlabel{fig:ablauf}",
    "BSLend{figure}",
    "BSLend{document}",
  ]
    .map((line) => line.split("BSL").join(B))
    .join("\n");

  function reading(): EditorView {
    const view = mount(doc);
    caret(view, doc.indexOf("Ein Satz") + 4);
    return view;
  }

  it("draws it as one block, not as its commands", () => {
    const view = reading();
    expect(view.contentDOM.querySelector(".cm-yaz-figure")).not.toBeNull();
    expect(visible(view)).not.toContain("includegraphics");
  });

  it("names the file it could not read", () => {
    // No resolver in a test, and none on a document whose image is missing —
    // both should show the path, which is what the author needs to see.
    expect(visible(reading())).toContain("images/ablauf");
  });

  it("numbers the caption the way LaTeX will", () => {
    // The same number every reference to it shows, because both come from the
    // same count.
    expect(visible(reading())).toContain("Figure 1.1");
    expect(visible(reading())).toContain("Flussdiagramm des Gesamtablaufs");
  });

  it("gives the source back when the caret arrives", () => {
    const view = mount(doc);
    caret(view, doc.indexOf("includegraphics"));
    expect(visible(view)).toContain("includegraphics");
  });

  it("leaves the buffer exactly as it was", () => {
    expect(reading().state.doc.toString()).toBe(doc);
  });

  it("leaves a figure with no image alone", () => {
    // Nothing to draw, so drawing a frame around the words would be worse than
    // showing them.
    const wordy = [
      "BSLbegin{figure}",
      "BSLcaption{Nur eine Unterschrift}",
      "BSLend{figure}",
      "Ein Satz.",
    ]
      .map((line) => line.split("BSL").join(B))
      .join("\n");
    const view = mount(wordy);
    caret(view, wordy.indexOf("Ein Satz") + 4);
    expect(view.contentDOM.querySelector(".cm-yaz-figure")).toBeNull();
  });
});

describe("the rest of a title page", () => {
  const doc = [
    "BSLdocumentclass{report}",
    "BSLtitle{Ein Titel}",
    "BSLauthor{Friedrich}",
    "BSLreviewer{Prof. Melzner}",
    "BSLbegin{document}",
    "BSLbegin{titlepage}",
    "BSLcentering",
    "{BSLLarge {BSLtextls[200]{Bauhaus-Universität}}BSLpar}",
    "Fakultät BauBSLBSL Professur Baubetrieb",
    "BSLincludegraphics[width=0.5BSLtextwidth]{images/logo.png}",
    "BSLrenewcommand{BSLarraystretch}{1.2}",
    "BSLbegin{tabular}{ll}",
    "Erstellung: & BSLtheauthor BSLBSL",
    "Prüfung: & BSLthereviewer",
    "BSLend{tabular}",
    "BSLend{titlepage}",
    "Ein Satz danach.",
    "BSLend{document}",
  ]
    .map((line) => line.split("BSL").join(B))
    .join("\n");

  function reading(): EditorView {
    const view = mount(doc);
    caret(view, doc.indexOf("Ein Satz") + 4);
    return view;
  }

  it("hides the environment that is only arrangement", () => {
    // `\begin{titlepage}` is an instruction to the typesetter.
    expect(visible(reading())).not.toContain("titlepage");
  });

  it("draws a logo that is not inside a figure", () => {
    // Which is how a title page puts one on the page.
    const view = reading();
    expect(view.contentDOM.querySelector(".cm-yaz-figure")).not.toBeNull();
    expect(visible(view)).not.toContain("includegraphics");
  });

  it("hides a setting and both of its arguments", () => {
    // `\renewcommand{\arraystretch}{1.2}` read as three words in the middle
    // of the author's name.
    const shown = visible(reading());
    expect(shown).not.toContain("renewcommand");
    expect(shown).not.toContain("arraystretch");
    expect(shown).not.toContain("1.2");
  });

  it("fills the author and the reviewer into the table", () => {
    // A table is drawn from its source, so these reached the screen as their
    // command names until the source was filled in first.
    const shown = visible(reading());
    expect(shown).toContain("Friedrich");
    expect(shown).toContain("Prof. Melzner");
    expect(shown).not.toContain("theauthor");
  });

  it("spaces the letters out where the document asks", () => {
    const view = reading();
    const tracked = view.contentDOM.querySelector(".cm-yaz-tracked");
    expect(tracked).not.toBeNull();
    expect(tracked?.getAttribute("style")).toContain("0.2em");
  });

  it("draws an explicit break instead of its markup", () => {
    const view = reading();
    expect(view.contentDOM.querySelector(".cm-yaz-linebreak")).not.toBeNull();
  });

  it("shows the markup when asked to", () => {
    const view = mount(doc);
    view.dispatch({ effects: setShowLineBreaks.of(true) });
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(view.contentDOM.querySelector(".cm-yaz-linebreak")).toBeNull();
  });

  it("shows the machinery when asked to", () => {
    const view = mount(doc);
    view.dispatch({ effects: setShowMachinery.of(true) });
    caret(view, doc.indexOf("Ein Satz") + 4);
    expect(visible(view)).toContain("renewcommand");
  });

  it("leaves the buffer exactly as it was", () => {
    expect(reading().state.doc.toString()).toBe(doc);
  });
});

/**
 * The rest of standard LaTeX.
 *
 * Not everything, but the things a document is actually full of once the
 * headings and the emphasis are handled: the characters the keyboard has no
 * key for, the space an author asks for, the boxes, the notes.
 */
describe("the everyday commands", () => {
  it("sets a command that stands for a character as that character", () => {
    // Replaced, not hidden. `\ldots` *is* an ellipsis the author wrote — taking
    // it away would be losing text rather than hiding markup.
    expect(visible(mount(`Text: One${B}ldots two`))).toContain("One… two");
    expect(visible(mount(`Text: See ${B}S 3 and ${B}P 4`))).toContain(
      "See § 3 and ¶ 4",
    );
    expect(visible(mount(`Text: ${B}copyright 2026`))).toContain("© 2026");
  });

  it("keeps a backslash a backslash where the author asked for one", () => {
    expect(visible(mount(`Text: a ${B}textbackslash b`))).toContain(`a ${B} b`);
  });

  it("draws the date the compiler will print, in the document's language", () => {
    // German, because that is what the document is in. Showing it in the
    // interface's language would be showing what the compiler will not print.
    const german = visible(
      mount(
        [
          `${B}documentclass{article}`,
          `${B}usepackage[ngerman]{babel}`,
          `${B}begin{document}`,
          `Weimar, ${B}today`,
          `${B}end{document}`,
        ].join("\n"),
      ),
    );
    expect(german).toMatch(/Weimar, \d+\.\s\p{L}+\s\d{4}/u);
  });

  it("hides a definition and everything it defines", () => {
    // `\newcommand{\x}{y}` is machinery: two braces of it, and none of it is
    // the document.
    const text = visible(
      mount(
        `Text.${nothing}${B}newcommand{${B}thesubtitle}{A subtitle}${nothing}Body.`,
      ),
    );
    expect(text).not.toContain("newcommand");
    expect(text).toContain("Body.");
  });

  it("draws a box around what is boxed", () => {
    const view = mount(`Text: ${B}fbox{Inside}`);
    expect(visible(view)).toContain("Inside");
    expect(view.contentDOM.querySelector(".cm-yaz-framed")).not.toBeNull();
  });

  it("raises and lowers what is raised and lowered", () => {
    const view = mount(
      `Text: H${B}textsubscript{2}O and 3${B}textsuperscript{rd}`,
    );
    expect(view.contentDOM.querySelector(".cm-yaz-subscript")).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-yaz-superscript")).not.toBeNull();
    expect(visible(view)).toContain("H2O");
  });

  it("leaves room where the author asked for room", () => {
    // Horizontal space only. Vertical space has been drawn since the title
    // page needed it and lives in `typography.ts` — `igskip` and `space`
    // are its, and having two owners for one command is one too many.
    const view = mount(`Text.${nothing}One${B}quad two`);
    const gap = view.contentDOM.querySelector(".cm-yaz-space-inline");
    expect(gap).not.toBeNull();
    expect((gap as HTMLElement).style.inlineSize).not.toBe("");
    expect(visible(view)).toContain("One");
    expect(visible(view)).toContain("two");
  });

  it("sets a note small rather than losing it", () => {
    const view = mount(`Text: Claim${B}footnote{The evidence.}`);
    expect(visible(view)).toContain("The evidence.");
    expect(view.contentDOM.querySelector(".cm-yaz-footnote")).not.toBeNull();
  });
});
