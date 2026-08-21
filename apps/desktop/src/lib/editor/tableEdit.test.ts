/**
 * Changing a table's shape without changing anything else.
 *
 * These matter more than most: this module *writes into the author's
 * document*. A renderer that gets a table wrong draws it wrong and the author
 * can see that. This one can quietly lose a cell, and the author finds out when
 * the compile fails a week later.
 *
 * So the property under test throughout is the same: after an operation, the
 * body still parses to the same grid it should, the cells the author wrote are
 * character-for-character what they were, and the table still compiles — which
 * for these purposes means every row has the same number of `&` as the
 * specification has columns.
 */

import { describe, expect, it } from "vitest";

import {
  insertColumn,
  insertRow,
  readGrid,
  readSpec,
  removeColumn,
  removeRow,
  setColumnWidth,
  setRowHeight,
  writeGrid,
  writeSpec,
} from "./tableEdit";

const B = String.fromCharCode(92);
const BREAK = `${B}${B}`;

/** A table as a person would have written it. */
const SPEC = "|l|c|r|";
const BODY = [
  `${B}hline`,
  `Name & Menge & Preis ${BREAK}`,
  `${B}hline`,
  `Schraube & 20 & 1,50 ${BREAK}`,
  `Mutter & 40 & 0,80 ${BREAK}`,
  `${B}hline`,
].join("\n");

/** Cells of each row, trimmed, for comparing shapes. */
function shape(spec: string, body: string, columns = 3): string[][] {
  return readGrid(spec, body, columns).rows.map((row) =>
    row.cells.map((cell) => cell.trim()),
  );
}

describe("reading and writing a table unchanged", () => {
  it("writes back exactly what it read", () => {
    // The whole design rests on this. If a round trip is not lossless then
    // every operation quietly reformats the author's table as a side effect.
    const grid = readGrid(SPEC, BODY, 3);
    expect(writeGrid(grid)).toBe(BODY);
  });

  it("writes back a specification exactly as it read it", () => {
    for (const spec of [
      "|l|c|r|",
      "llr",
      "|p{3cm}|l|",
      ">{\\raggedright}p{4cm}l",
      "@{}ll@{}",
    ]) {
      const { columns, rulesAfter } = readSpec(spec);
      expect(writeSpec(columns, rulesAfter)).toBe(spec.replace(/\s/g, ""));
    }
  });

  it("keeps a cell's own spacing", () => {
    // An author who lines their columns up by hand gets that back.
    const body = `a    &  b  & c ${BREAK}`;
    const grid = readGrid("lll", body, 3);
    expect(grid.rows[0]!.cells).toEqual(["a    ", "  b  ", " c "]);
  });

  it("does not mistake an escaped ampersand for a cell boundary", () => {
    const body = `Tom ${B}& Jerry & 2 ${BREAK}`;
    expect(shape("ll", body, 2)).toEqual([[`Tom ${B}& Jerry`, "2"]]);
  });

  it("does not mistake a nested ampersand for a cell boundary", () => {
    const body = `${B}multicolumn{2}{c}{a & b} & c ${BREAK}`;
    const grid = readGrid("lll", body, 2);
    expect(grid.rows[0]!.cells).toHaveLength(2);
  });
});

describe("rows", () => {
  it("adds one, of the right width and with nothing in it", () => {
    const grid = insertRow(readGrid(SPEC, BODY, 3), 1);
    const rows = shape(SPEC, writeGrid(grid));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(["", "", ""]);
    // And the author's rows are untouched.
    expect(rows[0]).toEqual(["Name", "Menge", "Preis"]);
    expect(rows[2]).toEqual(["Schraube", "20", "1,50"]);
  });

  it("appends past the end", () => {
    const grid = insertRow(readGrid(SPEC, BODY, 3), 99);
    expect(shape(SPEC, writeGrid(grid))).toHaveLength(4);
  });

  it("removes one and leaves the rest alone", () => {
    const grid = removeRow(readGrid(SPEC, BODY, 3), 1);
    const rows = shape(SPEC, writeGrid(grid));
    expect(rows).toEqual([
      ["Name", "Menge", "Preis"],
      ["Mutter", "40", "0,80"],
    ]);
  });

  it("does not take the table's top edge with the first row", () => {
    // `\hline` above the heading belongs to the *table*, not to that row, and
    // deleting the heading should not leave a table with no top.
    const grid = removeRow(readGrid(SPEC, BODY, 3), 0);
    expect(writeGrid(grid)).toContain(`${B}hline`);
    expect(writeGrid(grid).trimStart().startsWith(`${B}hline`)).toBe(true);
  });

  it("leaves an empty row rather than no table at all", () => {
    // A table with no rows is not valid LaTeX, and an author who deletes the
    // last row means "clear it", not "break my document".
    const grid = removeRow(readGrid("ll", `a & b ${BREAK}`, 2), 0);
    expect(grid.rows).toHaveLength(1);
    expect(shape("ll", writeGrid(grid), 2)).toEqual([["", ""]]);
  });

  it("terminates the row that used to be last", () => {
    // A final row is often written without `\\`. Once something follows it, it
    // needs one — otherwise the new row joins the old one.
    const grid = insertRow(readGrid("ll", "a & b", 2), 1);
    const written = writeGrid(grid);
    expect(written).toContain(BREAK);
    expect(shape("ll", written, 2)).toHaveLength(2);
  });
});

describe("columns", () => {
  it("adds one to the specification and to every row", () => {
    // The reason this is worth having at all: by hand it is an `&` in exactly
    // the right place in every row, and one mistake is a table that will not
    // compile.
    const grid = insertColumn(readGrid(SPEC, BODY, 3), 1);
    expect(readSpec(grid.spec).columns).toHaveLength(4);
    for (const row of shape(grid.spec, writeGrid(grid), 4)) {
      expect(row).toHaveLength(4);
    }
    expect(shape(grid.spec, writeGrid(grid), 4)[0]).toEqual([
      "Name",
      "",
      "Menge",
      "Preis",
    ]);
  });

  it("does not give a new column the width of the one beside it", () => {
    // Copying `p{3cm}` would silently make the table wider than the page.
    const grid = insertColumn(readGrid("|p{3cm}|l|", `a & b ${BREAK}`, 2), 1);
    expect(grid.spec).not.toMatch(/p\{3cm\}.*p\{3cm\}/);
  });

  it("removes one from the specification and from every row", () => {
    const grid = removeColumn(readGrid(SPEC, BODY, 3), 1);
    expect(readSpec(grid.spec).columns).toHaveLength(2);
    expect(shape(grid.spec, writeGrid(grid), 2)).toEqual([
      ["Name", "Preis"],
      ["Schraube", "1,50"],
      ["Mutter", "0,80"],
    ]);
  });

  it("keeps the table's ruled edges when a column goes", () => {
    const grid = removeColumn(readGrid("|l|c|r|", `a & b & c ${BREAK}`, 3), 1);
    expect(grid.spec).toBe("|l|r|");
  });

  it("refuses to remove the last column", () => {
    // A `tabular` with an empty specification does not compile.
    const grid = readGrid("l", `a ${BREAK}`, 1);
    expect(removeColumn(grid, 0)).toBe(grid);
  });
});

describe("sizing", () => {
  it("gives a column a width as p{...}", () => {
    // What an author would have written, and what needs no package.
    const grid = setColumnWidth(readGrid("|l|c|r|", BODY, 3), 1, "4cm");
    expect(grid.spec).toBe("|l|p{4cm}|r|");
  });

  it("changes a width a column already had", () => {
    const grid = setColumnWidth(
      readGrid("p{3cm}l", `a & b ${BREAK}`, 2),
      0,
      "5cm",
    );
    expect(grid.spec).toBe("p{5cm}l");
  });

  it("keeps what was in front of the column type", () => {
    const grid = setColumnWidth(
      readGrid(">{\\raggedright}ll", `a & b ${BREAK}`, 2),
      0,
      "4cm",
    );
    expect(grid.spec).toBe(">{\\raggedright}p{4cm}l");
  });

  it("gives a row height as the space after its break", () => {
    const grid = setRowHeight(readGrid("ll", `a & b ${BREAK}`, 2), 0, "2ex");
    expect(writeGrid(grid)).toContain(`${BREAK}[2ex]`);
  });

  it("takes a row's height away again", () => {
    const withHeight = setRowHeight(
      readGrid("ll", `a & b ${BREAK}`, 2),
      0,
      "2ex",
    );
    const without = setRowHeight(withHeight, 0, "");
    expect(writeGrid(without)).not.toContain("[");
  });
});

describe("what an author's table survives", () => {
  it("stays valid through a sequence of changes", () => {
    // Operations compose, which is the thing a per-cell splice gets wrong: the
    // second edit would be working from offsets the first one moved.
    let grid = readGrid(SPEC, BODY, 3);
    grid = insertColumn(grid, 3);
    grid = insertRow(grid, 1);
    // The column that goes is the one just added, so every word the author
    // wrote has to still be there at the end. Removing one of theirs would
    // pass this test while losing their data, which is the failure worth
    // catching.
    grid = removeColumn(grid, 3);
    grid = setColumnWidth(grid, 0, "3cm");
    grid = insertRow(grid, 99);

    const columns = readSpec(grid.spec).columns.length;
    expect(columns).toBe(3);
    for (const row of readGrid(grid.spec, writeGrid(grid), columns).rows) {
      // Every row still has exactly as many cells as there are columns, which
      // is what "still compiles" means for a tabular.
      expect(row.cells).toHaveLength(columns);
    }
    // And the words are still there.
    expect(writeGrid(grid)).toContain("Schraube");
    expect(writeGrid(grid)).toContain("Preis");
  });
});
