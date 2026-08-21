<!--
  The shared chooser behind `app.ui.pick`.

  A plugin could build its own out of raw DOM — it has the access — but then
  every plugin's picker would look different, follow different keyboard
  conventions, and miss the theme. This is core for the same reason the command
  palette is (ADR-0005).

  Note the contract: rows carry *data* (a paper's title, a highlighted
  sentence), so their text is plain strings. Everything that is interface
  copy — the title, the placeholder, the empty state — is a message key.
-->
<script lang="ts">
  import { t } from "./i18n";

  /** One row, mirroring `PickerItem` in @yaz/api. */
  export interface Row {
    value: unknown;
    label: string;
    description?: string | undefined;
    detail?: string | undefined;
    accentColor?: string | undefined;
  }

  interface Props {
    titleKey: string;
    // `| undefined` explicitly: exactOptionalPropertyTypes distinguishes an
    // absent property from one set to undefined, and a caller forwarding an
    // optional value passes the latter.
    placeholderKey?: string | undefined;
    emptyKey?: string | undefined;
    /** Called on every keystroke; an array source is wrapped by the caller. */
    load: (query: string) => Promise<Row[]>;
    onchoose: (value: unknown) => void;
    oncancel: () => void;
  }

  let {
    titleKey,
    placeholderKey = "picker-placeholder",
    emptyKey = "picker-empty",
    load,
    onchoose,
    oncancel,
  }: Props = $props();

  let query = $state("");
  let rows = $state<Row[]>([]);
  let active = $state(0);
  let loading = $state(true);
  let failed = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  // Every keystroke triggers a query, and a slow source would otherwise let an
  // earlier result land after a later one and overwrite it. The sequence number
  // is what makes the last request win rather than the last *response*.
  let sequence = 0;

  async function run(text: string) {
    const mine = ++sequence;
    loading = true;
    failed = false;
    try {
      const result = await load(text);
      if (mine !== sequence) return;
      rows = result;
      active = 0;
    } catch {
      if (mine !== sequence) return;
      rows = [];
      failed = true;
    } finally {
      if (mine === sequence) loading = false;
    }
  }

  $effect(() => {
    void run(query);
  });

  $effect(() => {
    input?.focus();
  });

  function move(delta: number) {
    if (rows.length === 0) return;
    // Wrap, so holding Down at the end returns to the top rather than sticking.
    active = (active + delta + rows.length) % rows.length;
  }

  function onkeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter": {
        event.preventDefault();
        const chosen = rows[active];
        if (chosen) onchoose(chosen.value);
        break;
      }
      case "Escape":
        event.preventDefault();
        oncancel();
        break;
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) oncancel();
  }}
>
  <div class="picker" role="dialog" aria-modal="true" aria-label={t(titleKey)}>
    <h2 class="title">{t(titleKey)}</h2>

    <input
      bind:this={input}
      bind:value={query}
      {onkeydown}
      class="filter"
      type="text"
      placeholder={t(placeholderKey)}
      aria-label={t(placeholderKey)}
    />

    {#if loading && rows.length === 0}
      <p class="state">{t("picker-loading")}</p>
    {:else if failed}
      <p class="state">{t("picker-failed")}</p>
    {:else if rows.length === 0}
      <p class="state">{t(emptyKey)}</p>
    {:else}
      <ul class="rows" role="listbox" aria-label={t(titleKey)}>
        {#each rows as row, index (index)}
          <li>
            <button
              type="button"
              class="row"
              class:active={index === active}
              role="option"
              aria-selected={index === active}
              onclick={() => onchoose(row.value)}
              onmouseenter={() => (active = index)}
            >
              <!--
                The accent is the user's own highlight colour, carried straight
                through from their library. It is data rather than a design
                decision, which is why it is not a theme token (ADR-0010).
              -->
              {#if row.accentColor}
                <span class="accent" style:background-color={row.accentColor}></span>
              {/if}
              <span class="text">
                <span class="label">{row.label}</span>
                {#if row.description}
                  <span class="description">{row.description}</span>
                {/if}
                {#if row.detail}
                  <span class="detail">{row.detail}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--yaz-scrim);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-block-start: 10vh;
    z-index: 100;
  }

  .picker {
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-lg);
    box-shadow: var(--yaz-shadow-overlay);
    inline-size: min(46rem, 92vw);
    max-block-size: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .title {
    margin: 0;
    padding-block: var(--yaz-space-3);
    padding-inline: var(--yaz-space-4);
    font-size: var(--yaz-font-size-sm);
    font-weight: 600;
    color: var(--yaz-text-muted);
    border-block-end: 1px solid var(--yaz-border);
  }

  .filter {
    margin: var(--yaz-space-3);
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-3);
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
  }

  .filter:focus-visible {
    outline: 2px solid var(--yaz-focus-ring);
    outline-offset: 1px;
  }

  .state {
    margin: 0;
    padding: var(--yaz-space-4);
    color: var(--yaz-text-muted);
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }

  .row {
    inline-size: 100%;
    display: flex;
    gap: var(--yaz-space-3);
    align-items: flex-start;
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-4);
    font: inherit;
    text-align: start;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }

  .row.active {
    background: var(--yaz-bg-active);
  }

  .accent {
    inline-size: 0.25rem;
    align-self: stretch;
    border-radius: var(--yaz-radius-sm);
    flex: none;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .description,
  .detail {
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .detail {
    /* A quoted passage can be long; show enough to recognise it without
       letting one row take over the list. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
