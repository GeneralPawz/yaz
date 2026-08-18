<!--
  The settings dialog.

  Laid out the way desktop settings dialogs are: a section list on the left, one
  section's controls on the right. That shape is what lets settings grow — the
  engine choice came out of the toolbar to live here, and everything after it has
  somewhere to go that is not another button in a row.

  Controls are described as data rather than written as markup per section, so a
  new setting is a row in a list. A settings dialog assembled by hand drifts into
  five slightly different ways of drawing a labelled dropdown.
-->
<script lang="ts">
  import { t } from "./i18n";

  /** A control in a section. */
  export type Field =
    | {
        kind: "select";
        labelKey: string;
        helpKey?: string | undefined;
        value: string;
        options: { value: string; label: string; disabled?: boolean | undefined }[];
        onchange: (value: string) => void;
        /** Message key for a warning shown beneath, e.g. an unavailable engine. */
        warningKey?: string | undefined;
      }
    | {
        kind: "toggle";
        labelKey: string;
        helpKey?: string | undefined;
        value: boolean;
        onchange: (value: boolean) => void;
      }
    | {
        kind: "button";
        labelKey: string;
        helpKey?: string | undefined;
        /** Text on the button. The label beside it says what it is for. */
        actionKey: string;
        onclick: () => void;
      }
    | {
        kind: "shortcut";
        labelKey: string;
        /** The binding as a person reads it, e.g. `Ctrl+Space, R`. */
        binding: string;
        /** Whether it is switched on at all. */
        active: boolean;
        /** Whether another shortcut claims the same keys. */
        conflicting: boolean;
        /** Whether it has been changed from what it shipped with. */
        changed: boolean;
        /** Called with a new binding, or an empty string to unbind. */
        onrebind: (binding: string) => void;
        onreset: () => void;
      }
    | { kind: "note"; labelKey: string };

  /** A group of fields under a heading. */
  export interface Group {
    titleKey: string;
    fields: Field[];
  }

  /** One entry in the section list. */
  export interface Section {
    id: string;
    labelKey: string;
    /** A single glyph, shown beside the label. Not an icon font. */
    glyph: string;
    groups: Group[];
  }

  interface Props {
    sections: Section[];
    /** Section to open on. */
    initial?: string | undefined;
    onclose: () => void;
  }

  let { sections, initial, onclose }: Props = $props();

  /**
   * Which section is showing.
   *
   * `null` means "whatever the caller asked for, else the first" — resolved in
   * the derived below rather than captured at construction, so opening the
   * dialog on a specific section works every time and not just the first.
   */
  let chosen = $state<string | null>(null);
  const active = $derived(
    sections.find((section) => section.id === chosen) ??
      sections.find((section) => section.id === initial) ??
      sections[0],
  );

  /** Which binding is waiting to be pressed, by its label. */
  let capturing = $state<string | null>(null);

  /**
   * Take the pressed combination as the new binding.
   *
   * Modifiers alone are ignored: someone reaching for Ctrl+Shift+K presses
   * Ctrl first, and taking that as the answer would bind the shortcut to a
   * key they had not finished pressing.
   */
  function capture(event: KeyboardEvent, field: Extract<Field, { kind: "shortcut" }>) {
    if (capturing !== field.labelKey) return;
    event.preventDefault();
    event.stopPropagation();

    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    if (event.key === "Escape") {
      capturing = null;
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      field.onrebind("");
      capturing = null;
      return;
    }

    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push("Mod");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    const key = event.key === " " ? "Space" : event.key;
    parts.push(key.length === 1 ? key.toLowerCase() : key);

    field.onrebind(parts.join("-"));
    capturing = null;
  }

  function onkeydown(event: KeyboardEvent) {
    // While capturing, every key belongs to the binding being set.
    if (capturing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window on:keydown={onkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t("settings-title")}>
    <header class="bar">
      <h2>{t("settings-title")}</h2>
      <button type="button" class="close" aria-label={t("window-close")} onclick={onclose}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </button>
    </header>

    <div class="body">
      <nav class="sections" aria-label={t("settings-title")}>
        {#each sections as section (section.id)}
          <button
            type="button"
            class="section"
            class:active={section.id === active?.id}
            aria-current={section.id === active?.id}
            onclick={() => (chosen = section.id)}
          >
            <span class="glyph" aria-hidden="true">{section.glyph}</span>
            {t(section.labelKey)}
          </button>
        {/each}
      </nav>

      <div class="pane">
        {#if active}
          {#each active.groups as group (group.titleKey)}
            <section class="group">
              <h3>{t(group.titleKey)}</h3>

              {#each group.fields as field, index (index)}
                {#if field.kind === "note"}
                  <p class="note">{t(field.labelKey)}</p>
                {:else if field.kind === "select"}
                  <div class="row">
                    <label class="label" for="setting-{active?.id}-{index}">
                      {t(field.labelKey)}
                    </label>
                    <div class="control">
                      <select
                        id="setting-{active?.id}-{index}"
                        value={field.value}
                        onchange={(event) =>
                          field.onchange((event.currentTarget as HTMLSelectElement).value)}
                      >
                        {#each field.options as option (option.value)}
                          <option value={option.value} disabled={option.disabled}>
                            {option.label}
                          </option>
                        {/each}
                      </select>
                      {#if field.helpKey}
                        <p class="help">{t(field.helpKey)}</p>
                      {/if}
                      {#if field.warningKey}
                        <p class="warn">{t(field.warningKey)}</p>
                      {/if}
                    </div>
                  </div>
                {:else if field.kind === "shortcut"}
                  <div class="row" class:inactive={!field.active}>
                    <span class="label">{t(field.labelKey)}</span>
                    <div class="control keys">
                      <!-- The binding is captured by pressing it, not typed.
                           Asking someone to write `Mod-Shift-k` means teaching
                           them a notation to change one key. -->
                      <button
                        type="button"
                        class="binding"
                        class:capturing={capturing === field.labelKey}
                        class:conflict={field.conflicting}
                        onclick={() =>
                          (capturing = capturing === field.labelKey ? null : field.labelKey)}
                        onkeydown={(event) => capture(event, field)}
                      >
                        {#if capturing === field.labelKey}
                          {t("keys-press")}
                        {:else}
                          {field.binding || t("keys-unbound")}
                        {/if}
                      </button>
                      {#if field.changed}
                        <button
                          type="button"
                          class="reset"
                          title={t("keys-reset")}
                          aria-label={t("keys-reset")}
                          onclick={field.onreset}
                        >
                          ↺
                        </button>
                      {/if}
                      {#if field.conflicting}
                        <p class="warn">{t("keys-conflict")}</p>
                      {/if}
                    </div>
                  </div>
                {:else if field.kind === "button"}
                  <div class="row">
                    <span class="label">{t(field.labelKey)}</span>
                    <div class="control">
                      <button type="button" class="action" onclick={field.onclick}>
                        {t(field.actionKey)}
                      </button>
                      {#if field.helpKey}
                        <p class="help">{t(field.helpKey)}</p>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="row">
                    <span class="label">{t(field.labelKey)}</span>
                    <div class="control">
                      <label class="toggle">
                        <input
                          type="checkbox"
                          checked={field.value}
                          onchange={(event) =>
                            field.onchange((event.currentTarget as HTMLInputElement).checked)}
                        />
                        {t(field.labelKey)}
                      </label>
                      {#if field.helpKey}
                        <p class="help">{t(field.helpKey)}</p>
                      {/if}
                    </div>
                  </div>
                {/if}
              {/each}
            </section>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--yaz-scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 120;
  }

  .dialog {
    inline-size: min(52rem, 94vw);
    block-size: min(38rem, 88vh);
    display: flex;
    flex-direction: column;
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-lg);
    box-shadow: var(--yaz-shadow-overlay);
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    padding-inline-start: var(--yaz-space-4);
    border-block-end: 1px solid var(--yaz-border);
  }

  .bar h2 {
    margin: 0;
    font-size: var(--yaz-font-size-base);
    font-weight: 600;
  }

  .close {
    margin-inline-start: auto;
    align-self: stretch;
    inline-size: 2.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--yaz-text-secondary);
    cursor: pointer;
  }

  .close:hover {
    background: var(--yaz-error);
    color: var(--yaz-text-on-accent);
  }

  .close svg {
    inline-size: 0.625rem;
    block-size: 0.625rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
  }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 13rem 1fr;
    min-block-size: 0;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--yaz-space-2);
    background: var(--yaz-bg-secondary);
    border-inline-end: 1px solid var(--yaz-border);
    overflow-y: auto;
  }

  .section {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    inline-size: 100%;
    font: inherit;
    text-align: start;
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-2);
    cursor: pointer;
  }

  .section:hover {
    background: var(--yaz-bg-hover);
  }

  .section.active {
    background: var(--yaz-accent);
    color: var(--yaz-text-on-accent);
  }

  .glyph {
    inline-size: 1.25rem;
    text-align: center;
  }

  .pane {
    padding: var(--yaz-space-4) var(--yaz-space-6);
    overflow-y: auto;
  }

  .group + .group {
    margin-block-start: var(--yaz-space-6);
  }

  .group h3 {
    margin: 0 0 var(--yaz-space-3);
    font-size: var(--yaz-font-size-base);
    font-weight: 600;
  }

  .row {
    display: grid;
    /* Labels right-aligned against a shared column, which is what makes a
       settings pane read as a form rather than a stack of controls. */
    grid-template-columns: 9rem 1fr;
    gap: var(--yaz-space-3);
    align-items: baseline;
    margin-block-end: var(--yaz-space-3);
  }

  .label {
    text-align: end;
    color: var(--yaz-text-secondary);
  }

  .control {
    min-inline-size: 0;
  }

  select {
    inline-size: 100%;
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-2);
  }

  .keys {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    flex-wrap: wrap;
  }

  .binding {
    font-family: var(--yaz-font-mono);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-2);
    min-inline-size: 8rem;
    cursor: pointer;
  }

  .binding:hover {
    background: var(--yaz-bg-hover);
  }

  .binding.capturing {
    border-color: var(--yaz-accent);
    color: var(--yaz-accent);
  }

  .binding.conflict {
    border-color: var(--yaz-warning);
  }

  .reset {
    font: inherit;
    color: var(--yaz-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 var(--yaz-space-1);
  }

  .reset:hover {
    color: var(--yaz-text-primary);
  }

  /* A shortcut whose suite is switched off still shows, greyed: hiding it
     would make "why does Ctrl+B do nothing?" unanswerable from here. */
  .row.inactive {
    opacity: 0.5;
  }

  .action {
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
  }

  .action:hover {
    background: var(--yaz-bg-hover);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
  }

  .help,
  .note {
    margin: var(--yaz-space-1) 0 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .note {
    margin: 0;
  }

  .warn {
    margin: var(--yaz-space-1) 0 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-warning);
  }
</style>
