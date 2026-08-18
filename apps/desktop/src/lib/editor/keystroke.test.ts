/**
 * What a keystroke costs with rich text on.
 *
 * ADR-0015 gives the whole keystroke path a 16 ms budget, and rich text
 * rebuilds every decoration in the document on every character typed. The
 * first version of this cost **170 ms per keystroke** on a hundred-page
 * manuscript: working out which list each item and each line belonged to by
 * searching every list was cubic, and nothing said so until it was measured.
 *
 * The bound below is a tripwire, not the budget. It is far above what this
 * costs — around 12 ms for 100 KiB here, ~2 ms for a paper-sized file — so
 * that a slow CI machine does not fail it, while a change that reintroduces a
 * complexity class does.
 *
 * The numbers are jsdom's, so they are indicative rather than the real thing;
 * a webview does the layout this does not.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeAll, describe, expect, it } from "vitest";

import { richText, setRichText } from "./richText";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

/** A document with everything rich text renders, repeated. */
function paper(sections: number): string {
  const parts = ["\\documentclass{article}", "\\begin{document}"];
  for (let index = 0; index < sections; index += 1) {
    parts.push(
      `\\section{Section ${index}}`,
      `Some prose with $\\alpha_{${index}}$ inline and \\textbf{emphasis} in it.`,
      "% a commented line, which every scanner has to skip",
      `\\begin{equation}\\label{eq:${index}}`,
      "  \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
      "\\end{equation}",
      "\\begin{itemize}",
      "  \\item first point",
      "  \\begin{itemize}",
      "    \\item a nested one",
      "  \\end{itemize}",
      "  \\item second point",
      "\\end{itemize}",
      "\\begin{tabular}{lrr}",
      "\\toprule",
      "Model & $R^2$ & error \\\\",
      "\\midrule",
      "Linear & 0.81 & 12 \\\\",
      "\\bottomrule",
      "\\end{tabular}",
      "",
    );
  }
  parts.push("\\end{document}");
  return parts.join("\n");
}

/** Milliseconds per character typed into the middle of `doc`. */
function costOfTyping(doc: string): number {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: document.body,
  });
  try {
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({
      selection: EditorSelection.cursor(
        doc.indexOf("Some prose") + "Some prose".length,
      ),
    });

    const rounds = 50;
    const started = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: head, insert: "x" },
        selection: { anchor: head + 1 },
      });
    }
    return (performance.now() - started) / rounds;
  } finally {
    view.destroy();
  }
}

describe("typing with rich text on", () => {
  it("stays linear in the size of the document", () => {
    const small = paper(40);
    const large = paper(250);

    const each = costOfTyping(large);
    console.log(
      `${(large.length / 1024).toFixed(0)} KiB: ${each.toFixed(2)} ms per keystroke ` +
        `(${(small.length / 1024).toFixed(0)} KiB: ${costOfTyping(small).toFixed(2)} ms)`,
    );

    expect(each).toBeLessThan(100);
  });
});
