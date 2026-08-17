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
  }

  /** One top-level menu. */
  export interface Menu {
    labelKey: string;
    items: MenuItem[];
  }

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
                {/if}
                {t(item.labelKey)}
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
                      onclick={() => choose(child)}
                    >
                      <span class="tick" aria-hidden="true">{child.checked ? "✓" : ""}</span>
                      {#if child.dot}
                        <span class="dot {child.dot}" aria-hidden="true"></span>
                      {/if}
                      {t(child.labelKey)}
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
