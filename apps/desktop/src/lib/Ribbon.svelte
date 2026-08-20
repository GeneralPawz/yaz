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
  import { ICONS } from "./icons";
  import type { IconName } from "./icons";
  import type { MenuItem } from "./MenuBar.svelte";
  import type { DateChoice } from "./editor/documentDate";

  /** One control in a group. */
  export type RibbonControl =
    | {
        kind: "action";
        labelKey: string;
        icon?: IconName | undefined;
        disabled?: boolean | undefined;
        checked?: boolean | undefined;
        /**
         * Draw it large, with the label under the icon.
         *
         * Word's own rule: the one or two commands a tab exists for get the
         * height, and the rest sit in rows beside them. A ribbon where every
         * button is the same size is a wall, and the eye has nowhere to land.
         */
        prominent?: boolean | undefined;
        onclick: () => void;
      }
    | {
        kind: "menu";
        labelKey: string;
        icon?: IconName | undefined;
        items: MenuItem[];
      }
    | {
        kind: "text";
        labelKey: string;
        icon?: IconName | undefined;
        value: string;
        placeholderKey?: string | undefined;
        onchange: (value: string) => void;
      }
    | {
        kind: "select";
        labelKey: string;
        icon?: IconName | undefined;
        value: string;
        options: { value: string; label: string }[];
        onchange: (value: string) => void;
      }
    | {
        kind: "date";
        labelKey: string;
        icon?: IconName | undefined;
        /** Which of the three kinds of date this is. */
        choice: DateChoice;
        /** The chosen day as the document's language writes it. */
        formatted: string;
        onchange: (choice: DateChoice) => void;
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

  /**
   * A button on the tab strip itself, at the far end.
   *
   * For the two or three things that belong to no tab because they are wanted
   * from every one — compiling, and settings. Putting settings inside a tab
   * means someone looking for it has to guess which, and the guess is wrong
   * often enough that they stop looking.
   */
  export interface RibbonAction {
    id: string;
    labelKey: string;
    icon: IconName;
    disabled?: boolean | undefined;
    onclick: () => void;
    /** Shown on a right-click, when there is more than one way to do it. */
    menu?: MenuItem[] | undefined;
  }

  interface Props {
    tabs: RibbonTab[];
    /** Buttons at the end of the tab strip, in order. */
    actions?: RibbonAction[] | undefined;
    /** Which way it runs. */
    orientation: "horizontal" | "vertical";
    /** Whether the body shows. The tab strip always does. */
    expanded: boolean;
    ontoggle: () => void;
  }

  let { tabs, actions = [], orientation, expanded, ontoggle }: Props = $props();

  let active = $state<string | null>(null);
  const current = $derived(tabs.find((tab) => tab.id === active) ?? tabs[0]);
  /** Which dropdown is open, by label. */
  let open = $state<string | null>(null);
  /** Which tab-strip action has its right-click menu showing. */
  let openAction = $state<string | null>(null);

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

<!--
  One icon slot per control, drawn or empty.

  Always rendered, even with nothing in it, so a row of buttons lines up
  whether or not every one of them has a mark.
-->
{#snippet icon(name: IconName | undefined)}
  <span class="icon" aria-hidden="true">
    {#if name}
      <svg viewBox="0 0 16 16"><path d={ICONS[name]} /></svg>
    {/if}
  </span>
{/snippet}

<svelte:window
  onclick={() => {
    open = null;
    openAction = null;
  }}
/>

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

    <span class="tab-spacer"></span>

    {#each actions as action (action.id)}
      <div class="action-host">
        <button
          type="button"
          class="strip-action"
          disabled={action.disabled}
          title={t(action.labelKey)}
          aria-label={t(action.labelKey)}
          onclick={action.onclick}
          oncontextmenu={(event) => {
            if (!action.menu?.length) return;
            // The alternatives to the button's own job, where a right-click
            // already means "the other ways to do this".
            event.preventDefault();
            event.stopPropagation();
            openAction = openAction === action.id ? null : action.id;
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={ICONS[action.icon]} /></svg>
        </button>

        {#if openAction === action.id && action.menu?.length}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="dropdown end"
            role="menu"
            tabindex="-1"
            onclick={(event) => event.stopPropagation()}
            onkeydown={(event) => {
              if (event.key === "Escape") openAction = null;
            }}
          >
            {#each action.menu as item (item.labelKey)}
              <button
                type="button"
                class="item"
                role="menuitem"
                disabled={item.disabled}
                onclick={() => {
                  openAction = null;
                  if (!item.disabled) void item.action?.();
                }}
              >
                <span class="tick" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                {@render icon(item.icon)}
                {item.literalLabel ? item.labelKey : t(item.labelKey)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
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
                  class:large={control.prominent}
                  class:on={control.checked}
                  disabled={control.disabled}
                  onclick={control.onclick}
                >
                  {@render icon(control.icon)}
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
                    {@render icon(control.icon)}
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
                          <span class="tick" aria-hidden="true"
                            >{item.checked ? "✓" : ""}</span
                          >
                          {@render icon(item.icon)}
                          {item.literalLabel ? item.labelKey : t(item.labelKey)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else if control.kind === "text"}
                <label class="field">
                  {@render icon(control.icon)}
                  <span class="caption">{t(control.labelKey)}</span>
                  <input
                    type="text"
                    value={control.value}
                    placeholder={control.placeholderKey ? t(control.placeholderKey) : ""}
                    onchange={(event) => control.onchange(event.currentTarget.value)}
                  />
                </label>
              {:else if control.kind === "date"}
                <div class="field">
                  {@render icon(control.icon)}
                  <span class="caption">{t(control.labelKey)}</span>
                  <select
                    value={control.choice.kind}
                    onchange={(event) => {
                      const kind = event.currentTarget.value;
                      if (kind === "on") {
                        // Starting from today rather than from nothing: a date
                        // picker opened on an empty value makes the author
                        // find the current month before they can choose.
                        control.onchange({
                          kind: "on",
                          iso:
                            control.choice.kind === "on"
                              ? control.choice.iso
                              : new Date().toISOString().slice(0, 10),
                        });
                      } else if (kind === "today" || kind === "none") {
                        control.onchange({ kind });
                      }
                    }}
                  >
                    <option value="today">{t("date-today")}</option>
                    <option value="on">{t("date-on")}</option>
                    <option value="none">{t("date-none")}</option>
                    {#if control.choice.kind === "literal"}
                      <!-- Something the author wrote that this does not model.
                           Offered as itself so choosing another option is a
                           deliberate act rather than an accident of the list
                           having no entry for what is there. -->
                      <option value="literal">{control.choice.text}</option>
                    {/if}
                  </select>

                  {#if control.choice.kind === "on"}
                    <input
                      type="date"
                      value={control.choice.iso}
                      aria-label={t(control.labelKey)}
                      onchange={(event) =>
                        control.onchange({ kind: "on", iso: event.currentTarget.value })}
                    />
                    <!-- What the reader will see. LaTeX prints a fixed date
                         verbatim, so the author has to be shown it. -->
                    <span class="preview">{control.formatted}</span>
                  {/if}
                </div>
              {:else}
                <label class="field">
                  {@render icon(control.icon)}
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

  /* Pushes the strip's own buttons to the far end, where the eye goes looking
     for the things that belong to no tab. */
  .tab-spacer {
    flex: 1;
  }

  .action-host {
    position: relative;
    display: flex;
    align-items: center;
  }

  .strip-action {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    margin-inline: 1px;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    color: var(--yaz-text-muted);
    cursor: pointer;
  }

  .strip-action svg {
    inline-size: 0.9375rem;
    block-size: 0.9375rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .strip-action:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .strip-action:disabled {
    opacity: 0.35;
    cursor: default;
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

  .ribbon.vertical .tab-spacer {
    flex: 0;
    block-size: var(--yaz-space-2);
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

  /* Small controls stack two or three deep in a column and the columns run
     along, which is what gives a ribbon its shape: a tall group is one
     important command, a wide group is many small ones. */
  .controls {
    display: flex;
    flex-flow: column wrap;
    align-content: flex-start;
    align-items: stretch;
    gap: 2px;
    max-block-size: 4.5rem;
    flex: 1;
  }

  .group-title {
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
    text-align: center;
  }

  /* The ordinary size: icon and label side by side, three to a column. */
  .action {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--yaz-radius-sm);
    padding: 2px var(--yaz-space-2);
    cursor: pointer;
    white-space: nowrap;
    text-align: start;
  }

  /* The command a tab exists for: full height, label beneath a larger icon. */
  .action.large {
    flex-direction: column;
    justify-content: center;
    gap: var(--yaz-space-1);
    block-size: 4.5rem;
    min-inline-size: 4rem;
    padding: var(--yaz-space-2);
  }

  .action.large .icon {
    inline-size: 1.5rem;
    block-size: 1.5rem;
  }

  .action.large .icon svg {
    inline-size: 1.375rem;
    block-size: 1.375rem;
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

  .action:hover:not(:disabled) .icon,
  .action.on .icon,
  .item:hover:not(:disabled) .icon {
    color: currentColor;
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
    /* An end-anchored menu, for a button at the end of the strip: opening
       inward is the only direction with room. */
    z-index: 15;
    min-inline-size: 12rem;
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    padding: var(--yaz-space-1) 0;
  }

  .dropdown.end {
    inset-inline-start: auto;
    inset-inline-end: 0;
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
    align-items: center;
    gap: var(--yaz-space-2);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    padding: 2px var(--yaz-space-2);
  }

  .caption {
    white-space: nowrap;
    min-inline-size: 3.5rem;
  }

  .preview {
    color: var(--yaz-text-muted);
    white-space: nowrap;
  }

  input[type="date"] {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: 2px var(--yaz-space-2);
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
