<!--
  The application menu, which is also the window's title bar.

  A normal desktop menu bar rather than a row of buttons: it is where people
  already look for "open", it keeps the toolbar from growing a button per
  feature, and it gives plugin commands somewhere to live that is not the
  toolbar. Plugin-contributed commands appear under Tools, which is how a plugin
  gets into the menu without the shell knowing anything about it.

  Most entries are stubs today and say so when used. They are present rather than
  hidden because an empty File menu tells a user nothing, while a greyed-out
  "Find…" tells them it is coming.
-->
<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t } from "./i18n";

  /** One entry in a menu. */
  export interface MenuItem {
    /** Message key for the label. */
    labelKey: string;
    action?: (() => void | Promise<void>) | undefined;
    /** Shown but not selectable. */
    disabled?: boolean | undefined;
    /** Rendered with a tick when true. */
    checked?: boolean | undefined;
    /** Draw a separator above this entry. */
    separatorBefore?: boolean | undefined;
    /**
     * Nested entries, shown as a flyout.
     *
     * One level only. A second level of nesting is where menus stop being
     * navigable with a mouse, and nothing here needs it.
     */
    items?: MenuItem[] | undefined;
    /** A coloured dot before the label, for connection state. */
    dot?: "live" | "degraded" | "off" | "unknown" | undefined;
    /**
     * Which glyph to draw beside the label.
     *
     * A name from {@link ICONS} rather than an image or a character: a menu is
     * scanned before it is read, and the icon is what the eye lands on. Naming
     * them means one drawing per idea — the same mark for "open" wherever
     * opening happens — instead of each menu inventing its own.
     */
    icon?: IconName | undefined;
    /**
     * Treat `labelKey` as literal text rather than a message key.
     *
     * For entries whose text is data — a folder name in the recent list. There
     * is no catalogue that could contain it, and translating a folder name
     * would be wrong even if there were.
     */
    literalLabel?: boolean | undefined;
    /** Shown on hover, e.g. the full path behind a folder name. */
    tooltip?: string | undefined;
  }

  /** One top-level menu. */
  export interface Menu {
    labelKey: string;
    items: MenuItem[];
  }

  /**
   * The icons a menu entry can carry.
   *
   * Written out rather than derived from the drawings below, because a type
   * exported from a component is lifted out of the instance script and cannot
   * see a value declared in it. `ICONS` is typed against this instead, so a
   * name without a drawing is still a compile error — the check runs the other
   * way round, not not at all.
   */
  export type IconName =
    | "folder"
    | "clock"
    | "save"
    | "play"
    | "close"
    | "undo"
    | "redo"
    | "search"
    | "settings"
    | "text"
    | "list"
    | "layout"
    | "numbers"
    | "plug"
    | "wrench"
    | "book"
    | "bug"
    | "info"
    | "branch";

  /**
   * The drawings, as SVG path data on a 16-unit grid.
   *
   * Inline paths rather than an icon font: a font is a network request, a
   * licence and a flash of missing glyphs, for a dozen shapes that between them
   * are smaller than the request would have been.
   */
  const ICONS: Record<IconName, string> = {
    folder: "M2 4.5h4l1.2 1.5H14v6.5H2z",
    clock: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2.2 1.3",
    save: "M3 3h7.5L13 5.5V13H3zM5.5 3v3.5h5V3M5.5 13V9h5v4",
    play: "M5 3.5l7 4.5-7 4.5z",
    close: "M4 4l8 8M12 4l-8 8",
    undo: "M6 5.5H10a3 3 0 010 6H6M6 5.5L8.5 3M6 5.5L8.5 8",
    redo: "M10 5.5H6a3 3 0 000 6h4M10 5.5L7.5 3M10 5.5L7.5 8",
    search: "M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5L14 14",
    settings:
      "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5l1 1.8 2-.5.4 2 1.8 1-1 1.7 1 1.7-1.8 1-.4 2-2-.5-1 1.8-1-1.8-2 .5-.4-2-1.8-1 1-1.7-1-1.7 1.8-1 .4-2 2 .5z",
    text: "M3 4h10M3 8h10M3 12h6",
    list: "M6 4h8M6 8h8M6 12h8M3 4h.01M3 8h.01M3 12h.01",
    layout: "M2.5 3h11v10h-11zM6.5 3v10M6.5 8h7",
    numbers: "M3 4h1v4M3 8h2M9 4h4M9 8h4M9 12h4M3 11h2v3H3z",
    plug: "M6 2v4M10 2v4M4.5 6h7v2.5a3.5 3.5 0 01-7 0zM8 12v2",
    wrench: "M11 2.5a3 3 0 00-3.9 3.9L2.5 11l2.5 2.5 4.6-4.6A3 3 0 0011 2.5z",
    book: "M3 3h4.5a1.5 1.5 0 011.5 1.5V13a1.5 1.5 0 00-1.5-1.5H3zM13 3H8.5A1.5 1.5 0 007 4.5V13a1.5 1.5 0 011.5-1.5H13z",
    bug: "M5 6a3 3 0 016 0v3a3 3 0 01-6 0zM5 7H2.5M11 7h2.5M5 10H3M11 10h2M6 4L4.5 2.5M10 4l1.5-1.5",
    info: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 7v4M8 5h.01",
    branch: "M5 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 6.5v3M11 6.5c0 2-2 3-6 3",
  };

  interface Props {
    menus: Menu[];
    /** Shown in the middle of the bar, where a title bar puts it. */
    title: string;
  }

  let { menus, title }: Props = $props();

  /**
   * The window is undecorated, so this row *is* the title bar.
   *
   * Which means it owes the user everything the system bar was providing:
   * dragging, double-click to maximise, and the three buttons. Taking the
   * decorations away without putting those back would be a straight downgrade.
   */
  const appWindow = getCurrentWindow();
  let maximized = $state(false);

  async function syncMaximized() {
    try {
      maximized = await appWindow.isMaximized();
    } catch {
      // Not running under Tauri — a browser preview, or a test.
    }
  }

  $effect(() => {
    void syncMaximized();
    const unlisten = appWindow.onResized(() => void syncMaximized());
    return () => {
      void unlisten.then((off) => off());
    };
  });

  /** Index of the open menu, or null. */
  let open = $state<number | null>(null);
  let bar = $state<HTMLElement | null>(null);

  /**
   * Once a menu is open, hovering another opens it — the standard behaviour,
   * and its absence is the thing that makes a hand-rolled menu bar feel wrong.
   */
  function hover(index: number) {
    if (open !== null) {
      open = index;
      openSub = null;
    }
  }

  /** Which submenu is showing, keyed by its label. */
  let openSub = $state<string | null>(null);

  function choose(item: MenuItem) {
    // A parent opens its flyout rather than doing something itself.
    if (item.items?.length) {
      openSub = openSub === item.labelKey ? null : item.labelKey;
      return;
    }
    open = null;
    openSub = null;
    if (!item.disabled) void item.action?.();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") open = null;
  }

  // Closing on any click elsewhere, including inside the webview's own chrome.
  $effect(() => {
    if (open === null) return;
    const close = (event: MouseEvent) => {
      if (bar && !bar.contains(event.target as Node)) open = null;
    };
    // Capture phase: a click on a button that stops propagation would otherwise
    // leave the menu open over the thing it just triggered.
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  });
</script>

<!--
  One icon slot per entry, drawn or empty.

  Always rendered, even with nothing in it: an entry without an icon still has
  to line its label up with the ones that have, or a menu where half the items
  carry a mark reads as two ragged columns.
-->
{#snippet icon(name: IconName | undefined)}
  <span class="icon" aria-hidden="true">
    {#if name}
      <svg viewBox="0 0 16 16">
        <path d={ICONS[name]} />
      </svg>
    {/if}
  </span>
{/snippet}

<svelte:window on:keydown={onkeydown} />

<nav class="bar" bind:this={bar} aria-label={t("app-name")} data-tauri-drag-region>
  <!-- The wordmark, not an image: it is one character, and a file would be a
       request, a cache entry and an asset to theme for the sake of a glyph. -->
  <span class="mark" aria-hidden="true">y</span>

  {#each menus as menu, index (menu.labelKey)}
    <div class="menu">
      <button
        type="button"
        class="title"
        class:open={open === index}
        aria-haspopup="menu"
        aria-expanded={open === index}
        onclick={() => {
          open = open === index ? null : index;
          openSub = null;
        }}
        onmouseenter={() => hover(index)}
      >
        {t(menu.labelKey)}
      </button>

      {#if open === index}
        <div class="dropdown" role="menu">
          {#each menu.items as item (item.labelKey)}
            {#if item.separatorBefore}
              <div class="separator" role="separator"></div>
            {/if}
            <div class="entry">
              <button
                type="button"
                class="item"
                role="menuitem"
                aria-haspopup={item.items?.length ? "menu" : undefined}
                aria-expanded={item.items?.length ? openSub === item.labelKey : undefined}
                disabled={item.disabled}
                onclick={() => choose(item)}
                onmouseenter={() => {
                  if (item.items?.length) openSub = item.labelKey;
                  else openSub = null;
                }}
              >
                <span class="tick" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                {#if item.dot}
                  <span class="dot {item.dot}" aria-hidden="true"></span>
                {:else}
                  {@render icon(item.icon)}
                {/if}
                {item.literalLabel ? item.labelKey : t(item.labelKey)}
                {#if item.items?.length}
                  <span class="arrow" aria-hidden="true">›</span>
                {/if}
              </button>

              {#if item.items?.length && openSub === item.labelKey}
                <div class="dropdown flyout" role="menu">
                  {#each item.items as child (child.labelKey)}
                    <button
                      type="button"
                      class="item"
                      role="menuitem"
                      disabled={child.disabled}
                      title={child.tooltip}
                      onclick={() => choose(child)}
                    >
                      <span class="tick" aria-hidden="true">{child.checked ? "✓" : ""}</span>
                      {#if child.dot}
                        <span class="dot {child.dot}" aria-hidden="true"></span>
                      {:else}
                        {@render icon(child.icon)}
                      {/if}
                      {child.literalLabel ? child.labelKey : t(child.labelKey)}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  <!-- The drag region has to be the empty space, not the whole bar: a menu
       button inside a drag region swallows the click on some platforms. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <h1
    class="drag"
    data-tauri-drag-region
    ondblclick={() => appWindow.toggleMaximize()}
  >
    <span class="title-text" data-tauri-drag-region>{title}</span>
  </h1>

  <div class="controls">
    <button
      type="button"
      class="control"
      aria-label={t("window-minimise")}
      onclick={() => appWindow.minimize()}
    >
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
    </button>
    <button
      type="button"
      class="control"
      aria-label={maximized ? t("window-restore") : t("window-maximise")}
      onclick={() => appWindow.toggleMaximize()}
    >
      {#if maximized}
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5V0.5h7v7h-2" /><rect x="0.5" y="2.5" width="7" height="7" />
        </svg>
      {:else}
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      {/if}
    </button>
    <button
      type="button"
      class="control close"
      aria-label={t("window-close")}
      onclick={() => appWindow.close()}
    >
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" /></svg>
    </button>
  </div>
</nav>

<style>
  .bar {
    display: flex;
    align-items: stretch;
    gap: 0;
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
    padding-inline: var(--yaz-space-2);
    /* Above the editor, below a modal. */
    position: relative;
    z-index: 50;
  }

  .mark {
    display: flex;
    align-items: center;
    padding-inline: var(--yaz-space-2);
    margin-inline-end: var(--yaz-space-2);
    font-weight: 700;
    color: var(--yaz-accent);
  }

  .drag {
    margin: 0;
    font: inherit;
    font-weight: 400;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    /* The bar is short; without this the drag area collapses to the text. */
    align-self: stretch;
    min-inline-size: var(--yaz-space-6);
    overflow: hidden;
  }

  .title-text {
    color: var(--yaz-text-muted);
    font-size: var(--yaz-font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  .controls {
    display: flex;
    align-self: stretch;
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 2.85rem;
    background: none;
    border: none;
    color: var(--yaz-text-secondary);
    cursor: pointer;
  }

  .control:hover {
    background: var(--yaz-bg-hover);
  }

  /* Windows convention, and the one control where a mistake is expensive. */
  .control.close:hover {
    background: var(--yaz-error);
    color: var(--yaz-text-on-accent);
  }

  .control svg {
    inline-size: 0.625rem;
    block-size: 0.625rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
  }

  .menu {
    position: relative;
  }

  .title {
    font: inherit;
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-3);
    cursor: pointer;
  }

  .title:hover,
  .title.open {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .dropdown {
    position: absolute;
    inset-block-start: 100%;
    inset-inline-start: 0;
    min-inline-size: 14rem;
    padding-block: var(--yaz-space-1);
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
  }

  .item {
    inline-size: 100%;
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    font: inherit;
    text-align: start;
    color: var(--yaz-text-primary);
    background: none;
    border: none;
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-2) var(--yaz-space-4);
    cursor: pointer;
    white-space: nowrap;
  }

  .item:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  .item:disabled {
    color: var(--yaz-text-muted);
    cursor: default;
  }

  .icon {
    inline-size: 1rem;
    block-size: 1rem;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--yaz-text-muted);
  }

  .icon svg {
    inline-size: 0.875rem;
    block-size: 0.875rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .item:hover:not(:disabled) .icon {
    color: var(--yaz-text-primary);
  }

  .tick {
    inline-size: 1em;
    flex: none;
    color: var(--yaz-accent);
  }

  .entry {
    position: relative;
  }

  .flyout {
    inset-block-start: calc(-1 * var(--yaz-space-1));
    inset-inline-start: 100%;
  }

  .arrow {
    margin-inline-start: auto;
    padding-inline-start: var(--yaz-space-3);
    color: var(--yaz-text-muted);
  }

  .dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    flex: none;
    background: var(--yaz-text-muted);
  }

  .dot.live {
    background: var(--yaz-success);
  }

  .dot.degraded {
    background: var(--yaz-warning);
  }

  .dot.off {
    background: var(--yaz-error);
  }

  .separator {
    block-size: 1px;
    margin-block: var(--yaz-space-1);
    background: var(--yaz-border);
  }
</style>
