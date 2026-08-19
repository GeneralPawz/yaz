/**
 * The editor must survive being typed in.
 *
 * This is a regression test with a specific bug behind it. The effect that
 * created the CodeMirror view read the `doc` prop, and `doc` changes on every
 * keystroke because `onChange` feeds the text straight back in. So every
 * character destroyed and rebuilt the whole editor: focus was lost and the caret
 * jumped to the top of the file, and the document could only be written one
 * keystroke per mouse click.
 *
 * It shipped because the frontend `test` script echoed a sentence and CI called
 * that a pass.
 *
 * The assertions go through `onReady`, which the component calls with an API
 * when the view exists and with `null` when it goes away. That makes "was the
 * view rebuilt?" directly observable without depending on CodeMirror rendering
 * inside jsdom.
 */

import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorApi } from "@yaz/api";

import Editor from "./Editor.svelte";

beforeAll(() => {
  // CodeMirror measures its own layout; jsdom implements neither of these.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

/** Mount an editor and expose the handles the tests need. */
function mount(doc = "hello", docId = "a.tex") {
  const ready = vi.fn<(api: EditorApi | null) => void>();
  const onChange = vi.fn<(text: string) => void>();
  const component = render(Editor, {
    props: {
      doc,
      docId,
      vimMode: false,
      rich: false,
      numbering: "absolute" as const,
      pageView: false,
      page: { width: 210, height: 297 },
      zoom: 100,
      wrap: true,
      shortcuts: [],
      onChange,
      onSave: () => {},
      onReady: ready,
    },
  });
  return { component, ready, onChange };
}

/** The most recent non-null API handed to `onReady`. */
function currentApi(ready: ReturnType<typeof vi.fn>): EditorApi {
  const handed = ready.mock.calls.map((call) => call[0]).filter(Boolean);
  expect(handed.length).toBeGreaterThan(0);
  return handed[handed.length - 1] as EditorApi;
}

describe("Editor", () => {
  it("creates its view once", async () => {
    const { ready } = mount();
    await tick();
    const created = ready.mock.calls.filter((call) => call[0] !== null).length;
    expect(created).toBe(1);
  });

  it("does not rebuild the view when the document text changes", async () => {
    // The bug: this is what every keystroke looks like from the outside.
    const { component, ready } = mount("hello");
    await tick();
    const before = ready.mock.calls.length;

    await component.rerender({ doc: "hello w" });
    await tick();
    await component.rerender({ doc: "hello wo" });
    await tick();

    expect(
      ready.mock.calls.length,
      "the view was torn down and rebuilt while typing, which loses focus and the caret",
    ).toBe(before);
  });

  it("keeps the caret where the typist left it", async () => {
    const { component, ready } = mount("hello");
    await tick();
    const api = currentApi(ready);

    api.insertAtCursor("!");
    // The rebuild reset the selection to offset 0; without it the caret stays
    // after what was just inserted.
    const afterInsert = api.getSelection();
    expect(afterInsert.from).toBeGreaterThan(0);

    await component.rerender({ doc: api.getText() });
    await tick();

    expect(
      api.getSelection().from,
      "a prop update moved the caret, so typing would jump to the top of the file",
    ).toBe(afterInsert.from);
  });

  it("replaces the document when a different file is opened", async () => {
    // The other half of the contract: reacting to `doc` alone would fight the
    // typist, but a genuine file switch must still swap the buffer.
    const { component, ready } = mount("first file", "a.tex");
    await tick();
    expect(currentApi(ready).getText()).toBe("first file");

    await component.rerender({ doc: "second file", docId: "b.tex" });
    await tick();

    expect(currentApi(ready).getText()).toBe("second file");
  });

  it("reports edits to its owner", async () => {
    const { ready, onChange } = mount("x");
    await tick();
    currentApi(ready).insertAtCursor("y");
    expect(onChange).toHaveBeenCalled();
  });
});

describe("rich text", () => {
  it("reports the mode from the editor rather than from a prop", async () => {
    const { component, ready } = mount("hello");
    await tick();
    const api = currentApi(ready);
    expect(api.getMode()).toBe("source");

    await component.rerender({ rich: true });
    await tick();
    expect(api.getMode()).toBe("visual");
  });

  it("does not rebuild the view when the view mode changes", async () => {
    // Rebuilding would lose the caret and the undo history — the same failure
    // the document-change path already had.
    const { component, ready } = mount("hello");
    await tick();
    const before = ready.mock.calls.length;

    await component.rerender({ rich: true });
    await tick();
    await component.rerender({ rich: false });
    await tick();

    expect(ready.mock.calls.length).toBe(before);
  });

  it("edits the LaTeX source, because there is only one document", async () => {
    // ADR-0004: rich text is decorations over the buffer, not a second model.
    // So what comes back out is the raw source, markup and all.
    const source = String.raw`\section{Title}` + "\n\nBody.";
    const { component, ready } = mount(source, "a.tex");
    await tick();
    await component.rerender({ rich: true });
    await tick();

    const api = currentApi(ready);
    expect(api.getText()).toBe(source);

    api.revealRange(0, 0);
    api.insertAtCursor(String.raw`\emph{new} `);
    expect(api.getText()).toContain(String.raw`\emph{new}`);
    // And the file the compiler sees is still LaTeX.
    expect(api.getText()).toContain(String.raw`\section{Title}`);
  });

  it("can select a range for navigation", async () => {
    const source = String.raw`\section{Findings}` + "\nprose";
    const { ready } = mount(source, "a.tex");
    await tick();
    const api = currentApi(ready);

    // The offsets the outline hands over address the raw source.
    api.revealRange(9, 17);
    const selection = api.getSelection();
    expect(source.slice(selection.from, selection.to)).toBe("Findings");
  });
});
