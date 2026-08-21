/**
 * Changing a table's shape, as LaTeX.
 *
 * # What this is and is not
 *
 * [`tabular.ts`](./tabular.ts) reads a table in order to *draw* it, and throws
 * the source away as it goes: what it keeps is rendered HTML. That is right for
 * drawing and useless for editing, because adding a column means writing a
 * `&` into the source of every row — and the source is the thing that was
 * discarded.
 *
 * So this reads the same text into a grid of **source strings**, changes the
 * grid, and writes it back out. Nothing here renders anything.
 *
 * # Why a whole-body rewrite
 *
 * The alternative is tracking an offset per cell and splicing. That is faster
 * and it is wrong in a way that is hard to see: an operation on one cell moves
 * every offset after it, so the second edit in a row uses stale positions.
 * Rewriting the body means one edit per operation, expressed as one replacement
 * of a range the caller already knows — which is also what makes it a single
 * step to undo.
 *
 * A table is tens of cells. There is no document where this is the expensive
 * thing.
 *
 * # What is deliberately preserved
 *
 * The whitespace and the rules. An author who has laid a table out by hand and
 * then adds a row should get their layout back with a row in it, not a table
 * reflowed to this module's taste — so cell text is carried across untouched,
 * and only the separators between cells are written fresh.
 */

/** One row of the grid, as it is written. */
export interface GridRow {
  /** Cell source, untrimmed, one per column. */
  cells: string[];
  /**
   * What comes before the row: `\hline`, `\toprule`, and any whitespace.
   *
   * Carried whole rather than parsed. Which rule an author chose is theirs,
   * and a table that turned every `\toprule` into `\hline` on being edited
   * would be quietly rewriting their document.
   */
  before: string;
  /** The optional `[2pt]` after this row's `\\`, without the brackets. */
  extraSpace: string | null;
  /** Whether this row ends with `\\` at all. The last one often does not. */
  terminated: boolean;
}

/** A table's source, in a shape that can be changed. */
export interface Grid {
  /** The column specification, e.g. `|l|c|r|`. */
  spec: string;
  rows: GridRow[];
  /** Anything after the last row: a trailing `\hline` and its whitespace. */
  after: string;
}

/** Rule commands that may stand between rows. */
const RULES = new Set([
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "cline",
  "cmidrule",
  "specialrule",
  "addlinespace",
  "morecmidrules",
  "hdashline",
]);

/**
 * Split on a separator at brace depth zero.
 *
 * The same rule the renderer uses: `\&` is an ampersand in a cell and not a
 * cell boundary, and a `&` inside `\multicolumn{2}{c}{a & b}` belongs to the
 * argument rather than to the row.
 */
function splitCells(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "&" && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/** Where a row's leading rules stop and its first cell begins. */
function afterRules(text: string): number {
  let cursor = 0;
  for (;;) {
    while (cursor < text.length && /\s/.test(text[cursor]!)) cursor += 1;
    const match = /^\\([a-zA-Z]+)/.exec(text.slice(cursor));
    const name = match?.[1];
    if (!name || !RULES.has(name)) return cursor;

    cursor += 1 + name.length;
    // Their arguments: `\cmidrule(lr){2-3}`, `\specialrule{a}{b}{c}`.
    if (text[cursor] === "(") {
      const close = text.indexOf(")", cursor);
      if (close !== -1) cursor = close + 1;
    }
    while (text[cursor] === "{") {
      const close = text.indexOf("}", cursor);
      if (close === -1) break;
      cursor = close + 1;
    }
  }
}

/**
 * Read a table body into a grid.
 *
 * `columns` is how wide the grid should be. A row with fewer cells than that is
 * padded, because a table whose rows disagree is a table an author is halfway
 * through writing — and refusing to edit it would be refusing exactly when
 * help is wanted.
 */
export function readGrid(spec: string, body: string, columns: number): Grid {
  const rows: GridRow[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;

  const take = (
    text: string,
    extraSpace: string | null,
    terminated: boolean,
  ) => {
    const at = afterRules(text);
    const before = text.slice(0, at);
    const cells = splitCells(text.slice(at));
    while (cells.length < columns) cells.push(" ");
    rows.push({ cells, before, extraSpace, terminated });
  };

  for (; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character !== "\\") continue;

    if (body[index + 1] !== "\\" || depth !== 0) {
      index += 1;
      continue;
    }

    let cursor = index + 2;
    if (body[cursor] === "*") cursor += 1;
    let extraSpace: string | null = null;
    if (body[cursor] === "[") {
      const close = body.indexOf("]", cursor);
      if (close !== -1) {
        extraSpace = body.slice(cursor + 1, close);
        cursor = close + 1;
      }
    }
    take(body.slice(start, index), extraSpace, true);
    start = cursor;
    index = cursor - 1;
  }

  // What is left after the last `\\`. Usually a closing rule and whitespace,
  // and sometimes a final row that was written without a terminator.
  const tail = body.slice(start);
  const at = afterRules(tail);
  if (tail.slice(at).trim() === "") {
    return { spec, rows, after: tail };
  }
  take(tail, null, false);
  return { spec, rows, after: "" };
}

/** Write a grid back out as a table body. */
export function writeGrid(grid: Grid): string {
  let out = "";
  for (const row of grid.rows) {
    out += row.before;
    out += row.cells.join("&");
    if (row.terminated) {
      out += "\\\\";
      if (row.extraSpace !== null) out += `[${row.extraSpace}]`;
    }
  }
  return out + grid.after;
}

/** How the author spaced their cells, so a new one matches. */
function houseStyle(grid: Grid): { pad: string; blank: string } {
  const sample = grid.rows[0]?.cells[0] ?? " ";
  const pad = /^\s/.test(sample) ? " " : "";
  return { pad, blank: `${pad} ${pad}`.replace(/^ +$/, " ") };
}

/**
 * Put a row in at `at`, counting from zero; `at` past the end appends.
 *
 * The new row copies the shape of the one above it and none of its words: an
 * author adding a row wants a row, not a duplicate of the last one.
 */
export function insertRow(grid: Grid, at: number): Grid {
  const width = grid.rows[0]?.cells.length ?? 1;
  const { blank } = houseStyle(grid);
  const index = Math.max(0, Math.min(at, grid.rows.length));

  // A row is written on its own line when the table is written that way, which
  // is nearly always. Taken from the row above rather than assumed.
  const above = grid.rows[index - 1] ?? grid.rows[0];
  const before =
    above && /\n/.test(above.before)
      ? above.before.replace(/[^\s]/g, "").replace(/\n\s*$/, (m) => m)
      : "\n";

  const fresh: GridRow = {
    cells: Array.from({ length: width }, () => blank),
    before: /\n/.test(before) ? before : "\n",
    extraSpace: null,
    terminated: true,
  };

  const rows = [...grid.rows];
  // The row that was last may have had no terminator. It has one now, because
  // something follows it.
  if (index === rows.length && rows.length > 0) {
    const previous = rows[rows.length - 1]!;
    rows[rows.length - 1] = { ...previous, terminated: true };
  }
  rows.splice(index, 0, fresh);
  return { ...grid, rows };
}

/** Take a row out. Removing the only row leaves the table with one empty one. */
export function removeRow(grid: Grid, at: number): Grid {
  if (at < 0 || at >= grid.rows.length) return grid;
  if (grid.rows.length === 1) {
    const width = grid.rows[0]!.cells.length;
    const { blank } = houseStyle(grid);
    return {
      ...grid,
      rows: [
        {
          ...grid.rows[0]!,
          cells: Array.from({ length: width }, () => blank),
        },
      ],
    };
  }

  const rows = grid.rows.filter((_, index) => index !== at);
  // The rules that stood above the row that has gone belong to whatever is
  // there now — otherwise deleting the first row of a table takes its
  // `\toprule` with it and the table loses its top edge.
  const removed = grid.rows[at]!;
  if (at < rows.length && removed.before.trim() !== "") {
    const next = rows[at]!;
    if (next.before.trim() === "") {
      rows[at] = { ...next, before: removed.before };
    }
  }
  return { ...grid, rows };
}

/** One entry of a column specification, with its `|` rules. */
interface SpecColumn {
  /** The column type and any argument: `l`, `p{3cm}`, `>{\raggedright}X`. */
  body: string;
  /** How many `|` stand before it. */
  rulesBefore: number;
}

/** Split a specification into columns, keeping each one's text. */
export function readSpec(spec: string): {
  columns: SpecColumn[];
  rulesAfter: number;
} {
  const columns: SpecColumn[] = [];
  let rules = 0;
  let index = 0;

  while (index < spec.length) {
    const character = spec[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "|") {
      rules += 1;
      index += 1;
      continue;
    }

    const start = index;
    // A `>{...}` or `<{...}` modifier belongs to the column that follows it.
    while (
      index < spec.length &&
      (spec[index] === ">" || spec[index] === "<")
    ) {
      index += 1;
      index = pastBraces(spec, index, 1);
    }
    if (index < spec.length) {
      const type = spec[index]!;
      index += 1;
      // The types that take a width: `p{3cm}`, `m{2cm}`, `b{1in}`.
      if ("pmb".includes(type) && spec[index] === "{") {
        index = pastBraces(spec, index, 1);
      }
      // `*{3}{c}` repeats, which this does not expand — it is carried whole,
      // and a table that uses it simply does not offer a column resize.
      if (type === "*") index = pastBraces(spec, index, 2);
    }
    columns.push({ body: spec.slice(start, index), rulesBefore: rules });
    rules = 0;
  }

  return { columns, rulesAfter: rules };
}

/** Skip `count` brace groups. */
function pastBraces(text: string, at: number, count: number): number {
  let cursor = at;
  for (let taken = 0; taken < count; taken += 1) {
    if (text[cursor] !== "{") return cursor;
    let depth = 0;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === "{") depth += 1;
      else if (text[cursor] === "}") {
        depth -= 1;
        if (depth === 0) {
          cursor += 1;
          break;
        }
      }
    }
  }
  return cursor;
}

/** Write columns back out as a specification. */
export function writeSpec(
  columns: readonly SpecColumn[],
  rulesAfter: number,
): string {
  let out = "";
  for (const column of columns) {
    out += "|".repeat(column.rulesBefore) + column.body;
  }
  return out + "|".repeat(rulesAfter);
}

/**
 * Put a column in at `at`, taking its type from the column beside it.
 *
 * Both the specification and every row change, which is the whole reason this
 * is worth having: doing it by hand means an `&` in the right place in each of
 * twenty rows, and getting one wrong is a table that will not compile.
 */
export function insertColumn(grid: Grid, at: number): Grid {
  const { columns, rulesAfter } = readSpec(grid.spec);
  const index = Math.max(0, Math.min(at, columns.length));
  // The column to the *left* of where this is going, when there is one. The
  // control says "add a column after this one", so the one it should look like
  // is the one it was added after — not the one it pushes along.
  const like = columns[index - 1] ?? columns[index];
  const fresh: SpecColumn = {
    // The neighbour's type, but never its width: a fresh column copying
    // `p{3cm}` would silently make the table wider than the page.
    body: like ? like.body.replace(/^([pmb])\{[^}]*\}$/, "l") : "l",
    rulesBefore: like?.rulesBefore ?? 0,
  };

  const next = [...columns];
  next.splice(index, 0, fresh);

  const { blank } = houseStyle(grid);
  const rows = grid.rows.map((row) => {
    const cells = [...row.cells];
    cells.splice(Math.min(index, cells.length), 0, blank);
    return { ...row, cells };
  });

  return { spec: writeSpec(next, rulesAfter), rows, after: grid.after };
}

/** Take a column out, from the specification and from every row. */
export function removeColumn(grid: Grid, at: number): Grid {
  const { columns, rulesAfter } = readSpec(grid.spec);
  if (at < 0 || at >= columns.length || columns.length === 1) return grid;

  const next = columns.filter((_, index) => index !== at);
  // The removed column's rules go to the one that takes its place, so a table
  // ruled `|l|l|` does not lose an edge when a column goes.
  const removed = columns[at]!;
  if (at < next.length && removed.rulesBefore > 0) {
    next[at] = {
      ...next[at]!,
      rulesBefore: Math.max(next[at]!.rulesBefore, removed.rulesBefore),
    };
  }

  const rows = grid.rows.map((row) => ({
    ...row,
    cells: row.cells.filter((_, index) => index !== at),
  }));

  return { spec: writeSpec(next, rulesAfter), rows, after: grid.after };
}

/**
 * Give a column a fixed width, which is what dragging its edge means.
 *
 * `p{...}` rather than anything cleverer: it is the column type LaTeX has for
 * "this wide, and wrap", it needs no package, and it is what an author would
 * have written. A column that was `l` becomes `p{4cm}`; one that was already
 * `p{3cm}` has its measurement changed and keeps everything else.
 */
export function setColumnWidth(grid: Grid, at: number, width: string): Grid {
  const { columns, rulesAfter } = readSpec(grid.spec);
  if (at < 0 || at >= columns.length) return grid;

  const column = columns[at]!;
  // Whatever modifiers were in front — `>{\raggedright}` and the like — stay.
  const modifiers = /^((?:[<>]\{(?:[^{}]|\{[^{}]*\})*\})*)/.exec(column.body);
  const kept = modifiers?.[1] ?? "";
  const next = [...columns];
  next[at] = { ...column, body: `${kept}p{${width}}` };

  return {
    spec: writeSpec(next, rulesAfter),
    rows: grid.rows,
    after: grid.after,
  };
}

/**
 * Give a row extra height, which is what dragging its edge means.
 *
 * As `\\[2ex]`, which is LaTeX's own way of asking for more room after a row.
 * An empty `height` takes it away again.
 */
export function setRowHeight(grid: Grid, at: number, height: string): Grid {
  if (at < 0 || at >= grid.rows.length) return grid;
  const rows = [...grid.rows];
  rows[at] = {
    ...rows[at]!,
    extraSpace: height === "" ? null : height,
    // A row with spacing after it must have a `\\` to hang it on.
    terminated: height === "" ? rows[at]!.terminated : true,
  };
  return { ...grid, rows };
}
