<!--
  One node of the layout tree: either a split, which renders its children and a
  draggable divider between them, or a pane, which renders a tab strip and the
  active tab's content.

  Recursive by importing itself. The alternative — flattening the tree into rows
  and columns in the parent — puts the tree structure in two places and they
  drift.

  Drop targeting lives here because it needs the pane's own geometry: which zone
  a drop lands in is a question about where the pointer is inside *this*
  rectangle, and the answer is different for every pane on screen.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../i18n";
  // Imports itself: this renders a tree, and the alternative is flattening the
  // tree in the parent, which puts the structure in two places.
  import Pane from "./Pane.svelte";
  import type { DropZone, Node, TabId } from "./layout";

  interface Props {
    node: Node;
    /** Display name per tab id. Titles are data (a filename), not message keys. */
    titles: Record<TabId, string>;
    /** Path of child indices from the root, for addressing splits when resizing. */
    path?: number[];
    content: Snippet<[TabId]>;
    onmove: (tab: TabId, targetPane: string, zone: DropZone) => void;
    onfocus: (tab: TabId) => void;
    onclose: (tab: TabId) => void;
    onresize: (path: number[], sizes: number[]) => void;
  }

  let {
    node,
    titles,
    path = [],
    content,
    onmove,
    onfocus,
    onclose,
    onresize,
  }: Props = $props();

  /** The pane the pointer is over, and where in it, while a drag is in flight. */
  let hovering = $state<DropZone | null>(null);
  let body = $state<HTMLElement | null>(null);
  /** True while a drag is over the tab strip rather than the pane body. */
  let overTabs = $state(false);
  let container = $state<HTMLElement | null>(null);

  /**
   * Which zone a pointer position falls in.
   *
   * The edge bands are a quarter of each dimension, so the centre stays the
   * easiest target — moving a tab into a pane is the common action and
   * splitting is the deliberate one.
   */
  function zoneAt(event: DragEvent, element: HTMLElement): DropZone {
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    // Compare against the nearest edge, so corners resolve to whichever edge
    // the pointer is actually closest to rather than to a fixed precedence.
    const distances: [DropZone, number][] = [
      ["left", x],
      ["right", 1 - x],
      ["top", y],
      ["bottom", 1 - y],
    ];
    const [zone, distance] = distances.reduce((best, each) =>
      each[1] < best[1] ? each : best,
    );
    return distance < 0.25 ? zone : "center";
  }

  function ondragover(event: DragEvent) {
    if (node.kind !== "leaf" || !body) return;
    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    hovering = zoneAt(event, body);
  }

  function ondrop(event: DragEvent) {
    if (node.kind !== "leaf" || !body) return;
    event.preventDefault();
    const tab = event.dataTransfer?.getData("application/x-yaz-tab");
    const zone = zoneAt(event, body);
    hovering = null;
    if (tab) onmove(tab, node.id, zone);
  }

  /** Drag a divider, converting pointer movement into new fractions. */
  function startResize(event: PointerEvent, index: number) {
    if (node.kind !== "split" || !container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const horizontal = node.direction === "row";
    const total = horizontal ? rect.width : rect.height;
    const origin = horizontal ? rect.left : rect.top;
    const sizes = [...node.sizes];

    // Only the two panes either side of this divider move; the rest keep their
    // share, which is what makes dragging one divider feel local.
    const before = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
    const pair = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);

    const move = (moveEvent: PointerEvent) => {
      const position = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - origin) / total;
      // A pane narrower than this cannot show anything useful, and a pane of
      // zero width cannot be dragged back open.
      const minimum = 0.08;
      const first = Math.min(Math.max(position - before, minimum), pair - minimum);
      sizes[index] = first;
      sizes[index + 1] = pair - first;
      onresize(path, [...sizes]);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

{#if node.kind === "split"}
  <div
    class="split {node.direction}"
    bind:this={container}
    style:--tracks={node.sizes.map((size) => `${size}fr`).join(" 1px ")}
  >
    {#each node.children as child, index (child.kind === "leaf" ? child.id : index)}
      {#if index > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="divider"
          role="separator"
          aria-orientation={node.direction === "row" ? "vertical" : "horizontal"}
          onpointerdown={(event) => startResize(event, index - 1)}
        ></div>
      {/if}
      <Pane
        node={child}
        {titles}
        path={[...path, index]}
        {content}
        {onmove}
        {onfocus}
        {onclose}
        {onresize}
      />
    {/each}
  </div>
{:else}
  <section class="pane">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tabs"
      class:dropping={hovering === "center" && overTabs}
      role="tablist"
      tabindex="-1"
      ondragover={(event) => {
        // Dropping onto another pane's tab strip is the natural way to say
        // "put it in that pane", and was previously inert: only the pane body
        // accepted drops, so aiming at the tabs did nothing at all.
        event.preventDefault();
        event.stopPropagation();
        overTabs = true;
        hovering = "center";
      }}
      ondragleave={() => {
        overTabs = false;
        hovering = null;
      }}
      ondrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const tab = event.dataTransfer?.getData("application/x-yaz-tab");
        overTabs = false;
        hovering = null;
        if (tab && node.kind === "leaf") onmove(tab, node.id, "center");
      }}
    >
      {#each node.tabs as tab (tab)}
        <div
          class="tab"
          class:active={tab === node.active}
          draggable="true"
          role="tab"
          tabindex={tab === node.active ? 0 : -1}
          aria-selected={tab === node.active}
          ondragstart={(event) => {
            event.dataTransfer?.setData("application/x-yaz-tab", tab);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          }}
          onclick={() => onfocus(tab)}
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") onfocus(tab);
          }}
        >
          <span class="label">{titles[tab] ?? tab}</span>
          <button
            type="button"
            class="close"
            aria-label={t("workspace-close-tab")}
            onclick={(event) => {
              event.stopPropagation();
              onclose(tab);
            }}
          >
            <svg viewBox="0 0 8 8" aria-hidden="true"><path d="M0 0l8 8M8 0L0 8" /></svg>
          </button>
        </div>
      {/each}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="body"
      bind:this={body}
      {ondragover}
      {ondrop}
      ondragleave={() => (hovering = null)}
    >
      {@render content(node.active)}

      {#if hovering && !overTabs}
        <div class="drop {hovering}" aria-hidden="true"></div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .split {
    display: grid;
    min-inline-size: 0;
    min-block-size: 0;
    flex: 1;
  }

  /* The dividers are grid tracks too, hence the explicit template built from
     the child fractions with a fixed track between each. */
  .split.row {
    grid-auto-flow: column;
    grid-template-columns: var(--tracks);
  }

  .split.column {
    grid-auto-flow: row;
    grid-template-rows: var(--tracks);
  }

  .divider {
    background: var(--yaz-border);
    /* Bigger than it looks: a one-pixel target is not draggable. */
    position: relative;
    z-index: 1;
  }

  .split.row > .divider {
    inline-size: 1px;
    cursor: col-resize;
    box-shadow: 0 0 0 2px transparent;
  }

  .split.column > .divider {
    block-size: 1px;
    cursor: row-resize;
  }

  .divider:hover {
    background: var(--yaz-accent);
  }

  .pane {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    min-block-size: 0;
    overflow: hidden;
    background: var(--yaz-bg-primary);
  }

  .tabs.dropping {
    background: var(--yaz-bg-selection);
    box-shadow: inset 0 0 0 1px var(--yaz-accent);
  }

  .tabs {
    display: flex;
    align-items: stretch;
    gap: 1px;
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-3) var(--yaz-space-2);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-block-end: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--yaz-bg-hover);
  }

  .tab.active {
    color: var(--yaz-text-primary);
    border-block-end-color: var(--yaz-accent);
    background: var(--yaz-bg-primary);
  }

  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1rem;
    block-size: 1rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    color: var(--yaz-text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--yaz-bg-active);
    color: var(--yaz-text-primary);
  }

  .close svg {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .body {
    position: relative;
    flex: 1;
    min-block-size: 0;
    overflow: hidden;
  }

  /* Where the tab will land if dropped now. Shown over the pane rather than as
     an outline, so it reads as "this area" rather than "this border". */
  .drop {
    position: absolute;
    background: var(--yaz-bg-selection);
    border: 1px solid var(--yaz-accent);
    pointer-events: none;
  }

  .drop.center {
    inset: 0;
  }

  .drop.left {
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: 50%;
  }

  .drop.right {
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 50%;
  }

  .drop.top {
    inset-inline: 0;
    inset-block-start: 0;
    block-size: 50%;
  }

  .drop.bottom {
    inset-inline: 0;
    inset-block-end: 0;
    block-size: 50%;
  }
</style>
