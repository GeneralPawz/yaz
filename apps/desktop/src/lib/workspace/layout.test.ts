/**
 * Layout tree edits.
 *
 * These are the parts of a docking layout that are fiddly rather than hard:
 * dropping a tab onto the pane it already occupies, closing the last tab in a
 * split, collapsing a split that has one child left. Each is a one-line mistake
 * that produces an empty pane or a lost view, and each is tedious to find by
 * dragging things around in a running application.
 */

import { describe, expect, it } from "vitest";

import {
  closeTab,
  defaultLayout,
  deserialise,
  isOpen,
  leaf,
  leaves,
  moveTab,
  openTab,
  openTabs,
  serialise,
  type Node,
} from "./layout";

/** A row of two panes: [editor] | [pdf]. */
function sideBySide(): Node {
  return defaultLayout();
}

describe("layout", () => {
  it("starts with the editor and the PDF side by side", () => {
    const layout = sideBySide();
    expect(leaves(layout)).toHaveLength(2);
    expect(openTabs(layout)).toEqual(["editor", "pdf"]);
  });

  it("collapses a split when a pane loses its last tab", () => {
    const layout = closeTab(sideBySide(), "pdf");
    expect(layout).not.toBeNull();
    // Not "a split with one child" — that would render as a column with an
    // empty half, which is the visible form of this bug.
    expect(layout!.kind).toBe("leaf");
    expect(openTabs(layout!)).toEqual(["editor"]);
  });

  it("returns null only when the very last tab is closed", () => {
    const one = leaf(["editor"]);
    expect(closeTab(one, "editor")).toBeNull();
  });

  it("reveals a neighbour when the visible tab is closed", () => {
    const pane = leaf(["editor", "pdf"], "pdf");
    const after = closeTab(pane, "pdf") as Node;
    expect(after.kind).toBe("leaf");
    expect((after as { active: string }).active).toBe("editor");
  });

  it("moves a tab into another pane", () => {
    const layout = sideBySide();
    const [, right] = leaves(layout);
    const after = moveTab(layout, "editor", right!.id, "center");

    // Both tabs now live in one pane, and the emptied split collapsed.
    expect(leaves(after)).toHaveLength(1);
    expect(openTabs(after).sort()).toEqual(["editor", "pdf"]);
  });

  it("splits when a tab is dropped on an edge", () => {
    const single = leaf(["editor", "pdf"], "editor");
    const after = moveTab(single, "pdf", single.id, "bottom");

    expect(after.kind).toBe("split");
    const split = after as Extract<Node, { kind: "split" }>;
    expect(split.direction).toBe("column");
    expect(leaves(after)).toHaveLength(2);
    // Dropped on the bottom edge, so it goes second.
    expect(leaves(after)[1]!.tabs).toEqual(["pdf"]);
  });

  it("puts the tab first when dropped on a leading edge", () => {
    const single = leaf(["editor", "pdf"], "editor");
    const after = moveTab(single, "pdf", single.id, "left");
    const split = after as Extract<Node, { kind: "split" }>;
    expect(split.direction).toBe("row");
    expect(leaves(after)[0]!.tabs).toEqual(["pdf"]);
  });

  it("does nothing when a tab is dropped on the centre of its own pane", () => {
    // The naive implementation removes then re-adds, and loses the pane when
    // that was its only tab.
    const single = leaf(["editor"]);
    const after = moveTab(single, "editor", single.id, "center");
    expect(leaves(after)).toHaveLength(1);
    expect(openTabs(after)).toEqual(["editor"]);
  });

  it("refuses to split a pane off itself when nothing would stay behind", () => {
    // Removing the only tab destroys the pane, so there is nothing left to
    // split against — the tab would end up in a pane split from nothing.
    const single = leaf(["editor"]);
    const after = moveTab(single, "editor", single.id, "right");
    expect(after.kind).toBe("leaf");
    expect(openTabs(after)).toEqual(["editor"]);
  });

  it("keeps a moved tab when its source pane disappears", () => {
    const layout = sideBySide();
    const [left, right] = leaves(layout);
    // Moving the editor empties the left pane, which collapses the split.
    const after = moveTab(layout, "editor", right!.id, "center");
    expect(openTabs(after)).toContain("editor");
    expect(leaves(after).some((pane) => pane.id === left!.id)).toBe(false);
  });

  it("reopens a closed tab rather than duplicating an open one", () => {
    const closed = closeTab(sideBySide(), "pdf") as Node;
    expect(isOpen(closed, "pdf")).toBe(false);

    const reopened = openTab(closed, "pdf");
    expect(openTabs(reopened)).toContain("pdf");

    const again = openTab(reopened, "pdf");
    expect(openTabs(again).filter((tab) => tab === "pdf")).toHaveLength(1);
  });

  it("survives a round trip through storage", () => {
    const layout = moveTab(
      sideBySide(),
      "editor",
      leaves(sideBySide())[1]!.id,
      "center",
    );
    const restored = deserialise(serialise(layout));
    expect(openTabs(restored).sort()).toEqual(openTabs(layout).sort());
    expect(leaves(restored)).toHaveLength(leaves(layout).length);
  });

  it("falls back to the default layout rather than refusing to open", () => {
    // A layout is a convenience. A project whose stored layout is unreadable
    // must still open.
    for (const bad of [
      null,
      undefined,
      "",
      "not json",
      "{}",
      '{"kind":"split"}',
      "[]",
    ]) {
      const restored = deserialise(bad as string | null);
      expect(openTabs(restored)).toEqual(["editor", "pdf"]);
    }
  });

  it("gives restored panes fresh ids", () => {
    // Ids minted this session must never collide with ones read off disk, or a
    // drop targets the wrong pane.
    const layout = sideBySide();
    const restored = deserialise(serialise(layout));
    const before = leaves(layout).map((pane) => pane.id);
    const after = leaves(restored).map((pane) => pane.id);
    expect(after.some((id) => before.includes(id))).toBe(false);
  });

  it("keeps split sizes summing to one after a pane is removed", () => {
    const three: Node = {
      kind: "split",
      direction: "row",
      children: [leaf(["editor"]), leaf(["pdf"]), leaf(["outline"])],
      sizes: [0.2, 0.3, 0.5],
    };
    const after = closeTab(three, "pdf") as Extract<Node, { kind: "split" }>;
    expect(after.kind).toBe("split");
    const total = after.sizes.reduce((sum, size) => sum + size, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(after.sizes).toHaveLength(2);
  });
});
