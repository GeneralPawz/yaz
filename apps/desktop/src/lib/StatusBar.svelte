<!--
  The status bar.

  What replaces a tagline. A tagline is for the moment before someone has
  decided to use the application; a status bar is for the hours afterwards, and
  it answers the questions a writer asks without wanting to stop: how long is
  this, what page am I on, what language is it in.

  # The word count counts what will be printed

  Not what is in the file. A `.tex` is full of things that are not words —
  commands, comments, the preamble — and a count that included them would be
  wrong by a wide and varying margin, in the direction that flatters. Journals
  and supervisors ask for the printed count, so that is the one shown, and it is
  labelled an estimate because a count taken from source before it is typeset
  is exactly that.
-->
<script lang="ts">
  import { t } from "./i18n";

  interface Props {
    /**
     * What the last compile said, already resolved to a sentence.
     *
     * A status bar is where a compile result belongs: it is the answer to a
     * question you asked a moment ago and will ask again, not an event worth
     * interrupting for.
     */
    compileMessage: string | null;
    /** Whether that message is a failure rather than a success. */
    compileFailed: boolean;
    /** How many problems the last compile reported. */
    compileErrors: number;
    /** How the things yaz connects to are doing. */
    health: "live" | "degraded" | "off" | "unknown";
    healthLabel: string;
    onhealth: () => void;
    /** Which page of the compiled PDF is showing, when one is. */
    page: number | null;
    pages: number | null;
    /** Words that will reach the PDF. */
    words: number;
    /** The document's language, as babel names it, or empty when it sets none. */
    language: string;
    /** Offered languages, for setting one the document does not declare. */
    languages: { value: string; label: string }[];
    onlanguage: (value: string) => void;
    /** Whether the text is set on a page. */
    pageView: boolean;
    onpageview: () => void;
    /** Whether rich text is showing rather than the source. */
    rich: boolean;
    onsource: () => void;
    /** How large the text is drawn, as a percentage. */
    zoom: number;
    onzoom: (percent: number) => void;
  }

  let {
    compileMessage,
    compileFailed,
    compileErrors,
    health,
    healthLabel,
    onhealth,
    page,
    pages,
    words,
    language,
    languages,
    onlanguage,
    pageView,
    onpageview,
    rich,
    onsource,
    zoom,
    onzoom,
  }: Props = $props();

  /** Set while the percentage is being typed rather than dragged. */
  let editingZoom = $state(false);
  let typedZoom = $state("");

  /** Zoom levels the slider snaps through, as a word processor offers them. */
  const STEPS = [50, 75, 100, 125, 150, 200, 300, 400];

  function commitZoom() {
    const parsed = Number.parseInt(typedZoom, 10);
    // Bounded rather than refused: someone typing 5000 meant "as large as it
    // goes", and an error message for that would be pedantry.
    if (Number.isFinite(parsed)) onzoom(Math.min(Math.max(parsed, 10), 400));
    editingZoom = false;
  }
</script>

<footer class="status">
  <!--
    Left: what the document *is*. Right: how you are looking at it.

    The split is the one a word processor uses, and it is not arbitrary — the
    left is read, the right is operated. A count and a language are facts you
    glance at; a zoom slider and a view mode are controls you reach for, and
    controls belong together at the end of the line where the hand already is.
  -->
  <span class="item">{t("status-words", { words })}</span>

  <label class="item language">
    <span class="visually-hidden">{t("settings-document-locale")}</span>
    <select
      value={language}
      title={t("settings-document-locale")}
      onchange={(event) => onlanguage(event.currentTarget.value)}
    >
      <!-- A document that declares no language shows the choice as unmade, and
           choosing one writes it into the source rather than remembering it
           somewhere else. -->
      <option value="">{t("status-language-unset")}</option>
      {#each languages as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>

  {#if compileMessage}
    <span class="item compile" class:failed={compileFailed}>
      {compileMessage}{#if compileErrors > 0}&nbsp;· {t("compile-diagnostics-count", {
          count: compileErrors,
        })}{/if}
    </span>
  {/if}

  <span class="spacer"></span>

  <!-- Something to glance at, not something to operate: the detail lives in
       the ribbon's Tools tab. -->
  <button
    type="button"
    class="health"
    title={healthLabel}
    aria-label={healthLabel}
    onclick={onhealth}
  >
    <span class="dot {health}" aria-hidden="true"></span>
  </button>

  {#if pages !== null}
    <span class="item">{t("status-page", { page: page ?? 1, pages })}</span>
  {/if}

  <button
    type="button"
    class="mode"
    class:on={pageView}
    title={t("status-page-view")}
    aria-pressed={pageView}
    onclick={onpageview}
  >
    {t("status-page-view")}
  </button>
  <button
    type="button"
    class="mode"
    class:on={!rich}
    title={t("view-mode-source")}
    aria-pressed={!rich}
    onclick={onsource}
  >
    {t("view-mode-source")}
  </button>

  <div class="zoom">
    <input
      type="range"
      min="10"
      max="400"
      step="5"
      value={zoom}
      list="yaz-zoom-steps"
      aria-label={t("status-zoom")}
      oninput={(event) => onzoom(Number(event.currentTarget.value))}
    />
    <datalist id="yaz-zoom-steps">
      {#each STEPS as step (step)}
        <option value={step}></option>
      {/each}
    </datalist>

    {#if editingZoom}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="percent-input"
        type="text"
        autofocus
        bind:value={typedZoom}
        aria-label={t("status-zoom")}
        onblur={commitZoom}
        onkeydown={(event) => {
          if (event.key === "Enter") commitZoom();
          if (event.key === "Escape") editingZoom = false;
        }}
      />
    {:else}
      <!-- The percentage is a button because it is one: clicking it is how you
           type a level the slider does not stop at. -->
      <button
        type="button"
        class="percent"
        title={t("status-zoom-set")}
        onclick={() => {
          typedZoom = String(zoom);
          editingZoom = true;
        }}
      >
        {zoom}%
      </button>
    {/if}
  </div>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-3);
    padding: 0 var(--yaz-space-3);
    block-size: 1.75rem;
    background: var(--yaz-bg-secondary);
    border-block-start: 1px solid var(--yaz-border);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    flex: none;
  }

  .spacer {
    flex: 1;
  }

  .item {
    white-space: nowrap;
  }

  .mode {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    padding: 1px var(--yaz-space-2);
    cursor: pointer;
  }

  .mode:hover {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .mode.on {
    color: var(--yaz-accent);
  }

  .compile {
    color: var(--yaz-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    max-inline-size: 32rem;
  }

  .compile.failed {
    color: var(--yaz-error);
  }

  .health {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0 var(--yaz-space-1);
    cursor: pointer;
  }

  .dot {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 999px;
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

  .zoom {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
  }

  input[type="range"] {
    inline-size: 7rem;
    accent-color: var(--yaz-accent);
  }

  .percent {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    min-inline-size: 3rem;
    text-align: end;
  }

  .percent:hover {
    color: var(--yaz-text-primary);
  }

  .percent-input {
    inline-size: 3.5rem;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-accent);
    border-radius: var(--yaz-radius-sm);
    padding: 0 var(--yaz-space-1);
    text-align: end;
  }

  select {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    cursor: pointer;
  }

  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
