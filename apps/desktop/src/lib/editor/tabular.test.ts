/**
 * Reading a table out of LaTeX.
 *
 * The cases are the ones a real paper contains: booktabs rules, a spanning
 * header, `p{}` columns, an ampersand that is text rather than a separator.
 */

import { describe, expect, it } from "vitest";

import {
  parseColumnSpec,
  parseTabular,
  tableHtml,
  tooComplexToDraw,
} from "./tabular";

describe("parseColumnSpec", () => {
  it("reads alignments", () => {
    expect(parseColumnSpec("lcr").map((column) => column.align)).toEqual([
      "left",
      "center",
      "right",
    ]);
  });

  it("records vertical rules without counting them as columns", () => {
    const columns = parseColumnSpec("|l|r|");
    expect(columns).toHaveLength(2);
    expect(columns[0]!.ruleBefore).toBe(true);
    expect(columns[1]!.ruleAfter).toBe(true);
  });

  it("treats a width column as left-aligned and swallows its width", () => {
    // `p{5cm}` would otherwise be read as a column called `p` followed by
    // whatever `5cm` looks like.
    expect(parseColumnSpec("lp{5cm}r").map((column) => column.align)).toEqual([
      "left",
      "left",
      "right",
    ]);
  });

  it("expands a repetition", () => {
    expect(parseColumnSpec("*{3}{c}")).toHaveLength(3);
  });

  it("skips the formatting groups", () => {
    // `@{}` and `>{\bfseries}` change how a column is set, not how many exist.
    expect(parseColumnSpec("@{}l>{\\bfseries}c@{}")).toHaveLength(2);
  });
});

describe("parseTabular", () => {
  it("reads rows and cells", () => {
    const table = parseTabular("ll", "a & b \\\\\nc & d \\\\");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells.map((cell) => cell.html)).toEqual(["a", "b"]);
    expect(table.rows[1]!.cells.map((cell) => cell.html)).toEqual(["c", "d"]);
  });

  it("does not split on an escaped ampersand", () => {
    // `Smith \& Jones` is one author, not two cells.
    const table = parseTabular("l", "Smith \\& Jones \\\\");
    expect(table.rows[0]!.cells).toHaveLength(1);
    expect(table.rows[0]!.cells[0]!.html).toBe("Smith &amp; Jones");
  });

  it("turns a rule into a border rather than a row", () => {
    const table = parseTabular("l", "\\hline\na \\\\\n\\hline");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.ruleAbove).toBe(true);
    expect(table.rows[0]!.ruleBelow).toBe(true);
  });

  it("reads the first row as a heading when a rule separates it", () => {
    const table = parseTabular("ll", "H1 & H2 \\\\\n\\midrule\na & b \\\\");
    expect(table.heading).toBe(true);
    expect(table.rows[0]!.cells[0]!.html).toBe("H1");
  });

  it("does not call the first row a heading with nothing under it", () => {
    expect(parseTabular("ll", "a & b \\\\\nc & d \\\\").heading).toBe(false);
  });

  it("reads a spanning cell", () => {
    const table = parseTabular("lll", "\\multicolumn{2}{c}{Both} & c \\\\");
    expect(table.rows[0]!.cells[0]!.span).toBe(2);
    expect(table.rows[0]!.cells[0]!.align).toBe("center");
    expect(table.rows[0]!.cells[0]!.html).toBe("Both");
  });

  it("consumes the spacing after a row break", () => {
    // `\\[2pt]` is extra leading; reading it as a cell would put `2pt]` in the
    // table.
    const table = parseTabular("l", "a \\\\[2pt]\nb \\\\");
    expect(table.rows.map((row) => row.cells[0]!.html)).toEqual(["a", "b"]);
  });

  it("renders inline markup in a cell", () => {
    const table = parseTabular("l", "\\textbf{Bold} \\\\");
    expect(table.rows[0]!.cells[0]!.html).toBe("<strong>Bold</strong>");
  });

  it("drops a trailing empty row", () => {
    // Almost every real table ends with `\\` before `\end{tabular}`.
    const table = parseTabular("l", "a \\\\\nb \\\\\n");
    expect(table.rows).toHaveLength(2);
  });
});

describe("tableHtml", () => {
  it("uses heading cells for a heading row", () => {
    const html = tableHtml(
      parseTabular("ll", "H & I \\\\\n\\midrule\na & b \\\\"),
    );
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).not.toContain(
      '<th class="cm-yaz-td cm-yaz-align-left">a</th>',
    );
  });

  it("carries the column alignment onto the cells", () => {
    const html = tableHtml(parseTabular("lr", "a & b \\\\"));
    expect(html).toContain("cm-yaz-align-left");
    expect(html).toContain("cm-yaz-align-right");
  });

  it("spans a multicolumn cell", () => {
    const html = tableHtml(
      parseTabular("ll", "\\multicolumn{2}{c}{Wide} \\\\"),
    );
    expect(html).toContain('colspan="2"');
  });
});

describe("tooComplexToDraw", () => {
  it("refuses a table with rows spanned", () => {
    expect(tooComplexToDraw("\\multirow{2}{*}{A} & 1 \\\\")).toBe(true);
  });

  it("refuses a table inside a table", () => {
    expect(
      tooComplexToDraw("a & \\begin{tabular}{l} x \\end{tabular} \\\\"),
    ).toBe(true);
  });

  it("allows an ordinary one", () => {
    expect(tooComplexToDraw("a & b \\\\")).toBe(false);
  });
});
