/**
 * The pane layout: a tree of splits with tabs at the leaves.
 *
 * # Why a tree rather than a fixed two-column grid
 *
 * The shell started as editor-left, PDF-right, hard-coded. Every view added
 * after that — a rich-text mode, an outline, a diff — would have needed its own
 * slot and its own arrangement rule. A tree costs the same whether it holds two
 * panes or six, and "close the PDF and give the editor the whole window" stops
 * being a special case.
 *
 * # Everything here is a pure function
 *
 * Layout operations take a tree and return a new one, with no reference to the
 * DOM, to Svelte, or to what a tab actually renders. That is deliberate: the
 * fiddly parts of a docking layout are the tree edits — dropping a tab onto the
 * pane it already occupies, closing the last tab in a split, collapsing a split
 * with one child left — and those are exactly what is hard to check by clicking
 * around and easy to check here.
 *
 * @see {@link https://generalpawz.github.io/yaz/adr/0005-extensibility-tiers | ADR-0005}, which makes
 * pane layout a core responsibility rather than something a plugin owns.
 */

/** Identifies a view that can occupy a tab, e.g. `"editor"` or `"pdf"`. */
export type TabId = string;

/** A pane holding one or more tabs. */
export interface Leaf {
  kind: "leaf";
  /** Stable across edits, so the interface can address a pane. */
  id: string;
  tabs: TabId[];
  /** Which tab is showing. Always one of `tabs` while the leaf exists. */
  active: TabId;
}

/** A row or column of children. */
export interface Split {
  kind: "split";
  /** `row` places children side by side; `column` stacks them. */
  direction: "row" | "column";
  children: Node[];
  /** Fractions of the split's extent, parallel to `children`, summing to 1. */
  sizes: number[];
}

/** A node in the layout tree. */
export type Node = Leaf | Split;

/** Where a dropped tab should land relative to the pane it was dropped on. */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

let counter = 0;

/** A fresh pane id. */
export function paneId(): string {
  counter += 1;
  return `pane-${counter}`;
}

/** A single pane holding the given tabs. */
export function leaf(tabs: TabId[], active?: TabId): Leaf {
  return {
    kind: "leaf",
    id: paneId(),
    tabs: [...tabs],
    active: active ?? tabs[0] ?? "",
  };
}

/** The default arrangement: source on the left, PDF on the right. */
export function defaultLayout(): Node {
  return {
    kind: "split",
    direction: "row",
    children: [leaf(["editor"]), leaf(["pdf"])],
    sizes: [0.5, 0.5],
  };
}

/** Every leaf in the tree, in visual order. */
export function leaves(node: Node): Leaf[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leaves);
}

/** Every tab currently placed somewhere. */
export function openTabs(node: Node): TabId[] {
  return leaves(node).flatMap((pane) => pane.tabs);
}

/** Whether a tab is open anywhere. */
export function isOpen(node: Node, tab: TabId): boolean {
  return openTabs(node).includes(tab);
}

/** Replace a leaf, rebuilding only the spine above it. */
function mapNode(node: Node, change: (leaf: Leaf) => Node | null): Node | null {
  if (node.kind === "leaf") return change(node);

  const children: Node[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = mapNode(child, change);
    if (next) {
      children.push(next);
      sizes.push(node.sizes[index] ?? 1 / node.children.length);
    }
  });

  if (children.length === 0) return null;
  // A split with one child is not a split. Collapsing keeps the tree canonical,
  // so "did closing that tab leave an empty column" never becomes a rendering
  // question.
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: normalise(sizes) };
}

/** Scale fractions so they sum to 1. */
function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((size) => size / total);
}

/** Remove a tab from wherever it is, dropping panes that become empty. */
export function closeTab(node: Node, tab: TabId): Node | null {
  return mapNode(node, (pane) => {
    if (!pane.tabs.includes(tab)) return pane;
    const tabs = pane.tabs.filter((each) => each !== tab);
    if (tabs.length === 0) return null;
    return {
      ...pane,
      tabs,
      // Closing the visible tab should reveal a neighbour, not an empty pane.
      active: pane.active === tab ? (tabs[0] as TabId) : pane.active,
    };
  });
}

/** Show a tab that is already in some pane. */
export function focusTab(node: Node, tab: TabId): Node {
  return (
    mapNode(node, (pane) =>
      pane.tabs.includes(tab) ? { ...pane, active: tab } : pane,
    ) ?? node
  );
}

/** Add a tab to a pane, or focus it if the tree already holds it. */
export function openTab(node: Node, tab: TabId, targetPane?: string): Node {
  if (isOpen(node, tab)) return focusTab(node, tab);

  const target = targetPane ?? leaves(node)[0]?.id;
  const placed = mapNode(node, (pane) =>
    pane.id === target ? { ...pane, tabs: [...pane.tabs, tab], active: tab } : pane,
  );
  return placed ?? leaf([tab]);
}

/** Resize the split that owns `paneId`, at the boundary after `index`. */
export function resize(node: Node, splitPath: number[], sizes: number[]): Node {
  if (splitPath.length === 0) {
    if (node.kind !== "split") return node;
    return { ...node, sizes: normalise(sizes) };
  }
  if (node.kind !== "split") return node;
  const [head, ...rest] = splitPath;
  const children = node.children.map((child, index) =>
    index === head ? resize(child, rest, sizes) : child,
  );
  return { ...node, children };
}

/**
 * Move a tab onto a pane.
 *
 * `center` puts it in that pane's tab strip; an edge splits the pane and puts it
 * on that side.
 *
 * Two cases are easy to get wrong and are handled explicitly. Dropping a tab
 * onto the centre of the pane it already occupies must be a no-op rather than a
 * remove-then-add that loses the pane. And dropping the *only* tab of a pane
 * onto that same pane's edge would remove the pane and then try to split it, so
 * it is refused.
 */
export function moveTab(
  node: Node,
  tab: TabId,
  targetPaneId: string,
  zone: DropZone,
): Node {
  const source = leaves(node).find((pane) => pane.tabs.includes(tab));
  if (!source) return node;

  if (source.id === targetPaneId) {
    if (zone === "center") return focusTab(node, tab);
    // Splitting a pane off itself only makes sense when something stays behind.
    if (source.tabs.length === 1) return node;
  }

  const without = closeTab(node, tab);
  if (!without) return leaf([tab]);

  const dropped = mapNode(without, (pane) => {
    if (pane.id !== targetPaneId) return pane;
    if (zone === "center") {
      return { ...pane, tabs: [...pane.tabs, tab], active: tab };
    }

    const incoming = leaf([tab]);
    const direction = zone === "left" || zone === "right" ? "row" : "column";
    const before = zone === "left" || zone === "top";
    return {
      kind: "split",
      direction,
      children: before ? [incoming, pane] : [pane, incoming],
      sizes: [0.5, 0.5],
    };
  });

  // The target vanished — it was the source pane and closing emptied it. The
  // tab has nowhere to go but a pane of its own.
  return dropped ?? leaf([tab]);
}

/** Serialise for persistence. */
export function serialise(node: Node): string {
  return JSON.stringify(node);
}

/**
 * Parse a persisted layout, falling back to the default.
 *
 * Deliberately tolerant. A layout is a convenience, and a project whose stored
 * layout cannot be read should open with the standard arrangement rather than
 * refuse to open at all.
 */
export function deserialise(text: string | null | undefined): Node {
  if (!text) return defaultLayout();
  try {
    const parsed = JSON.parse(text) as unknown;
    return isNode(parsed) ? withFreshIds(parsed) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

/** Structural check, since this comes off disk and may be anything. */
function isNode(value: unknown): value is Node {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<Split> & Partial<Leaf>;
  if (node.kind === "leaf") {
    return Array.isArray(node.tabs) && node.tabs.every((t) => typeof t === "string");
  }
  if (node.kind === "split") {
    return (
      (node.direction === "row" || node.direction === "column") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(isNode)
    );
  }
  return false;
}

/** Re-key panes on load, so ids never collide with ones minted this session. */
function withFreshIds(node: Node): Node {
  if (node.kind === "leaf") {
    const tabs = [...node.tabs];
    return {
      kind: "leaf",
      id: paneId(),
      tabs,
      active: tabs.includes(node.active) ? node.active : (tabs[0] ?? ""),
    };
  }
  return {
    kind: "split",
    direction: node.direction,
    children: node.children.map(withFreshIds),
    sizes: normalise(
      node.children.map((_, index) => node.sizes?.[index] ?? 1 / node.children.length),
    ),
  };
}
