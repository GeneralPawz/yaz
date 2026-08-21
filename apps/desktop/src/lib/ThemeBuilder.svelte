<!--
  The theme builder.

  A theme is a CSS file, and it always will be — ADR-0010 chose that over a
  structured format precisely so a theme is not limited to what a form
  anticipated. This is not a replacement for writing one. It is the on-ramp:
  most people who want the application to look different want to change eight
  colours, and asking them to learn a token vocabulary and a selector first
  loses all of them.

  So it edits a curated subset, live, and exports a real bundle — the same
  manifest.json and theme.css a hand-written theme has. What comes out is
  editable by hand afterwards, which is the point: the builder is where a theme
  starts, not a walled garden it has to stay inside.

  Both palettes are edited, because a theme provides both modes. Switching the
  tab switches what the whole window is showing, so the palette being edited is
  the one being looked at.
-->
<script lang="ts">
  import { untrack } from "svelte";

  import { t } from "./i18n";
  import {
    THEME_TOKENS,
    clearPreview,
    manifestFor,
    previewPalette,
    readPalette,
    stylesheetFor,
    themeId,
    type Palette,
    type ResolvedMode,
  } from "./theme";

  interface Props {
    /** The mode the window is showing, so the builder can put it back. */
    mode: ResolvedMode;
    /** Apply the edited palette as the active theme. */
    onapply: (id: string, name: string, css: string, manifest: string) => void;
    /** Write a bundle somewhere the user chooses. */
    onexport: (id: string, css: string, manifest: string) => void;
    onclose: () => void;
  }

  let { mode, onapply, onexport, onclose }: Props = $props();

  let name = $state("My theme");
  let author = $state("");
  /** Which palette is being edited, and therefore which the window shows. */
  // Seeded from the mode the window is in, deliberately once: this is the
  // builder's own state from here on, and following the prop would fight the
  // preview, which is what changes the window's mode as the tab is switched.
  let editing = $state<ResolvedMode>(untrack(() => mode));

  /**
   * The starting point is the theme in use, read out of the document.
   *
   * Starting from a blank palette would mean picking thirty colours before
   * seeing anything that works. Starting from what is already on screen means
   * the first change is an improvement to something.
   */
  const initial = readPalette();
  let palette = $state<Palette>(structuredClone(initial));

  const id = $derived(themeId(name));

  /**
   * Show the palette being edited.
   *
   * The preview is set on the document root, which wins over the theme's own
   * rules, so what is on screen is exactly what the exported file would
   * produce. Taken back off when the builder closes without applying.
   */
  $effect(() => {
    document.documentElement.dataset.yazMode = editing;
    previewPalette(palette[editing]);
  });

  $effect(() => {
    return () => {
      clearPreview();
      document.documentElement.dataset.yazMode = mode;
    };
  });

  function bundle() {
    return {
      css: stylesheetFor(id, name, palette),
      manifest: manifestFor(id, name, author, "0.1.0"),
    };
  }

  function onkeydown(event: KeyboardEvent) {
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
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t("theme-builder-title")}>
    <header class="bar">
      <h2>{t("theme-builder-title")}</h2>
      <button
        type="button"
        class="close"
        aria-label={t("theme-builder-close")}
        onclick={onclose}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </button>
    </header>

    <div class="identity">
      <label>
        <span>{t("theme-builder-name")}</span>
        <input type="text" bind:value={name} />
      </label>
      <label>
        <span>{t("theme-builder-author")}</span>
        <input type="text" bind:value={author} />
      </label>
    </div>

    <div class="modes" role="tablist" aria-label={t("settings-colour-mode")}>
      {#each ["light", "dark"] as const as candidate (candidate)}
        <button
          type="button"
          role="tab"
          class="mode"
          class:active={editing === candidate}
          aria-selected={editing === candidate}
          onclick={() => (editing = candidate)}
        >
          {t(`theme-builder-mode-${candidate}`)}
        </button>
      {/each}
    </div>

    <p class="hint">{t("theme-builder-editing", { mode: t(`theme-builder-mode-${editing}`) })}</p>

    <div class="tokens">
      {#each THEME_TOKENS as group (group.titleKey)}
        <section class="group">
          <h3>{t(group.titleKey)}</h3>
          {#each group.fields as field (field.token)}
            <label class="token">
              <span class="label">{t(field.labelKey)}</span>
              <input
                type="color"
                value={palette[editing][field.token] ?? "#000000"}
                oninput={(event) => {
                  palette[editing][field.token] = event.currentTarget.value;
                  // Reassign so the effect above sees a change: mutating a
                  // nested field of a $state object is tracked, but the preview
                  // has to be pushed to the document as it happens rather than
                  // when the dialog closes.
                  previewPalette(palette[editing]);
                }}
              />
            </label>
          {/each}
        </section>
      {/each}
    </div>

    <footer class="actions">
      <button
        type="button"
        onclick={() => {
          palette = structuredClone(initial);
          previewPalette(palette[editing]);
        }}
      >
        {t("theme-builder-reset")}
      </button>
      <span class="spacer"></span>
      <button
        type="button"
        onclick={() => {
          const { css, manifest } = bundle();
          onexport(id, css, manifest);
        }}
      >
        {t("theme-builder-export")}
      </button>
      <button
        type="button"
        class="primary"
        onclick={() => {
          const { css, manifest } = bundle();
          onapply(id, name, css, manifest);
        }}
      >
        {t("theme-builder-apply")}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--yaz-scrim);
    display: grid;
    place-items: center;
    z-index: 20;
  }

  .dialog {
    inline-size: min(46rem, 92vw);
    max-block-size: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-lg);
    box-shadow: var(--yaz-shadow-overlay);
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--yaz-space-3) var(--yaz-space-4);
    border-block-end: 1px solid var(--yaz-border);
  }

  h2 {
    margin: 0;
    font-size: var(--yaz-font-size-base);
    font-weight: 600;
  }

  .close {
    background: none;
    border: none;
    color: var(--yaz-text-muted);
    cursor: pointer;
    padding: var(--yaz-space-1);
  }

  .close svg {
    inline-size: 0.625rem;
    block-size: 0.625rem;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .identity {
    display: flex;
    gap: var(--yaz-space-4);
    padding: var(--yaz-space-3) var(--yaz-space-4) 0;
  }

  .identity label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-1);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  input[type="text"] {
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-2);
  }

  .modes {
    display: flex;
    gap: var(--yaz-space-1);
    padding: var(--yaz-space-3) var(--yaz-space-4) 0;
  }

  .mode {
    font: inherit;
    color: var(--yaz-text-secondary);
    background: none;
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
  }

  .mode.active {
    color: var(--yaz-text-on-accent);
    background: var(--yaz-accent);
    border-color: var(--yaz-accent);
  }

  .hint {
    margin: var(--yaz-space-2) var(--yaz-space-4) 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .tokens {
    flex: 1;
    overflow-y: auto;
    padding: var(--yaz-space-3) var(--yaz-space-4);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--yaz-space-4);
    align-content: start;
  }

  h3 {
    margin: 0 0 var(--yaz-space-2);
    font-size: var(--yaz-font-size-sm);
    font-weight: 600;
    color: var(--yaz-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .token {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--yaz-space-2);
    padding-block: var(--yaz-space-1);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  input[type="color"] {
    inline-size: 2.25rem;
    block-size: 1.5rem;
    padding: 0;
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    background: none;
    cursor: pointer;
    flex: none;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-3) var(--yaz-space-4);
    border-block-start: 1px solid var(--yaz-border);
  }

  .spacer {
    flex: 1;
  }

  .actions button {
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
  }

  .actions button:hover {
    background: var(--yaz-bg-hover);
  }

  .actions .primary {
    color: var(--yaz-text-on-accent);
    background: var(--yaz-accent);
    border-color: var(--yaz-accent);
  }

  .actions .primary:hover {
    background: var(--yaz-accent-hover);
  }
</style>
