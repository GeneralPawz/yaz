/**
 * A table you can change, in the preview.
 *
 * # What this is for
 *
 * Adding a column to a LaTeX table by hand means putting an `&` in exactly the
 * right place in every row. Twenty rows is twenty chances to get it wrong, and
 * getting one wrong is a table that will not compile — with an error that
 * points at the `\end{tabular}` rather than at the row you missed. That is the
 * job worth taking off an author, and it is why this exists.
 *
 * # It edits the buffer, not a model of it
 *
 * There is one document and it holds the raw `.tex` ([ADR-0004]). Every control
 * here works out what the LaTeX should say and dispatches a change to the
 * buffer, exactly as though the author had typed it. Nothing is held in the
 * widget between edits, the change is one step to undo, and what the compiler
 * sees is what the screen showed.
 *
 * The shape of the LaTeX is [`tableEdit.ts`](./tableEdit.ts)'s business. This
 * file is the surface: rails along the top and side, a handle between columns,
 * and the arithmetic that turns a drag in pixels into a width in centimetres.
 *
 * [ADR-0004]: https://texyaz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer
 */

import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, WidgetType, keymap } from "@codemirror/view";

import { t } from "../i18n";
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
} from "./tableEdit";

/**
 * Where a table's parts are in the document.
 *
 * Offsets and no text. Holding a copy of the body would mean two things that
 * can disagree — and they would, because a widget is kept while it compares
 * equal, so a change the drawing did not notice would leave the copy stale and
 * the next edit would write the stale version back.
 *
 * It is also what keeps this off the keystroke path: comparing two copies of a
 * table body, per table, per keystroke, cost more than everything else this
 * widget does.
 */
export interface TableSource {
  /** The column specification, inside its braces. */
  specFrom: number;
  specTo: number;
  /** The body: every row, between the specification and `\end{tabular}`. */
  bodyFrom: number;
  bodyTo: number;
}

/** Pixels to a centimetre at the usual screen resolution. */
const PX_PER_CM = 96 / 2.54;

/** Narrower than this and a column cannot hold a word. */
const NARROWEST_CM = 0.5;

/** Wider than this and the table is off the paper whatever the paper is. */
const WIDEST_CM = 25;

/**
 * A drawn table, with the handles that change it.
 *
 * The HTML of the table itself is rendered elsewhere and handed in: this adds
 * the rails around it and the behaviour.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly html: string,
    /** How many columns and rows, so the rails know what to draw. */
    readonly columns: number,
    readonly rows: number,
    /**
     * The cell the caret is in, when the table is locked drawn.
     *
     * `null` when the caret is elsewhere, or when the table would have shown
     * its source anyway. A caret inside a widget is not drawn by the browser,
     * so without this an author editing a locked table has no way of telling
     * where they are.
     */
    readonly active: { row: number; column: number } | null = null,
  ) {
    super();
  }

  /**
   * By what is drawn, and by nothing else.
   *
   * Deliberately *not* by where the table is. An earlier version compared the
   * document offsets, which is the obvious thing to do when the handles write
   * against those offsets — and it meant that typing one character anywhere
   * rebuilt every table below it, because every one of them had moved. On a
   * document made largely of tables that cost 2 ms of the 16 the keystroke
   * has.
   *
   * So the offsets are not held at all. {@link locate} finds them when a
   * control is actually pressed, from where the widget turned out to be, which
   * is both cheaper and impossible to hold a stale copy of.
   */
  override eq(other: TableWidget): boolean {
    return (
      other.html === this.html &&
      other.columns === this.columns &&
      other.rows === this.rows &&
      other.active?.row === this.active?.row &&
      other.active?.column === this.active?.column
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement("div");
    frame.className = "cm-yaz-block cm-yaz-table-host cm-yaz-table-frame";

    const table = document.createElement("div");
    table.className = "cm-yaz-table-body";
    table.innerHTML = this.html;
    this.mark(table);

    frame.append(
      this.columnRail(view, frame, table, this.columns),
      this.rowRail(view, frame, this.rows),
      table,
    );
    return frame;
  }

  /**
   * Clicks are ours; typing is not.
   *
   * `false` lets the buttons work at all. CodeMirror would otherwise treat
   * every event inside a widget as something to route back to the document.
   */
  override ignoreEvent(): boolean {
    return false;
  }

  /**
   * Where this table is in the document, right now.
   *
   * From the widget's own element rather than from anything remembered: the
   * element knows where it ended up, and asking at the moment of the edit is
   * what makes a stale answer impossible.
   */
  private locate(view: EditorView, frame: HTMLElement): TableSource | null {
    let at: number;
    try {
      at = view.posAtDOM(frame);
    } catch {
      return null;
    }

    const text = view.state.doc.toString();
    // Backwards first. `posAtDOM` may answer with either edge of the replaced
    // range, and searching only forwards from the far edge walks straight past
    // the table this widget stands for — into the next one, or into nothing.
    const OPEN = "\\begin{tabular";
    const CLOSE = "\\end{tabular";
    let opened = text.lastIndexOf(OPEN, at);
    if (opened === -1 || text.indexOf(CLOSE, opened) < at) {
      opened = text.indexOf(OPEN, at);
    }
    if (opened === -1) return null;
    const closed = text.indexOf(CLOSE, opened);
    if (closed === -1) return null;

    // Past `{tabular}` and any `[t]`, to the specification's braces.
    let cursor = text.indexOf("}", opened);
    if (cursor === -1) return null;
    cursor += 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] === "[") {
      const close = text.indexOf("]", cursor);
      if (close === -1) return null;
      cursor = close + 1;
    }
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "{") return null;

    const specFrom = cursor + 1;
    let depth = 0;
    for (; cursor < closed; cursor += 1) {
      if (text[cursor] === "{") depth += 1;
      else if (text[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (cursor >= closed) return null;

    return {
      specFrom,
      specTo: cursor,
      bodyFrom: cursor + 1,
      bodyTo: closed,
    };
  }

  /** Put a border round the cell the caret is in. */
  private mark(table: HTMLElement): void {
    if (!this.active) return;
    const row = table.querySelectorAll("tr")[this.active.row];
    const cell = row?.children[this.active.column];
    if (cell instanceof HTMLElement) {
      cell.classList.add("cm-yaz-cell-active");
    }
  }

  /** The strip above the table: one segment per column. */
  private columnRail(
    view: EditorView,
    frame: HTMLElement,
    table: HTMLElement,
    columns: number,
  ): HTMLElement {
    const rail = document.createElement("div");
    rail.className = "cm-yaz-table-rail cm-yaz-table-rail-columns";

    for (let index = 0; index < columns; index += 1) {
      const segment = document.createElement("div");
      segment.className = "cm-yaz-table-segment";

      segment.append(
        this.button(t("table-column-add"), "+", () =>
          this.change(view, frame, (grid) => insertColumn(grid, index + 1)),
        ),
        this.button(t("table-column-remove"), "×", () =>
          this.change(view, frame, (grid) => removeColumn(grid, index)),
        ),
      );

      // The handle sits on the boundary this column shares with the next, so
      // dragging it means what dragging a column edge means anywhere else.
      const handle = document.createElement("div");
      handle.className = "cm-yaz-table-handle";
      handle.title = t("table-column-width");
      handle.addEventListener("pointerdown", (event) =>
        this.dragWidth(view, frame, event, index, table),
      );
      segment.append(handle);

      rail.append(segment);
    }
    return rail;
  }

  /** The strip down the left: one segment per row. */
  private rowRail(
    view: EditorView,
    frame: HTMLElement,
    rows: number,
  ): HTMLElement {
    const rail = document.createElement("div");
    rail.className = "cm-yaz-table-rail cm-yaz-table-rail-rows";

    for (let index = 0; index < rows; index += 1) {
      const segment = document.createElement("div");
      segment.className = "cm-yaz-table-segment";
      segment.append(
        this.button(t("table-row-add"), "+", () =>
          this.change(view, frame, (grid) => insertRow(grid, index + 1)),
        ),
        this.button(t("table-row-remove"), "×", () =>
          this.change(view, frame, (grid) => removeRow(grid, index)),
        ),
      );

      // The boundary this row shares with the one below it.
      const handle = document.createElement("div");
      handle.className = "cm-yaz-table-handle cm-yaz-table-handle-row";
      handle.title = t("table-row-height");
      handle.addEventListener("pointerdown", (event) =>
        this.dragHeight(view, frame, event, index),
      );
      segment.append(handle);

      rail.append(segment);
    }
    return rail;
  }

  /** One control on a rail. */
  private button(
    label: string,
    glyph: string,
    act: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-yaz-table-control";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = glyph;
    // Without this the editor takes focus and moves the selection before the
    // click lands, which scrolls the view and can reveal the table as source
    // underneath the button being pressed.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      act();
    });
    return button;
  }

  /**
   * Apply a change to the grid and write the result into the document.
   *
   * The specification and the body are two separate ranges, so this is two
   * changes in one transaction — one step to undo, and no window in which the
   * table has a column in its rows that its specification does not know about.
   */
  private change(
    view: EditorView,
    frame: HTMLElement,
    act: (grid: ReturnType<typeof readGrid>) => ReturnType<typeof readGrid>,
  ): void {
    const found = this.locate(view, frame);
    if (!found) return;
    const { specFrom, specTo, bodyFrom, bodyTo } = found;
    const spec = view.state.doc.sliceString(specFrom, specTo);
    const body = view.state.doc.sliceString(bodyFrom, bodyTo);
    const columns = readSpec(spec).columns.length;
    const next = act(readGrid(spec, body, columns));

    view.dispatch({
      changes: [
        { from: specFrom, to: specTo, insert: next.spec },
        { from: bodyFrom, to: bodyTo, insert: writeGrid(next) },
      ],
      // The caret goes nowhere near the table: putting it inside would reveal
      // the source, which is the opposite of what pressing a button in the
      // drawn table asks for.
      scrollIntoView: false,
    });
  }

  /**
   * Drag a column's edge, and write the width it lands on.
   *
   * The width is taken from where the pointer stops rather than followed
   * continuously: a document change per mouse-move would be a hundred undo
   * steps for one drag.
   */
  private dragWidth(
    view: EditorView,
    frame: HTMLElement,
    event: PointerEvent,
    index: number,
    table: HTMLElement,
  ): void {
    event.preventDefault();
    const cell = table.querySelectorAll("tr")[0]?.children[index];
    if (!(cell instanceof HTMLElement)) return;

    const startX = event.clientX;
    const startWidth = cell.getBoundingClientRect().width;
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement)
      handle.setPointerCapture(event.pointerId);

    // Typed as the DOM types them, and narrowed inside: `addEventListener`
    // takes an `EventListener`, and TypeScript will not accept a handler that
    // has quietly promised itself a `PointerEvent`.
    const preview = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      // Shown while dragging without touching the document, so the author can
      // see where they are putting the edge.
      cell.style.width = `${Math.max(8, startWidth + moved.clientX - startX)}px`;
    };

    const finish = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      handle?.removeEventListener("pointermove", preview);
      handle?.removeEventListener("pointerup", finish);
      cell.style.width = "";

      const zoom = this.zoomOf(table);
      const pixels = Math.max(8, startWidth + moved.clientX - startX) / zoom;
      const cm = Math.min(
        WIDEST_CM,
        Math.max(NARROWEST_CM, pixels / PX_PER_CM),
      );
      this.change(view, frame, (grid) =>
        setColumnWidth(grid, index, `${cm.toFixed(1)}cm`),
      );
    };

    handle?.addEventListener("pointermove", preview);
    handle?.addEventListener("pointerup", finish);
  }

  /**
   * Drag a row's edge, and write the extra room it lands on.
   *
   * As `\[2ex]`, which is LaTeX's own way of asking for more space after a
   * row — there is no per-row height in a `tabular`, and inventing one with a
   * strut would be writing something the author did not ask for and would not
   * recognise.
   *
   * Dragged *up* past the row's own height, the extra goes away entirely
   * rather than going negative: negative space in LaTeX is legal and almost
   * never meant.
   */
  private dragHeight(
    view: EditorView,
    frame: HTMLElement,
    event: PointerEvent,
    index: number,
  ): void {
    event.preventDefault();
    const startY = event.clientY;
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement)
      handle.setPointerCapture(event.pointerId);

    const finish = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      handle?.removeEventListener("pointerup", finish);

      const zoom = this.zoomOf(frame);
      const grown = (moved.clientY - startY) / zoom;
      // An ex is about half a line, which is the unit LaTeX uses for exactly
      // this and the one an author would have typed.
      const ex = Math.round((grown / (PX_PER_CM / 2.54 / 2)) * 2) / 2;
      this.change(view, frame, (grid) =>
        setRowHeight(grid, index, ex > 0 ? `${ex}ex` : ""),
      );
    };

    handle?.addEventListener("pointerup", finish);
  }

  /**
   * How much the page is magnified.
   *
   * A drag is measured on screen and a width is written in centimetres, so the
   * zoom has to come out of the arithmetic — otherwise dragging an edge to the
   * same place at 200% writes half the width.
   */
  private zoomOf(element: HTMLElement): number {
    const editor = element.closest(".editor");
    if (!(editor instanceof HTMLElement)) return 1;
    const value = Number.parseFloat(
      getComputedStyle(editor).getPropertyValue("--yaz-zoom"),
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
}

/**
 * Move the caret from one cell to the next, the way a word processor does.
 *
 * Tab in a table means "next cell" everywhere else, and an author who has just
 * typed a heading expects it to. What it does *not* do is insert a tab
 * character, which is what an editor's Tab does and what LaTeX would ignore.
 *
 * The caret moves in the buffer rather than in a model of the table, because
 * there is no model of the table: the cells are ranges of the document, and
 * "the next cell" is the offset after the next `&` at brace depth zero.
 */
export function nextCell(
  text: string,
  bodyFrom: number,
  bodyTo: number,
  at: number,
  backwards: boolean,
): number | null {
  const boundaries = cellStarts(text, bodyFrom, bodyTo);
  if (boundaries.length === 0) return null;

  if (backwards) {
    // The last boundary strictly before the caret. Strictly, so that Shift-Tab
    // from the start of a cell goes to the previous one rather than staying.
    let found: number | null = null;
    for (const boundary of boundaries) {
      if (boundary < at) found = boundary;
      else break;
    }
    return found;
  }

  for (const boundary of boundaries) {
    if (boundary > at) return boundary;
  }
  return null;
}

/**
 * Where each cell's text begins, in document offsets.
 *
 * A cell begins after the `&` or the `\` that opened it, and after any
 * whitespace — landing the caret on the space in front of a word rather than
 * on the word is what makes Tab feel wrong.
 */
function cellStarts(text: string, bodyFrom: number, bodyTo: number): number[] {
  const starts: number[] = [];
  let depth = 0;

  const push = (at: number) => {
    let cursor = at;
    while (cursor < bodyTo && /[^\S\n]/.test(text[cursor] ?? "")) cursor += 1;
    starts.push(cursor);
  };

  push(bodyFrom);
  for (let index = bodyFrom; index < bodyTo; index += 1) {
    const character = text[index]!;
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        let cursor = index + 2;
        if (text[cursor] === "*") cursor += 1;
        if (text[cursor] === "[") {
          const close = text.indexOf("]", cursor);
          if (close !== -1 && close < bodyTo) cursor = close + 1;
        }
        // Past the line break too, so the caret lands in the row rather than
        // at the end of the one above it.
        while (cursor < bodyTo && /\s/.test(text[cursor] ?? "")) cursor += 1;
        starts.push(cursor);
        index = cursor - 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === "&" && depth === 0) push(index + 1);
  }

  // What follows the last `\` is the table's tail — a closing rule and some
  // whitespace — and not a cell. Tab into it would put the caret after the last
  // row, which reads as the table having one more cell than it has.
  return starts
    .filter((at) => at <= bodyTo)
    .filter(
      (at, index, all) =>
        index === 0 || text.slice(at, bodyTo).trim() !== "" || all.length === 1,
    )
    .sort((a, b) => a - b);
}

/**
 * Tab and Shift-Tab, when the caret is in a table.
 *
 * Returns `false` everywhere else, which is how a CodeMirror keymap says "not
 * mine" — so Tab keeps doing whatever it did before outside a table, including
 * in Vim mode and in a list.
 */
export function tableTabKeymap(): Extension {
  const move = (view: EditorView, backwards: boolean): boolean => {
    const caret = view.state.selection.main;
    if (!caret.empty) return false;

    const text = view.state.doc.toString();
    const table = tableAround(text, caret.head);
    if (!table) return false;

    const target = nextCell(
      text,
      table.bodyFrom,
      table.bodyTo,
      caret.head,
      backwards,
    );
    if (target === null) return false;

    view.dispatch({
      selection: EditorSelection.cursor(target),
      scrollIntoView: true,
    });
    return true;
  };

  return keymap.of([
    { key: "Tab", run: (view) => move(view, false) },
    { key: "Shift-Tab", run: (view) => move(view, true) },
  ]);
}

/**
 * The table the caret is inside, if it is inside one.
 *
 * Found by looking backwards for a `\begin{tabular}` that has not been closed,
 * rather than by scanning every table in the document: this runs on a key
 * press, and the answer is nearly always "no table" after a few hundred
 * characters.
 */
function tableAround(
  text: string,
  at: number,
): { bodyFrom: number; bodyTo: number } | null {
  const opened = text.lastIndexOf("\begin{tabular", 0 + at);
  if (opened === -1) return null;
  const closed = text.indexOf("\\end{tabular", opened);
  if (closed === -1 || closed < at) return null;

  // Past `{tabular}`, any `[t]`, and the column specification.
  let cursor = text.indexOf("}", opened);
  if (cursor === -1) return null;
  cursor += 1;
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] === "[") {
    const close = text.indexOf("]", cursor);
    if (close === -1) return null;
    cursor = close + 1;
  }
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] !== "{") return null;
  let depth = 0;
  for (; cursor < closed; cursor += 1) {
    if (text[cursor] === "{") depth += 1;
    else if (text[cursor] === "}") {
      depth -= 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
  }

  if (at < cursor || at > closed) return null;
  return { bodyFrom: cursor, bodyTo: closed };
}

/**
 * Which cell of a table an offset falls in, as row and column.
 *
 * Counted the same way the cells are split, so that `\&` in a cell and a `&`
 * inside `\multicolumn{2}{c}{a & b}` are not mistaken for boundaries — a
 * highlight on the wrong cell is worse than none, because it says confidently
 * where the caret is not.
 */
export function cellAt(
  text: string,
  bodyFrom: number,
  bodyTo: number,
  at: number,
): { row: number; column: number } | null {
  if (at < bodyFrom || at > bodyTo) return null;

  let row = 0;
  let column = 0;
  let depth = 0;

  for (let index = bodyFrom; index < Math.min(at, bodyTo); index += 1) {
    const character = text[index]!;
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        row += 1;
        column = 0;
        index += 1;
        continue;
      }
      index += 1;
    } else if (character === "&" && depth === 0) {
      column += 1;
    }
  }

  return { row, column };
}
