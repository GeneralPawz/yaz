/**
 * Editing a table through the preview, end to end.
 *
 * `tableEdit.test.ts` checks the LaTeX these produce. This checks the part
 * that can be wrong even when that is right: that pressing a control puts the
 * new LaTeX **into the document, in the right place**, and that the buffer
 * afterwards is still the `.tex` a compiler would accept.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { history, historyKeymap, undo } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { richText, setLockTables, setRichText } from "./richText";
import { cellAt, nextCell } from "./tableWidget";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);
const BREAK = `${B}${B}`;

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(() => {
  setContributions([
    {
      pluginId: "com.yaz.latex-packages",
      commands: PACKAGE_COMMANDS,
      environments: PACKAGE_ENVIRONMENTS,
    },
  ]);
});

const views: EditorView[] = [];
afterEach(() => {
  setContributions([]);
  while (views.length > 0) views.pop()?.destroy();
});

/** A document with a table in it, drawn. */
const DOC = [
  "Before.",
  `${B}begin{tabular}{|l|c|}`,
  `${B}hline`,
  `Name & Menge ${BREAK}`,
  `Schraube & 20 ${BREAK}`,
  `${B}hline`,
  `${B}end{tabular}`,
  "After.",
].join("\n");

function mount(doc = DOC): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: globalThis.document.body,
  });
  views.push(view);
  view.dispatch({ effects: setRichText.of(true) });
  // Out of the table: the caret inside it reveals the source, which is the
  // right behaviour and the wrong place to be standing for these.
  view.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: false,
  });
  return view;
}

/** Press the nth control of a rail. */
function press(view: EditorView, rail: string, index: number): void {
  const controls = view.contentDOM.querySelectorAll(
    `.cm-yaz-table-rail-${rail} .cm-yaz-table-control`,
  );
  const button = controls[index];
  expect(button, `no control ${index} on the ${rail} rail`).toBeTruthy();
  (button as HTMLButtonElement).click();
}

describe("the controls on a drawn table", () => {
  it("offers a height handle on every row and a width handle on every column", () => {
    // There is no per-row height in a `tabular`, so the row handle writes the
    // space *after* a row — `\[2ex]`, which is what LaTeX has for this and
    // what an author would have typed.
    const view = mount();
    expect(
      view.contentDOM.querySelectorAll(".cm-yaz-table-handle-row"),
    ).toHaveLength(2);
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-columns .cm-yaz-table-handle",
      ),
    ).toHaveLength(2);
  });

  it("draws a rail for every column and every row", () => {
    const view = mount();
    // Two columns and two rows, each with an add and a remove.
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-columns .cm-yaz-table-control",
      ),
    ).toHaveLength(4);
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-rows .cm-yaz-table-control",
      ),
    ).toHaveLength(4);
  });

  it("adds a column to the document, not just to the picture", () => {
    const view = mount();
    press(view, "columns", 0);

    const text = view.state.doc.toString();
    expect(text).toContain(`${B}begin{tabular}{|l|l|c|}`);
    // Every row gained a cell, which is the part that is tedious by hand.
    expect(text).toContain(`Name & & Menge ${BREAK}`);
    expect(text).toContain(`Schraube & & 20 ${BREAK}`);
    // And nothing outside the table moved.
    expect(text.startsWith("Before.")).toBe(true);
    expect(text.trimEnd().endsWith("After.")).toBe(true);
  });

  it("removes a column from the specification and from every row", () => {
    const view = mount();
    press(view, "columns", 1);

    const text = view.state.doc.toString();
    expect(text).toContain(`${B}begin{tabular}{|c|}`);
    expect(text).toContain(`Menge ${BREAK}`);
    expect(text).not.toContain("Name &");
  });

  it("adds a row", () => {
    const view = mount();
    press(view, "rows", 0);

    const text = view.state.doc.toString();
    expect(text).toContain("Name");
    expect(text).toContain("Schraube");
    // Three rows now, so three row terminators inside the table.
    const body = text.slice(
      text.indexOf(`${B}hline`),
      text.indexOf(`${B}end{tabular}`),
    );
    expect(body.split(BREAK)).toHaveLength(4);
  });

  it("removes a row", () => {
    const view = mount();
    press(view, "rows", 1);

    const text = view.state.doc.toString();
    expect(text).not.toContain("Name &");
    expect(text).toContain("Schraube");
  });

  it("is one step to undo", () => {
    // Two ranges change — the specification and the body — and an author who
    // pressed one button expects one press of undo to answer it. That only
    // holds because both go in a single transaction.
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [richText(), history(), keymap.of(historyKeymap)],
      }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({ selection: EditorSelection.cursor(0) });

    press(view, "columns", 0);
    expect(view.state.doc.toString()).not.toBe(DOC);

    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("leaves the document compiling after several changes", () => {
    const view = mount();
    press(view, "columns", 0);
    press(view, "rows", 0);
    press(view, "columns", 2);

    const text = view.state.doc.toString();
    const spec = /\\begin\{tabular\}\{([^}]*)\}/.exec(text)?.[1] ?? "";
    const columns = spec.replace(/[^lcrp]/g, "").length;
    const body = text.slice(
      text.indexOf("}", text.indexOf("tabular")) + 1,
      text.indexOf(`${B}end{tabular}`),
    );
    for (const row of body.split(BREAK)) {
      if (row.replace(/\\hline|\s/g, "") === "") continue;
      // Every row has one fewer `&` than there are columns, which is what a
      // tabular that compiles looks like.
      expect(row.split("&")).toHaveLength(columns);
    }
  });
});

describe("moving from cell to cell", () => {
  const body = ` a & b ${BREAK} c & d ${BREAK} `;
  const from = 0;
  const to = body.length;

  it("goes to the next cell", () => {
    // Landing on the word, not on the space in front of it.
    expect(nextCell(body, from, to, 0, false)).toBe(body.indexOf("a"));
    const atA = body.indexOf("a");
    expect(nextCell(body, from, to, atA, false)).toBe(body.indexOf("b"));
    expect(nextCell(body, from, to, body.indexOf("b"), false)).toBe(
      body.indexOf("c"),
    );
  });

  it("goes back", () => {
    expect(nextCell(body, from, to, body.indexOf("c"), true)).toBe(
      body.indexOf("b"),
    );
    expect(nextCell(body, from, to, body.indexOf("a"), true)).toBe(null);
  });

  it("stops at the end rather than wrapping", () => {
    // Wrapping would take a caret from the last cell back to the first, which
    // no word processor does and which loses the author's place.
    expect(nextCell(body, from, to, body.indexOf("d"), false)).toBe(null);
  });

  it("does not treat an escaped ampersand as a boundary", () => {
    const escaped = ` Tom ${B}& Jerry & 2 ${BREAK} `;
    expect(
      nextCell(escaped, 0, escaped.length, escaped.indexOf("Tom"), false),
    ).toBe(escaped.indexOf("2"));
  });
});

/**
 * Keeping a table drawn while the caret is in it.
 *
 * Everywhere else in the view, the caret reveals a construct's source: editing
 * what you cannot read is worse than reading markup. A table is the case where
 * that rule works against itself — what you clicked into *is* the table — so
 * this is opt-in, and off leaves the old behaviour exactly as it was.
 */
describe("locking a table drawn", () => {
  /** A view with the caret inside the table's first cell. */
  function inTheTable(locked: boolean): EditorView {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [richText()] }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    if (locked) view.dispatch({ effects: setLockTables.of(true) });
    view.dispatch({
      selection: EditorSelection.cursor(DOC.indexOf("Name")),
      scrollIntoView: false,
    });
    return view;
  }

  it("shows the source when it is off, as everything else does", () => {
    const view = inTheTable(false);
    expect(view.contentDOM.querySelector("table")).toBeNull();
    expect(view.contentDOM.textContent).toContain("tabular");
  });

  it("keeps the table when it is on", () => {
    const view = inTheTable(true);
    expect(view.contentDOM.querySelector("table")).not.toBeNull();
    expect(view.contentDOM.textContent).not.toContain(`${B}begin{tabular}`);
  });

  it("marks the cell the caret is in", () => {
    // A caret inside a widget is not drawn by the browser, so without this an
    // author editing a locked table has no way of telling where they are.
    const view = inTheTable(true);
    const active = view.contentDOM.querySelector(".cm-yaz-cell-active");
    expect(active).not.toBeNull();
    expect(active?.textContent).toContain("Name");
  });

  it("moves the mark with the caret", () => {
    const view = inTheTable(true);
    view.dispatch({
      selection: EditorSelection.cursor(DOC.indexOf("Menge")),
      scrollIntoView: false,
    });
    expect(
      view.contentDOM.querySelector(".cm-yaz-cell-active")?.textContent,
    ).toContain("Menge");
  });

  it("marks nothing when the caret is outside", () => {
    const view = inTheTable(true);
    view.dispatch({
      selection: EditorSelection.cursor(0),
      scrollIntoView: false,
    });
    expect(view.contentDOM.querySelector(".cm-yaz-cell-active")).toBeNull();
  });
});

describe("finding the cell an offset is in", () => {
  const body = ` a & b ${BREAK} c & d ${BREAK} `;

  it("counts rows and columns from the start of the body", () => {
    expect(cellAt(body, 0, body.length, body.indexOf("a"))).toEqual({
      row: 0,
      column: 0,
    });
    expect(cellAt(body, 0, body.length, body.indexOf("b"))).toEqual({
      row: 0,
      column: 1,
    });
    expect(cellAt(body, 0, body.length, body.indexOf("d"))).toEqual({
      row: 1,
      column: 1,
    });
  });

  it("does not count an escaped ampersand as a column", () => {
    // A highlight on the wrong cell is worse than none: it says confidently
    // where the caret is not.
    const escaped = ` Tom ${B}& Jerry & 2 ${BREAK} `;
    expect(
      cellAt(escaped, 0, escaped.length, escaped.indexOf("Jerry")),
    ).toEqual({ row: 0, column: 0 });
  });

  it("says nothing for an offset outside the body", () => {
    expect(cellAt(body, 2, 6, 0)).toBeNull();
  });
});
