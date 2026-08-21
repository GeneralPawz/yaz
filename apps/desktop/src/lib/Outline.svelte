<!--
  The document's headings, as a workspace tab.

  Derived from the buffer rather than kept alongside it: there is one document
  (ADR-0004), so an outline that could disagree with the source would be a second
  model of the same thing.

  Clicking a heading moves the editor there. The outline is for navigating a long
  document, which is the only thing it is for — it does not rename, reorder or
  renumber anything, because each of those is a text edit the author can make
  where the text is.
-->
<script lang="ts">
  import { t } from "./i18n";
  import { headings, plainText, type Heading } from "./editor/structure";

  interface Props {
    /** The buffer contents. */
    doc: string;
    /** Which file this is, shown when there is nothing to outline. */
    file: string | null;
    /** Caret position, used to mark where the reader is. */
    cursor: number;
    onnavigate: (heading: Heading) => void;
  }

  let { doc, file, cursor, onnavigate }: Props = $props();

  const found = $derived(headings(doc));

  /**
   * The heading the caret is inside: the last one that starts before it.
   *
   * A section owns everything until the next heading, whatever its level, so
   * this is a scan rather than a tree walk.
   */
  const current = $derived.by(() => {
    let index = -1;
    found.forEach((heading, at) => {
      if (heading.from <= cursor) index = at;
    });
    return index;
  });
</script>

<div class="outline">
  {#if !file}
    <p class="empty">{t("workspace-no-file-open")}</p>
  {:else if found.length === 0}
    <p class="empty">{t("outline-empty")}</p>
  {:else}
    <ul>
      {#each found as heading, index (heading.from)}
        <li>
          <button
            type="button"
            class="heading"
            class:current={index === current}
            style:padding-inline-start="calc(var(--yaz-space-2) + {heading.level} * 0.75rem)"
            onclick={() => onnavigate(heading)}
          >
            <span class="text" class:starred={heading.starred}>
              {plainText(heading.title) || t("outline-untitled")}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .outline {
    block-size: 100%;
    overflow-y: auto;
    background: var(--yaz-bg-primary);
  }

  .empty {
    padding: var(--yaz-space-4);
    margin: 0;
    color: var(--yaz-text-muted);
  }

  ul {
    margin: 0;
    padding: var(--yaz-space-2) 0;
    list-style: none;
  }

  .heading {
    inline-size: 100%;
    text-align: start;
    font: inherit;
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-inline-start: 2px solid transparent;
    padding-block: var(--yaz-space-1);
    padding-inline-end: var(--yaz-space-3);
    cursor: pointer;
  }

  .heading:hover {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  /* Where the caret is, so a long document says where you are in it. */
  .heading.current {
    border-inline-start-color: var(--yaz-accent);
    color: var(--yaz-text-primary);
  }

  .text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Unnumbered sections read differently in the document, so they do here. */
  .starred {
    font-style: italic;
  }
</style>
