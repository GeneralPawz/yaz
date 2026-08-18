<!--
  The title bar.

  The window is undecorated, so this row *is* the title bar and owes the user
  everything the system bar was providing: dragging, double-click to maximise,
  and the three buttons.

  # What else lives here

  The menus have gone to the ribbon. What is left is the handful of things you
  reach for without thinking about which part of the application they belong
  to — save, undo, redo, find — plus the switch for whether saving happens by
  itself. They are here rather than in the ribbon for the same reason a car
  puts the indicator stalk on the column and the radio in the dashboard: not
  everything belongs in the same place just because it is a control.

  The avatar is a stub and is drawn as one. There is no account, no
  synchronisation and no sign-in; it holds the space where those would go so
  that adding them later does not move everything else.
-->
<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { t } from "./i18n";

  interface Props {
    /** Shown in the middle, where a title bar puts it. */
    title: string;
    /** Whether there is anything to save. */
    dirty: boolean;
    canSave: boolean;
    onsave: () => void;
    /** Whether saving happens by itself. */
    autosave: boolean;
    onautosave: (on: boolean) => void;
    onundo: () => void;
    onredo: () => void;
    /** What is in the search box. */
    search: string;
    onsearch: (value: string) => void;
  }

  let {
    title,
    dirty,
    canSave,
    onsave,
    autosave,
    onautosave,
    onundo,
    onredo,
    search,
    onsearch,
  }: Props = $props();

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
    let stop: (() => void) | undefined;
    void appWindow
      .onResized(() => void syncMaximized())
      .then((unlisten) => (stop = unlisten))
      .catch(() => {});
    return () => stop?.();
  });
</script>

<header class="bar">
  <span class="logo" aria-hidden="true">y</span>

  <div class="tools">
    <!-- Saving by itself is a mode, so it is a toggle that shows which state
         it is in rather than what it would do. -->
    <button
      type="button"
      class="tool"
      class:on={autosave}
      title={t(autosave ? "titlebar-autosave-on" : "titlebar-autosave-off")}
      aria-label={t(autosave ? "titlebar-autosave-on" : "titlebar-autosave-off")}
      aria-pressed={autosave}
      onclick={() => onautosave(!autosave)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.5a5.5 5.5 0 103.9 1.6" />
        <path d="M12 1v3.2H8.8" />
      </svg>
    </button>

    <button
      type="button"
      class="tool"
      class:dirty
      disabled={!canSave}
      title={t("menu-file-save")}
      aria-label={t("menu-file-save")}
      onclick={onsave}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 3h7.5L13 5.5V13H3zM5.5 3v3.5h5V3M5.5 13V9h5v4" />
      </svg>
    </button>

    <button
      type="button"
      class="tool"
      title={t("menu-edit-undo")}
      aria-label={t("menu-edit-undo")}
      onclick={onundo}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 5.5H10a3 3 0 010 6H6M6 5.5L8.5 3M6 5.5L8.5 8" />
      </svg>
    </button>

    <button
      type="button"
      class="tool"
      title={t("menu-edit-redo")}
      aria-label={t("menu-edit-redo")}
      onclick={onredo}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10 5.5H6a3 3 0 000 6h4M10 5.5L7.5 3M10 5.5L7.5 8" />
      </svg>
    </button>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <h1 class="drag" data-tauri-drag-region ondblclick={() => appWindow.toggleMaximize()}>
    <span class="title-text" data-tauri-drag-region>{title}</span>
  </h1>

  <label class="search">
    <span class="visually-hidden">{t("menu-edit-find")}</span>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5L14 14" />
    </svg>
    <input
      type="search"
      value={search}
      placeholder={t("titlebar-search")}
      oninput={(event) => onsearch(event.currentTarget.value)}
    />
  </label>

  <!-- A stub, and drawn as one: there is no account behind it. It holds the
       space so that adding one later does not move everything else. -->
  <button type="button" class="avatar" title={t("titlebar-account")} aria-label={t("titlebar-account")}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="6" r="2.6" />
      <path d="M3 14a5 5 0 0110 0" />
    </svg>
  </button>

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
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    block-size: 2rem;
    padding-inline-start: var(--yaz-space-2);
    background: var(--yaz-bg-tertiary);
    border-block-end: 1px solid var(--yaz-border);
    flex: none;
    user-select: none;
  }

  .logo {
    font-family: var(--yaz-font-prose);
    font-size: 1rem;
    font-weight: 700;
    color: var(--yaz-accent);
    inline-size: 1.25rem;
    text-align: center;
  }

  .tools {
    display: flex;
    gap: 2px;
  }

  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    color: var(--yaz-text-muted);
    cursor: pointer;
  }

  .tool svg {
    inline-size: 0.8125rem;
    block-size: 0.8125rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .tool:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tool.on {
    color: var(--yaz-accent);
  }

  /* Unsaved work is worth one dot, not a dialogue. */
  .tool.dirty {
    color: var(--yaz-warning);
  }

  .drag {
    flex: 1;
    margin: 0;
    text-align: center;
    font-size: var(--yaz-font-size-sm);
    font-weight: 400;
    color: var(--yaz-text-muted);
    block-size: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-1);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: 0 var(--yaz-space-2);
    color: var(--yaz-text-muted);
  }

  .search svg {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    flex: none;
  }

  .search input {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: none;
    border: none;
    outline: none;
    inline-size: 10rem;
    padding: 2px 0;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    padding: 0;
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: 999px;
    color: var(--yaz-text-muted);
    cursor: pointer;
  }

  .avatar svg {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }

  .avatar:hover {
    color: var(--yaz-text-primary);
  }

  .controls {
    display: flex;
    margin-inline-start: var(--yaz-space-2);
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 2.75rem;
    block-size: 2rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--yaz-text-secondary);
    cursor: pointer;
  }

  .control svg {
    inline-size: 0.625rem;
    block-size: 0.625rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
  }

  .control:hover {
    background: var(--yaz-bg-hover);
    color: var(--yaz-text-primary);
  }

  .control.close:hover {
    background: var(--yaz-error);
    color: var(--yaz-text-on-accent);
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
