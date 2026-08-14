<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import PdfView from "./lib/PdfView.svelte";
  import { t } from "./lib/i18n";
  import * as ipc from "./lib/ipc";

  /**
   * The editor is loaded when a file is first opened, not at startup.
   *
   * CodeMirror plus the Vim keymap is the largest thing left in the initial
   * bundle, and until a document is open there is nothing for it to do. The
   * window that appears before that is a toolbar, a file list and two empty
   * panes.
   *
   * PdfView stays eagerly imported: it is a thin shell, and the heavy part
   * (pdf.js) does its own lazy load from inside.
   */
  let EditorComponent = $state<typeof import("./lib/Editor.svelte").default | null>(null);
  let editorLoadFailed = $state(false);

  let project = $state<ipc.ProjectInfo | null>(null);
  let currentFile = $state<string | null>(null);
  let docText = $state("");
  let dirty = $state(false);
  let busy = $state(false);
  let result = $state<ipc.CompileResult | null>(null);
  let pdfData = $state<Uint8Array | null>(null);
  let vimMode = $state(false);
  let failure = $state<string | null>(null);
  let engines = $state<ipc.EngineInfo[]>([]);
  let selectedEngine = $state<string | null>(null);

  const selectedEngineInfo = $derived(engines.find((e) => e.id === selectedEngine) ?? null);

  const errorCount = $derived(
    result?.diagnostics.filter((d) => d.severity === "error").length ?? 0,
  );

  // Reported once, after mount, so the startup budget is measured against the
  // moment the UI is actually usable rather than when the window appeared.
  $effect(() => {
    void ipc.reportReady().catch(() => {
      /* measurement only; never worth surfacing to the user */
    });
    void ipc
      .listEngines()
      .then((found) => {
        engines = found;
      })
      .catch((error) => {
        failure = String(error);
      });
  });

  async function chooseEngine(id: string) {
    if (!project) return;
    selectedEngine = id;
    try {
      await ipc.setProjectEngine(project.root, id);
    } catch (error) {
      failure = String(error);
    }
  }

  async function chooseProject() {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    failure = null;
    try {
      const info = await ipc.openProject(picked);
      project = info;
      result = null;
      pdfData = null;
      const settings = await ipc.getProjectSettings(info.root);
      // No stored choice means "whatever this machine has"; show the first
      // available engine rather than an empty picker.
      selectedEngine = settings.engineId ?? engines.find((e) => e.available)?.id ?? null;
      await openFile(info.entry);
    } catch (error) {
      failure = String(error);
    }
  }

  async function ensureEditorLoaded() {
    if (EditorComponent || editorLoadFailed) return;
    try {
      EditorComponent = (await import("./lib/Editor.svelte")).default;
    } catch (error) {
      // A failed chunk load leaves the pane empty forever otherwise, with no
      // clue why. Better to say so than to look merely broken.
      editorLoadFailed = true;
      failure = String(error);
    }
  }

  async function openFile(relativePath: string) {
    if (!project) return;
    void ensureEditorLoaded();
    try {
      docText = await ipc.readFile(project.root, relativePath);
      currentFile = relativePath;
      dirty = false;
    } catch (error) {
      failure = String(error);
    }
  }

  async function save() {
    if (!project || !currentFile || !dirty) return;
    await ipc.writeFile(project.root, currentFile, docText);
    dirty = false;
  }

  async function compile() {
    if (!project || busy) return;
    busy = true;
    failure = null;
    try {
      await save();
      const outcome = await ipc.compile(project.root);
      result = outcome;
      // A PDF can exist even when the compile reported errors, so this is keyed
      // off the artefact rather than off `succeeded`.
      pdfData = outcome.pdfPath ? await ipc.readArtefact(outcome.pdfPath) : null;
    } catch (error) {
      failure = String(error);
    } finally {
      busy = false;
    }
  }
</script>

<div class="app">
  <header class="toolbar">
    <button onclick={chooseProject}>{t("workspace-open-project")}</button>
    <button onclick={compile} disabled={!project || busy}>
      {busy ? t("compile-running") : t("compile-run")}
    </button>
    <label class="toggle">
      <input type="checkbox" bind:checked={vimMode} />
      {t("editor-vim-mode")}
    </label>

    <label class="engine" title={t("settings-engine-help")}>
      {t("settings-engine")}
      <select
        disabled={!project}
        value={selectedEngine ?? ""}
        onchange={(event) => chooseEngine((event.currentTarget as HTMLSelectElement).value)}
      >
        {#each engines as engine (engine.id)}
          <!-- Unavailable engines stay visible but unselectable. Hiding them
               would leave someone hunting for an engine the docs promised. -->
          <option value={engine.id} disabled={!engine.available}>
            {engine.label}{#if !engine.available} — {t("engine-unavailable-suffix")}{/if}
          </option>
        {/each}
      </select>
    </label>

    {#if selectedEngineInfo && !selectedEngineInfo.available && selectedEngineInfo.unavailableReasonKey}
      <span class="warn">{t(selectedEngineInfo.unavailableReasonKey)}</span>
    {/if}

    <span class="spacer"></span>
    {#if project}
      <span class="path" title={project.root}>{project.root}</span>
    {/if}
  </header>

  <div class="body">
    <nav class="files">
      {#if !project}
        <p class="empty">{t("workspace-no-project")}</p>
      {:else if project.files.length === 0}
        <p class="empty">{t("workspace-no-files")}</p>
      {:else}
        <ul>
          {#each project.files as file (file.relativePath)}
            <li>
              <button
                class="file"
                class:active={file.relativePath === currentFile}
                onclick={() => openFile(file.relativePath)}
              >
                {file.relativePath}{#if file.isEntry}<span class="badge">{t("workspace-entry")}</span
                  >{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </nav>

    <main class="editor-pane">
      {#if currentFile && EditorComponent}
        <EditorComponent
          doc={docText}
          docId={currentFile}
          vimMode={vimMode}
          onChange={(text) => {
            docText = text;
            dirty = true;
          }}
          onSave={save}
        />
      {:else if currentFile}
        <p class="empty">{t("editor-loading")}</p>
      {:else}
        <p class="empty">{t("workspace-no-file-open")}</p>
      {/if}
    </main>

    <aside class="pdf-pane">
      <PdfView data={pdfData} />
    </aside>
  </div>

  <footer class="status">
    {#if failure}
      <span class="error">{failure}</span>
    {:else if result}
      <span class={result.succeeded ? "ok" : "error"}>
        {result.succeeded
          ? t("compile-succeeded", { seconds: (result.elapsedMs / 1000).toFixed(1) })
          : t("compile-failed")}
      </span>
      <span class="muted">{result.engineId}</span>
      {#if errorCount > 0}
        <span class="muted">{t("compile-diagnostics-count", { count: errorCount })}</span>
      {/if}
    {:else}
      <span class="muted">{t("app-tagline")}</span>
    {/if}
    <span class="spacer"></span>
    {#if currentFile}
      <span class="muted">{currentFile}{dirty ? " •" : ""}</span>
    {/if}
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    block-size: 100vh;
    background: var(--yaz-bg-primary);
    color: var(--yaz-text-primary);
    font-family: var(--yaz-font-ui);
    font-size: var(--yaz-font-size-base);
  }

  .toolbar,
  .status {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-3);
    padding-inline: var(--yaz-space-3);
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
  }

  .toolbar {
    padding-block: var(--yaz-space-2);
  }

  .status {
    border-block-end: none;
    border-block-start: 1px solid var(--yaz-border);
    padding-block: var(--yaz-space-1);
    font-size: 0.85em;
  }

  .spacer {
    flex: 1;
  }

  button {
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .toggle,
  .engine {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-1);
    color: var(--yaz-text-secondary);
  }

  select {
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    padding: var(--yaz-space-1) var(--yaz-space-2);
  }

  select:disabled {
    opacity: 0.5;
  }

  .warn {
    color: var(--yaz-warning);
    font-size: 0.85em;
    max-inline-size: 24rem;
  }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 15rem 1fr 1fr;
    min-block-size: 0;
  }

  .files {
    overflow: auto;
    background: var(--yaz-bg-secondary);
    border-inline-end: 1px solid var(--yaz-border);
  }

  .files ul {
    list-style: none;
    margin: 0;
    padding: var(--yaz-space-2);
  }

  .file {
    inline-size: 100%;
    text-align: start;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-1) var(--yaz-space-2);
    color: var(--yaz-text-secondary);
    font-family: var(--yaz-font-mono);
    font-size: 0.9em;
  }

  .file.active {
    background: var(--yaz-bg-active);
    color: var(--yaz-text-primary);
  }

  .badge {
    margin-inline-start: var(--yaz-space-2);
    color: var(--yaz-accent);
    font-size: 0.85em;
  }

  .editor-pane {
    min-inline-size: 0;
    overflow: hidden;
    border-inline-end: 1px solid var(--yaz-border);
  }

  .pdf-pane {
    min-inline-size: 0;
    overflow: hidden;
  }

  .empty {
    color: var(--yaz-text-muted);
    padding: var(--yaz-space-4);
    margin: 0;
  }

  .ok {
    color: var(--yaz-success);
  }

  .error {
    color: var(--yaz-error);
  }

  .muted {
    color: var(--yaz-text-muted);
  }

  .path {
    color: var(--yaz-text-muted);
    font-family: var(--yaz-font-mono);
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-inline-size: 30rem;
    direction: rtl;
  }
</style>
