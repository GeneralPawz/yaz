/**
 * Reading a `tabular` body into rows and cells.
 *
 * A table is the one construct in a paper that is genuinely unreadable as
 * source: alignment lives in a column specification at the top, the cells are
 * separated by ampersands, and nothing lines up until it is compiled. So the
 * rich-text view draws it, and the source comes back the moment the cursor
 * touches it.
 *
 * # What is understood, and what is not
 *
 * Column alignment, `\\` row breaks, `&` cells, the `\hline` and booktabs
 * rules, and `\multicolumn`. Not `\multirow`, not nested tables, not
 * `\rowcolor`. Those are left to the caller to detect and refuse: a table drawn
 * wrongly is worse than a table shown as source, because the author cannot see
 * that it is wrong.
 */

import { inlineHtml } from "./inline";
import { evict } from "./math";
import { matchBrace } from "./structure";

/** How a column is set, and whether it has a rule beside it. */
export interface Column {
  align: "left" | "center" | "right";
  /** A `|` before this column. */
  ruleBefore: boolean;
  /** A `|` after the last column. Only ever set on the last one. */
  ruleAfter: boolean;
}

/** One cell of a row. */
export interface Cell {
  /** Rendered contents. */
  html: string;
  /** How many columns it covers; more than one only for `\multicolumn`. */
  span: number;
  /** Alignment, when the cell overrides its column's. */
  align: Column["align"] | null;
}

/** One row of the table. */
export interface Row {
  cells: Cell[];
  /** A horizontal rule above this row. */
  ruleAbove: boolean;
  /** A horizontal rule below this row. Only ever set on the last one. */
  ruleBelow: boolean;
}

/** A parsed table. */
export interface Table {
  columns: Column[];
  rows: Row[];
  /**
   * Whether the first row is a heading.
   *
   * Inferred from a rule under it, which is how a table says so in print. A
   * heading row is rendered as one, which matters to a screen reader as much as
   * to the eye.
   */
  heading: boolean;
}

/** Alignment letters, and the LaTeX column types that take a width argument. */
const ALIGNMENTS: Record<string, Column["align"]> = {
  l: "left",
  c: "center",
  r: "right",
  p: "left",
  m: "left",
  b: "left",
  X: "left",
};

/** Column-spec characters that introduce a group to be skipped. */
const SPEC_GROUPS = new Set(["@", "!", ">", "<"]);

/** Commands that draw a rule rather than contributing a cell. */
const RULES = new Set([
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "cline",
  "cmidrule",
  "addlinespace",
  "specialrule",
  "hdashline",
]);

/**
 * Read a column specification into columns.
 *
 * `*{3}{c}` is expanded, `p{5cm}` becomes a left-aligned column, and the
 * formatting groups `@{}`, `>{}`, `<{}` and `!{}` are skipped — they change how
 * a column is set, not how many there are.
 */
export function parseColumnSpec(spec: string): Column[] {
  const columns: Column[] = [];
  let pendingRule = false;

  for (let index = 0; index < spec.length; index += 1) {
    const character = spec[index]!;

    if (character === "|") {
      if (columns.length > 0 && index === spec.length - 1) {
        columns[columns.length - 1]!.ruleAfter = true;
      } else {
        pendingRule = true;
      }
      continue;
    }

    if (character === "*") {
      // `*{n}{sub}`: n repetitions of the sub-specification.
      const count =
        spec[index + 1] === "{" ? matchBrace(spec, index + 1) : null;
      const sub =
        count !== null && spec[count] === "{" ? matchBrace(spec, count) : null;
      if (count !== null && sub !== null) {
        const times = Number.parseInt(
          spec.slice(index + 2, count - 1).trim(),
          10,
        );
        const inner = spec.slice(count + 1, sub - 1);
        // A repetition count that is not a number is a macro we cannot expand;
        // dropping it loses columns, which the caller notices as a cell count
        // that does not match.
        for (
          let repeat = 0;
          repeat < (Number.isFinite(times) ? times : 0);
          repeat += 1
        ) {
          for (const column of parseColumnSpec(inner)) {
            columns.push({
              ...column,
              ruleBefore: column.ruleBefore || pendingRule,
            });
            pendingRule = false;
          }
        }
        index = sub - 1;
        continue;
      }
    }

    if (SPEC_GROUPS.has(character)) {
      const end = spec[index + 1] === "{" ? matchBrace(spec, index + 1) : null;
      index = end === null ? index : end - 1;
      continue;
    }

    const align = ALIGNMENTS[character];
    if (!align) continue;

    columns.push({ align, ruleBefore: pendingRule, ruleAfter: false });
    pendingRule = false;

    // `p{5cm}` and friends carry a width; it is the column's, not a cell's.
    if ("pmbX".includes(character) && spec[index + 1] === "{") {
      const end = matchBrace(spec, index + 1);
      if (end !== null) index = end - 1;
    }
  }

  return columns;
}

/** Split on a character at brace depth zero, honouring escapes. */
function splitTop(text: string, separator: string): string[] {
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
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/**
 * Split a body into rows on `\\`, at brace depth zero.
 *
 * The optional `[2pt]` that may follow a row break is consumed with it: it is
 * spacing, not the next row's first cell.
 */
function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < body.length; index += 1) {
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
      // Any other escape: skip what it escapes, so `\&` is not a separator.
      index += 1;
      continue;
    }

    rows.push(body.slice(start, index));
    let cursor = index + 2;
    if (body[cursor] === "*") cursor += 1;
    if (body[cursor] === "[") {
      const close = body.indexOf("]", cursor);
      if (close !== -1) cursor = close + 1;
    }
    start = cursor;
    index = cursor - 1;
  }

  rows.push(body.slice(start));
  return rows;
}

/** Strip leading rule commands, reporting whether any were there. */
function takeRules(text: string): { rest: string; ruled: boolean } {
  let rest = text;
  let ruled = false;

  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    const name = /^\\([a-zA-Z]+)/.exec(trimmed)?.[1];
    if (!name || !RULES.has(name)) return { rest: trimmed, ruled };

    ruled = true;
    let cursor = 1 + name.length;
    // Their arguments — `\cmidrule(lr){2-3}`, `\specialrule{.8pt}{0pt}{0pt}` —
    // say where the rule goes, which this does not draw at that resolution.
    for (;;) {
      while (trimmed[cursor] === " ") cursor += 1;
      const opener = trimmed[cursor];
      if (opener === "{") {
        const end = matchBrace(trimmed, cursor);
        if (end === null) break;
        cursor = end;
        continue;
      }
      if (opener === "[" || opener === "(") {
        const close = trimmed.indexOf(opener === "[" ? "]" : ")", cursor);
        if (close === -1) break;
        cursor = close + 1;
        continue;
      }
      break;
    }
    rest = trimmed.slice(cursor);
  }
}

/** Read `\multicolumn{n}{spec}{content}`, if that is what this cell is. */
function readMulticolumn(text: string): Cell | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("\\multicolumn")) return null;

  const countAt = trimmed.indexOf("{", "\\multicolumn".length);
  if (countAt === -1) return null;
  const countEnd = matchBrace(trimmed, countAt);
  if (countEnd === null || trimmed[countEnd] !== "{") return null;
  const specEnd = matchBrace(trimmed, countEnd);
  if (specEnd === null || trimmed[specEnd] !== "{") return null;
  const contentEnd = matchBrace(trimmed, specEnd);
  if (contentEnd === null) return null;

  const span = Number.parseInt(
    trimmed.slice(countAt + 1, countEnd - 1).trim(),
    10,
  );
  const [column] = parseColumnSpec(trimmed.slice(countEnd + 1, specEnd - 1));
  return {
    html: inlineHtml(trimmed.slice(specEnd + 1, contentEnd - 1)),
    span: Number.isFinite(span) && span > 0 ? span : 1,
    align: column?.align ?? null,
  };
}

/**
 * Parse a `tabular` body against its column specification.
 *
 * Rows that hold nothing but a rule become a rule on their neighbour rather
 * than an empty row, which is what they mean.
 */
export function parseTabular(spec: string, body: string): Table {
  const columns = parseColumnSpec(spec);
  const rows: Row[] = [];
  let pendingRule = false;

  for (const source of splitRows(body)) {
    const { rest, ruled } = takeRules(source);
    if (ruled) pendingRule = true;

    if (rest.trim() === "") {
      // A rule with no row after it belongs under the row before it.
      if (ruled && rows.length > 0) {
        rows[rows.length - 1]!.ruleBelow = true;
        pendingRule = false;
      }
      continue;
    }

    const cells: Cell[] = [];
    for (const cell of splitTop(rest, "&")) {
      cells.push(
        readMulticolumn(cell) ?? {
          html: inlineHtml(cell.trim()),
          span: 1,
          align: null,
        },
      );
    }

    rows.push({ cells, ruleAbove: pendingRule, ruleBelow: false });
    pendingRule = false;
  }

  return {
    columns,
    rows,
    heading: rows.length > 1 && rows[1]!.ruleAbove,
  };
}

/** Whether a body holds something this parser would draw wrongly. */
export function tooComplexToDraw(body: string): boolean {
  return /\\multirow|\\begin\s*\{\s*tabular/.test(body);
}

/** Render a parsed table as HTML. */
export function tableHtml(table: Table): string {
  const rows = table.rows.map((row, index) => {
    const heading = table.heading && index === 0;
    let column = 0;
    const cells = row.cells.map((cell) => {
      const align = cell.align ?? table.columns[column]?.align ?? "left";
      const ruleBefore = table.columns[column]?.ruleBefore
        ? " cm-yaz-td-rule-start"
        : "";
      column += cell.span;
      const ruleAfter =
        column === table.columns.length && table.columns[column - 1]?.ruleAfter
          ? " cm-yaz-td-rule-end"
          : "";
      const span = cell.span > 1 ? ` colspan="${cell.span}"` : "";
      const tag = heading ? "th" : "td";
      return `<${tag} class="cm-yaz-td cm-yaz-align-${align}${ruleBefore}${ruleAfter}"${span}>${cell.html}</${tag}>`;
    });

    const classes = [
      row.ruleAbove ? "cm-yaz-tr-rule-above" : "",
      row.ruleBelow ? "cm-yaz-tr-rule-below" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<tr${classes ? ` class="${classes}"` : ""}>${cells.join("")}</tr>`;
  });

  const [first, ...rest] = rows;
  const head = table.heading && first ? `<thead>${first}</thead>` : "";
  const bodyRows = table.heading ? rest : rows;
  return `<table class="cm-yaz-table">${head}<tbody>${bodyRows.join("")}</tbody></table>`;
}

/** Rendered tables by source, for the same reason mathematics is cached. */
const rendered = new Map<string, string | null>();

/** How many rendered tables to keep. See `evict` for why the oldest half goes. */
const CACHE_LIMIT = 512;

/**
 * Parse and render a table, or `null` if there is nothing to draw.
 *
 * Cached because decorations are rebuilt on every keystroke, and parsing every
 * table in a manuscript and building its HTML each time is work the keystroke
 * budget in ADR-0015 does not have room for.
 */
export function renderTable(spec: string, body: string): string | null {
  const key = `${spec}\u0000${body}`;
  const cached = rendered.get(key);
  if (cached !== undefined) return cached;

  const table = parseTabular(spec, body);
  const html =
    table.columns.length === 0 || table.rows.length === 0
      ? null
      : tableHtml(table);

  evict(rendered, CACHE_LIMIT);
  rendered.set(key, html);
  return html;
}
