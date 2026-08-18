/**
 * The line-number gutter.
 *
 * The relative mode is the one worth testing, and it has a specific trap
 * behind it: CodeMirror's built-in gutter re-renders only when its own
 * configuration changes, not when the selection moves. Written the obvious way
 * — a `formatNumber` that reads the cursor — relative numbers are correct once
 * and then silently frozen. So the test that matters is the one that moves the
 * cursor and reads the gutter again.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { lineNumbering } from "./lineNumbers";
import type { LineNumbering } from "./lineNumbers";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

const doc = ["one", "two", "three", "four", "five"].join("\n");

function mount(mode: LineNumbering): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [lineNumbering(mode)] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

/**
 * The numbers currently drawn in the gutter.
 *
 * The first element is CodeMirror's width spacer — a hidden element holding
 * the widest number the gutter can show, so it does not change width as you
 * scroll. It is not on the page, so it is not a number the reader sees.
 */
function gutterNumbers(view: EditorView): string[] {
  const gutter = view.dom.querySelector(".cm-lineNumbers");
  if (!gutter) return [];
  return [...gutter.querySelectorAll<HTMLElement>(".cm-gutterElement")]
    .filter((element) => element.style.visibility !== "hidden")
    .map((element) => element.textContent ?? "")
    .filter((text) => text !== "");
}

/** Put the cursor on a line, counting from one. */
function caretOnLine(view: EditorView, line: number): void {
  view.dispatch({
    selection: EditorSelection.cursor(view.state.doc.line(line).from),
  });
}

describe("line numbering", () => {
  it("draws no gutter when it is off", () => {
    expect(mount("off").dom.querySelector(".cm-lineNumbers")).toBeNull();
  });

  it("counts from one when it is absolute", () => {
    expect(gutterNumbers(mount("absolute"))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("counts distance from the cursor when it is relative", () => {
    const view = mount("relative");
    caretOnLine(view, 3);
    // The cursor's own line keeps its absolute number — Vim's hybrid form.
    // Without it there is no way to answer "which line is the error on?".
    expect(gutterNumbers(view)).toEqual(["2", "1", "3", "1", "2"]);
  });

  it("follows the cursor", () => {
    // The trap this whole gutter exists for. A `formatNumber` on the built-in
    // gutter passes the test above and fails this one.
    const view = mount("relative");
    caretOnLine(view, 1);
    expect(gutterNumbers(view)).toEqual(["1", "1", "2", "3", "4"]);

    caretOnLine(view, 5);
    expect(gutterNumbers(view)).toEqual(["4", "3", "2", "1", "5"]);
  });
});
