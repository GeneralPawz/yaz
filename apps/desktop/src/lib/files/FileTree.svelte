<!--
  The project's files.

  # Why it shows everything

  It used to show four extensions. A real project has images the author wants
  to look at, a `.bib` they open, and a compiled PDF they double-click — and a
  file list that disagrees with the folder means keeping a file manager open
  beside it, which rather defeats the point of having one.

  So the scan returns everything and the deciding happens here, where the
  switches are: dotted folders, build artefacts and unfamiliar formats each
  have one under View.

  # Dimming rather than hiding

  A LaTeX run leaves thirty files next to the two being worked on. Hiding them
  is a setting; *dimming* them is the default, because they are still there,
  the author still occasionally wants one, and a list that quietly omits things
  is a list you cannot trust to tell you what is in the folder.
-->
<script lang="ts">
  import { t } from "../i18n";
  import type { FileKind, Node } from "./tree";

  interface Props {
    /** The rows to draw, already flattened and filtered. */
    rows: Node[];
    /** Which folders are open. */
    open: ReadonlySet<string>;
    /** The file being edited. */
    current: string | null;
    /** Whether build artefacts are drawn quietly. */
    dimBuild: boolean;
    ontoggle: (path: string) => void;
    onopen: (path: string) => void;
  }

  let { rows, open, current, dimBuild, ontoggle, onopen }: Props = $props();

  /**
   * One drawing per kind of file.
   *
   * Enough to tell a source from a picture at a glance and no more: an icon
   * per extension is a legend to learn, and the point of an icon is to save
   * reading rather than to add something else to read.
   */
  const ICONS: Record<FileKind | "folder" | "folder-open", string> = {
    folder: "M2 4h4l1.2 1.5H14V13H2z",
    "folder-open": "M2 13V4h4l1.2 1.5H14v2H4.5L2.5 13z",
    // A page with a corner turned, which every one of these is a variant of.
    tex: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3M5.8 7.5h4.4M8 7.5v4",
    bib: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3M6 8h4M6 10.5h4",
    style: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3M6.5 9.5a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0",
    pdf: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3M5.8 11.5V8h1.4a1 1 0 010 2H5.8M9.2 11.5V8h1.2",
    image: "M2.5 3h11v10h-11zM2.5 10l3-3 2.5 2.5L11 6l2.5 2.5M5.5 6a.8.8 0 100 .01",
    // The gears of the toolchain rather than a page: what is in these is not
    // for reading.
    build: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3M8 8.4a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8M8 7v1M8 11.6v1M6.4 8.6l.7.7M8.9 11l.7.7M5.6 9.8h1M9.4 9.8h1",
    other: "M4 1.5h5L12 4.5V14.5H4zM9 1.5v3h3",
  };

  /** What a row is called, for a screen reader. */
  function describe(node: Node): string {
    return node.type === "folder"
      ? t(open.has(node.path) ? "files-collapse" : "files-expand", { name: node.name })
      : node.name;
  }
</script>

<ul class="tree">
  {#each rows as node (node.path)}
    <li>
      <button
        type="button"
        class="row {node.type}"
        class:active={node.type === "file" && node.path === current}
        class:entry={node.type === "file" && node.isEntry}
        class:muted={node.hidden || (dimBuild && node.type === "file" && node.kind === "build")}
        style:padding-inline-start="calc(var(--yaz-space-2) + {node.depth} * 0.75rem)"
        aria-expanded={node.type === "folder" ? open.has(node.path) : undefined}
        aria-label={describe(node)}
        onclick={() => (node.type === "folder" ? ontoggle(node.path) : onopen(node.path))}
      >
        <span class="twist" aria-hidden="true">
          {#if node.type === "folder"}{open.has(node.path) ? "▾" : "▸"}{/if}
        </span>

        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path
              d={node.type === "folder"
                ? ICONS[open.has(node.path) ? "folder-open" : "folder"]
                : ICONS[node.kind]}
            />
          </svg>
        </span>

        <span class="name">{node.name}</span>

        {#if node.type === "file" && node.isEntry}
          <span class="badge">{t("workspace-entry")}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>

<style>
  .tree {
    margin: 0;
    padding: var(--yaz-space-1) 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-1);
    inline-size: 100%;
    text-align: start;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    padding-block: 2px;
    padding-inline-end: var(--yaz-space-2);
    cursor: pointer;
  }

  .row:hover {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .row.active {
    background: var(--yaz-bg-active);
    color: var(--yaz-text-primary);
  }

  /* The document the compiler starts from, which is the one file in a project
     of forty that everything else hangs off. */
  .row.entry .name {
    font-weight: 600;
  }

  /* Still there, still clickable, just not competing. */
  .row.muted {
    opacity: 0.45;
  }

  .row.muted:hover {
    opacity: 1;
  }

  .twist {
    inline-size: 0.6rem;
    font-size: 0.6rem;
    color: var(--yaz-text-muted);
    flex: none;
  }

  .icon {
    inline-size: 0.875rem;
    block-size: 0.875rem;
    flex: none;
    display: inline-flex;
    color: var(--yaz-text-muted);
  }

  .icon svg {
    inline-size: 100%;
    block-size: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The kinds worth picking out of a folder at a glance. */
  .row.folder .icon {
    color: var(--yaz-accent);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    margin-inline-start: auto;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--yaz-text-muted);
  }
</style>
