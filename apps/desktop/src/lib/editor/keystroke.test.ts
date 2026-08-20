/**
 * What a keystroke costs with rich text on.
 *
 * ADR-0015 gives the whole keystroke path a 16 ms budget, and rich text
 * rebuilds every decoration in the document on every character typed. The
 * first version of this cost **170 ms per keystroke** on a hundred-page
 * manuscript: working out which list each item and each line belonged to by
 * searching every list was cubic, and nothing said so until it was measured.
 *
 * Two more have been caught this way since. Tracking which of thousands of
 * ranges were already claimed by walking the list each time was quadratic, and
 * cost 7 ms of the 18 it then took.
 *
 * # It measures the shape of the cost, not the cost
 *
 * This asserted an absolute time until it failed on an unchanged codebase: the
 * same commit measured 11 ms one day and 56 ms the next, because the machine
 * was busier. A wall-clock bound on a developer's machine is not a property of
 * the code, and a test that fails for a reason the author cannot act on is one
 * they learn to re-run rather than read.
 *
 * So it compares two document sizes instead. The larger is about six times the
 * smaller, so linear work costs about six times as much; the cubic bug this
 * exists to catch cost far more than that, and would still. The ratio holds
 * whatever else the machine is doing.
 *
 * The absolute figures are printed for information — they are jsdom's, so they
 * are indicative rather than the real thing; a webview does the layout this
 * does not.
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

    // Enough samples for a threefold signal and no more. Every round is a
    // full decoration rebuild of the document, and a hundred of them on a
    // busy machine outlast the runner's patience before they tell us anything
    // the first twenty-five did not.
    const rounds = 25;
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
    const sizeRatio = large.length / small.length;

    // Measured back to back, so both see the same machine. Measuring them at
    // different moments would put the thing this test exists to exclude —
    // how busy the computer is — back into the comparison.
    const cheap = costOfTyping(small);
    const dear = costOfTyping(large);
    const costRatio = dear / cheap;

    console.log(
      `${(small.length / 1024).toFixed(0)} KiB: ${cheap.toFixed(2)} ms, ` +
        `${(large.length / 1024).toFixed(0)} KiB: ${dear.toFixed(2)} ms — ` +
        `${costRatio.toFixed(1)}× the cost for ${sizeRatio.toFixed(1)}× the document`,
    );

    // Linear costs about `sizeRatio`. The bound is generous because a real
    // document is not a scaled copy of a smaller one — the larger paper has
    // more of everything, including the constant-ish costs — but it is far
    // below the ~36× a quadratic would give and further still below the cubic
    // this was written to catch.
    expect(costRatio).toBeLessThan(sizeRatio * 2.5);
    // Generous, and deliberately so: this measures fifty rebuilds of a
    // hundred-page manuscript, which is slow work by design. The default five
    // seconds is a bound on a unit test, and this is not one.
  }, 60_000);
});
