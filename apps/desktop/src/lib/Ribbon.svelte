<!--
  The ribbon.

  # Why the menus moved into it

  A menu bar is a good way to reach a hundred commands and a bad way to reach
  the eight you use constantly. LaTeX already asks a newcomer to learn a
  language; asking them to also learn where in five menus "make this an author"
  lives is the second toll on the same journey. So the commands are laid out
  where they can be seen — grouped, labelled, and with the ones that set
  standardised things given fields rather than syntax.

  # It is a shell region, not a workspace tab

  It appears under View → Tabs alongside the panes, because that is where
  someone looks to get it back, but it is not one: the tab strip stays even
  when the body is collapsed, because View lives in the ribbon and a ribbon
  that could be closed for good would take the way back with it.

  # Horizontal or vertical

  Horizontal by default, as every ribbon is. Vertical for a wide screen, where
  the scarce direction is height and a document is read down the page — the
  same reason the file list is on the side.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { MenuItem } from "./MenuBar.svelte";

  /** One control in a group. */
  export type RibbonControl =
    | {
        kind: "action";
        labelKey: string;
        glyph?: string | undefined;
        disabled?: boolean | undefined;
        checked?: boolean | undefined;
        onclick: () => void;
      }
    | {
        kind: "menu";
        labelKey: string;
        glyph?: string | undefined;
        items: MenuItem[];
      }
    | {
        kind: "text";
        labelKey: string;
        value: string;
        placeholderKey?: string | undefined;
        onchange: (value: string) => void;
      }
    | {
        kind: "select";
        labelKey: string;
        value: string;
        options: { value: string; label: string }[];
        onchange: (value: string) => void;
      };

  /** A labelled cluster of controls. */
  export interface RibbonGroup {
    titleKey: string;
    controls: RibbonControl[];
  }

  /** One tab of the ribbon. */
  export interface RibbonTab {
    id: string;
    labelKey: string;
    groups: RibbonGroup[];
  }

  interface Props {
    tabs: RibbonTab[];
    /** Which way it runs. */
    orientation: "horizontal" | "vertical";
    /** Whether the body shows. The tab strip always does. */
    expanded: boolean;
    ontoggle: () => void;
  }

  let { tabs, orientation, expanded, ontoggle }: Props = $props();

  let active = $state<string | null>(null);
  const current = $derived(tabs.find((tab) => tab.id === active) ?? tabs[0]);
  /** Which dropdown is open, by label. */
  let open = $state<string | null>(null);

  function choose(tab: RibbonTab) {
    // Clicking the tab you are on collapses the ribbon, which is how a ribbon
    // gets out of the way without a separate control to learn.
    if (current?.id === tab.id && expanded) {
      ontoggle();
      return;
    }
    active = tab.id;
    if (!expanded) ontoggle();
  }

  function run(item: MenuItem) {
    open = null;
    if (item.disabled) return;
    void item.action?.();
  }
</script>

<svelte:window onclick={() => (open = null)} />

<section class="ribbon {orientation}" class:collapsed={!expanded}>
  <div class="tabs" role="tablist" aria-label={t("ribbon-title")}>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={current?.id === tab.id && expanded}
        aria-selected={current?.id === tab.id && expanded}
        onclick={() => choose(tab)}
      >
        {t(tab.labelKey)}
      </button>
    {/each}
  </div>

  {#if expanded && current}
    <div class="body">
      {#each current.groups as group (group.titleKey)}
        <div class="group">
          <div class="controls">
            {#each group.controls as control, index (index)}
              {#if control.kind === "action"}
                <button
                  type="button"
                  class="action"
                  class:on={control.checked}
                  disabled={control.disabled}
                  onclick={control.onclick}
                >
                  {#if control.glyph}
                    <span class="glyph" aria-hidden="true">{control.glyph}</span>
                  {/if}
                  <span class="text">{t(control.labelKey)}</span>
                </button>
              {:else if control.kind === "menu"}
                <div class="dropdown-host">
                  <button
                    type="button"
                    class="action"
                    aria-haspopup="menu"
                    aria-expanded={open === control.labelKey}
                    onclick={(event) => {
                      event.stopPropagation();
                      open = open === control.labelKey ? null : control.labelKey;
                    }}
                  >
                    {#if control.glyph}
                      <span class="glyph" aria-hidden="true">{control.glyph}</span>
                    {/if}
                    <span class="text">{t(control.labelKey)}</span>
                    <span class="caret" aria-hidden="true">▾</span>
                  </button>
                  {#if open === control.labelKey}
                    <!-- Stops a click inside the menu from reaching the
                         window handler that closes it. -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <div
                      class="dropdown"
                      role="menu"
                      tabindex="-1"
                      onclick={(event) => event.stopPropagation()}
                      onkeydown={(event) => {
                        if (event.key === "Escape") open = null;
                      }}
                    >
                      {#each control.items as item (item.labelKey)}
                        <button
                          type="button"
                          class="item"
                          role="menuitem"
                          disabled={item.disabled}
                          title={item.tooltip}
                          onclick={() => run(item)}
                        >
                          <span class="tick" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                          {item.literalLabel ? item.labelKey : t(item.labelKey)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else if control.kind === "text"}
                <label class="field">
                  <span class="caption">{t(control.labelKey)}</span>
                  <input
                    type="text"
                    value={control.value}
                    placeholder={control.placeholderKey ? t(control.placeholderKey) : ""}
                    onchange={(event) => control.onchange(event.currentTarget.value)}
                  />
                </label>
              {:else}
                <label class="field">
                  <span class="caption">{t(control.labelKey)}</span>
                  <select
                    value={control.value}
                    onchange={(event) => control.onchange(event.currentTarget.value)}
                  >
                    {#each control.options as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </label>
              {/if}
            {/each}
          </div>
          <span class="group-title">{t(group.titleKey)}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .ribbon {
    display: flex;
    flex-direction: column;
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
    flex: none;
  }

  /* Vertical: the tabs run down the side and the groups stack, for a wide
     screen where height is the scarce direction. */
  .ribbon.vertical {
    flex-direction: row;
    border-block-end: none;
    border-inline-end: 1px solid var(--yaz-border);
    block-size: 100%;
    max-inline-size: 22rem;
  }

  .tabs {
    display: flex;
    gap: var(--yaz-space-1);
    padding: 0 var(--yaz-space-2);
    border-block-end: 1px solid var(--yaz-border);
  }

  .ribbon.vertical .tabs {
    flex-direction: column;
    border-block-end: none;
    border-inline-end: 1px solid var(--yaz-border);
    padding: var(--yaz-space-2) 0;
  }

  .tab {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-block-end: 2px solid transparent;
    padding: var(--yaz-space-2) var(--yaz-space-3);
    cursor: pointer;
    white-space: nowrap;
  }

  .tab:hover {
    color: var(--yaz-text-primary);
  }

  .tab.active {
    color: var(--yaz-accent);
    border-block-end-color: var(--yaz-accent);
  }

  .ribbon.vertical .tab {
    border-block-end: none;
    border-inline-start: 2px solid transparent;
    text-align: start;
  }

  .ribbon.vertical .tab.active {
    border-inline-start-color: var(--yaz-accent);
  }

  .body {
    display: flex;
    align-items: stretch;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-2) var(--yaz-space-3);
    overflow-x: auto;
  }

  .ribbon.vertical .body {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* Groups are separated by a rule, which is what makes a ribbon scannable —
     the eye finds the group first and the control inside it second. */
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-1);
    padding-inline-end: var(--yaz-space-3);
    border-inline-end: 1px solid var(--yaz-border);
  }

  .group:last-child {
    border-inline-end: none;
  }

  .ribbon.vertical .group {
    border-inline-end: none;
    border-block-end: 1px solid var(--yaz-border);
    padding-block-end: var(--yaz-space-2);
  }

  .controls {
    display: flex;
    align-items: flex-start;
    gap: var(--yaz-space-1);
    flex: 1;
    flex-wrap: wrap;
  }

  .group-title {
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
    text-align: center;
  }

  .action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-inline-size: 3.5rem;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-2);
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  .action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .action.on {
    background: var(--yaz-bg-active);
    border-color: var(--yaz-border);
    color: var(--yaz-accent);
  }

  .glyph {
    font-size: 1.1rem;
    line-height: 1.2;
  }

  .text {
    white-space: nowrap;
  }

  .caret {
    font-size: 0.6rem;
    color: var(--yaz-text-muted);
  }

  .dropdown-host {
    position: relative;
  }

  .dropdown {
    position: absolute;
    inset-block-start: 100%;
    inset-inline-start: 0;
    z-index: 15;
    min-inline-size: 12rem;
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    padding: var(--yaz-space-1) 0;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    inline-size: 100%;
    text-align: start;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: none;
    border: none;
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
  }

  .item:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  .item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tick {
    inline-size: 0.75rem;
    color: var(--yaz-accent);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  .caption {
    white-space: nowrap;
  }

  input[type="text"],
  select {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: 2px var(--yaz-space-2);
    min-inline-size: 9rem;
  }
</style>
