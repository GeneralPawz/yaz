/**
 * Long lines coming back round.
 *
 * A pasted URL or a long sentence otherwise runs off to the right and takes
 * the rest of the document with it: the horizontal scrollbar appears, every
 * other line becomes shorter than the pane, and reading means scrolling
 * sideways and back for one line in fifty.
 *
 * CodeMirror signals wrapping by putting `cm-lineWrapping` on the content
 * element, which is what these check — jsdom does no layout, so whether text
 * *visually* wraps is not a question that can be asked here. What can be asked
 * is whether the extension is in force, and whether switching it reconfigures
 * the view rather than rebuilding it.
 */

import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorApi } from "@yaz/api";

import Editor from "../Editor.svelte";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

function mount(wrap: boolean) {
  const ready = vi.fn<(api: EditorApi | null) => void>();
  const component = render(Editor, {
    props: {
      doc: "a very long line that would otherwise run off the side forever",
      docId: "a.tex",
      vimMode: false,
      rich: false,
      numbering: "absolute" as const,
      pageView: false,
      page: { width: 210, height: 297 },
      zoom: 100,
      wrap,
      shortcuts: [],
      onChange: () => {},
      onSave: () => {},
      onReady: ready,
    },
  });
  return { component, ready };
}

/** Whether the view is wrapping, as CodeMirror marks it. */
function wrapping(container: HTMLElement): boolean {
  return Boolean(
    container
      .querySelector(".cm-content")
      ?.classList.contains("cm-lineWrapping"),
  );
}

describe("wrapping", () => {
  it("is on by default", () => {
    const { component } = mount(true);
    expect(wrapping(component.container)).toBe(true);
  });

  it("can be switched off", () => {
    // A real preference, not an oversight: someone lining up a table by hand
    // wants to see where a line actually ends.
    const { component } = mount(false);
    expect(wrapping(component.container)).toBe(false);
  });

  it("switches without rebuilding the editor", async () => {
    // The same failure class as the keystroke bug: rebuilding the view to
    // change a setting takes the caret and the undo history with it.
    const { component, ready } = mount(false);
    const created = ready.mock.calls.filter((call) => call[0]).length;

    await component.rerender({ wrap: true });
    await tick();

    expect(wrapping(component.container)).toBe(true);
    expect(ready.mock.calls.filter((call) => call[0])).toHaveLength(created);
  });
});
