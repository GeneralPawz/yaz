<!--
  The application menu.

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
  }

  /** One top-level menu. */
  export interface Menu {
    labelKey: string;
    items: MenuItem[];
  }

  interface Props {
    menus: Menu[];
  }

  let { menus }: Props = $props();

  /** Index of the open menu, or null. */
  let open = $state<number | null>(null);
  let bar = $state<HTMLElement | null>(null);

  /**
   * Once a menu is open, hovering another opens it — the standard behaviour,
   * and its absence is the thing that makes a hand-rolled menu bar feel wrong.
   */
  function hover(index: number) {
    if (open !== null) open = index;
  }

  function choose(item: MenuItem) {
    open = null;
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

<nav class="bar" bind:this={bar} aria-label={t("app-name")}>
  <!-- The wordmark, not an image: it is two characters, and a file would be a
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
        onclick={() => (open = open === index ? null : index)}
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
            <button
              type="button"
              class="item"
              role="menuitem"
              disabled={item.disabled}
              onclick={() => choose(item)}
            >
              <span class="tick" aria-hidden="true">{item.checked ? "✓" : ""}</span>
              {t(item.labelKey)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
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

  .separator {
    block-size: 1px;
    margin-block: var(--yaz-space-1);
    background: var(--yaz-border);
  }
</style>
