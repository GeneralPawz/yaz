<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import type { EditorApi } from "@yaz/api";
  import MenuBar, { type Menu } from "./lib/MenuBar.svelte";
  import Settings, { type Section } from "./lib/Settings.svelte";
  import StatusLight, { type Health } from "./lib/StatusLight.svelte";
  import PdfView from "./lib/PdfView.svelte";
  import Picker from "./lib/Picker.svelte";
  import { t } from "./lib/i18n";
  import * as ipc from "./lib/ipc";
  import { PluginRuntime, type PickerRequest } from "./lib/plugins/host";
  import ZoteroPlugin from "../../../plugins/zotero/src/main";

  /** The plugin the shell asks about connection status on the user's behalf. */
  const ZOTERO_PLUGIN_ID = "com.yaz.zotero";

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

  let editorApi: EditorApi | null = null;
  let picker = $state<PickerRequest | null>(null);
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  let zoteroStatus = $state<ipc.ZoteroStatus | null>(null);
  let connectionsBusy = $state(false);
  let settingsOpen = $state(false);
  let settingsSection = $state<string | undefined>(undefined);
  let enginesLoaded = $state(false);

  /**
   * What the status light shows.
   *
   * `unknown` is a real state, not a placeholder: nothing connects at startup
   * any more, so until the user asks, yaz genuinely does not know. Painting it
   * green or red would be a guess presented as a fact.
   */
  const health = $derived<Health>(
    !zoteroStatus
      ? "unknown"
      : zoteroStatus.source === "none"
        ? "off"
        : // Green when Zotero is running, even though queries read a copy of
          // the database: the copy is refreshed from a file Zotero is actively
          // maintaining, so the data is current. Amber means the library is
          // readable but nothing is keeping it up to date.
          zoteroStatus.zoteroRunning
          ? "live"
          : "degraded",
  );

  const healthKey = $derived(
    !zoteroStatus
      ? "connections-unknown"
      : zoteroStatus.zoteroRunning
        ? "zotero-live-available"
        : zoteroStatus.sourceKey,
  );

  /**
   * Detect the installed TeX engines.
   *
   * Deliberately not at startup. Each engine is detected by running it, and a
   * system TeX on this platform is usually x86-64 under emulation — four probes
   * cost over two seconds and flashed a console window each. Nothing needs the
   * answer until the settings dialog is opened.
   */
  async function loadEngines() {
    if (enginesLoaded) return;
    try {
      engines = await ipc.listEngines();
      enginesLoaded = true;
      if (project && !selectedEngine) {
        const settings = await ipc.getProjectSettings(project.root);
        selectedEngine = settings.engineId ?? engines.find((e) => e.available)?.id ?? null;
      }
    } catch (error) {
      failure = String(error);
    }
  }

  function openSettings(section?: string) {
    settingsSection = section;
    settingsOpen = true;
    void loadEngines();
  }

  /**
   * Connect to Zotero, or re-probe if already connected.
   *
   * The only thing that starts a connection. Nothing probes on startup, so a
   * user who never cites never pays for Zotero being looked for.
   */
  async function connectZotero() {
    connectionsBusy = true;
    try {
      if (zoteroStatus) await ipc.zoteroReconnect(ZOTERO_PLUGIN_ID);
      zoteroStatus = await ipc.zoteroStatus(ZOTERO_PLUGIN_ID);
      showNotice(t(zoteroStatus.liveStatusKey));
    } catch (error) {
      failure = String(error);
    } finally {
      connectionsBusy = false;
    }
  }

  function notImplemented() {
    showNotice(t("menu-not-implemented"));
  }

  function showNotice(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  /**
   * The plugin runtime.
   *
   * Core plugins are bundled, but they see only `@yaz/api` and every privileged
   * call they make is refused by the capability broker in the Rust process
   * first. That is the forcing function in ADR-0005 — the Zotero bridge gets no
   * shortcut the shell would not give an external author.
   */
  const runtime = new PluginRuntime({
    project: () => (project ? { root: project.root, entry: project.entry } : null),
    editor: () => editorApi,
    compile: async () => {
      await compile();
      if (!result) throw new Error("compile produced no result");
      return result;
    },
    requestPicker: (request) => {
      picker = request;
    },
    showNotice,
  });

  let commands = $state<ReturnType<PluginRuntime["availableCommands"]>>([]);

  function refreshCommands() {
    commands = runtime.availableCommands();
  }

  async function runCommand(id: string) {
    const command = runtime.commands.find((c) => c.id === id);
    if (!command) return;
    try {
      await command.callback();
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * The menu bar.
   *
   * Plugin commands land under Tools rather than in the toolbar, so a plugin can
   * contribute a command without the shell growing a button for it — and without
   * the shell knowing what the command does.
   */
  const menus = $derived<Menu[]>([
    {
      labelKey: "menu-file",
      items: [
        { labelKey: "menu-file-open-folder", action: chooseProject },
        {
          labelKey: "menu-file-save",
          action: save,
          disabled: !currentFile || !dirty,
        },
        {
          labelKey: "menu-file-compile",
          action: compile,
          disabled: !project || busy,
          separatorBefore: true,
        },
        {
          labelKey: "menu-file-close-project",
          action: closeProject,
          disabled: !project,
          separatorBefore: true,
        },
      ],
    },
    {
      labelKey: "menu-edit",
      items: [
        { labelKey: "menu-edit-undo", action: notImplemented, disabled: true },
        { labelKey: "menu-edit-redo", action: notImplemented, disabled: true },
        {
          labelKey: "menu-edit-find",
          action: notImplemented,
          disabled: true,
          separatorBefore: true,
        },
        {
          labelKey: "menu-edit-settings",
          action: () => openSettings("engine"),
          separatorBefore: true,
        },
      ],
    },
    {
      labelKey: "menu-view",
      items: [
        {
          labelKey: "menu-view-vim",
          checked: vimMode,
          action: () => {
            vimMode = !vimMode;
          },
        },
      ],
    },
    {
      labelKey: "menu-tools",
      items: [
        ...commands.map((command) => ({
          labelKey: command.nameKey,
          action: () => runCommand(command.id),
        })),
        {
          labelKey: "menu-tools-connections",
          separatorBefore: commands.length > 0,
          // A flyout rather than a dialog: connecting is one click, and the
          // detail belongs next to the thing it describes.
          items: [
            {
              labelKey: zoteroStatus ? "connections-reconnect-zotero" : "connections-connect-zotero",
              dot: health,
              disabled: connectionsBusy,
              action: connectZotero,
            },
            {
              labelKey: "connections-obsidian",
              dot: "unknown" as const,
              disabled: true,
              action: notImplemented,
            },
          ],
        },
      ],
    },
    {
      labelKey: "menu-help",
      items: [
        { labelKey: "menu-help-documentation", action: notImplemented, disabled: true },
        { labelKey: "menu-help-report-issue", action: notImplemented, disabled: true },
        {
          labelKey: "menu-help-about",
          action: notImplemented,
          disabled: true,
          separatorBefore: true,
        },
      ],
    },
  ]);

  /**
   * What the title bar shows.
   *
   * The folder name rather than the full path: the path was a long absolute
   * string across the top of the window, and the useful part is the last
   * segment.
   */
  const windowTitle = $derived.by(() => {
    if (!project) return "";
    // The folder name, not the path and not the product name. The window
    // already says which application it is; repeating it in the title bar of
    // that application spends the only line there is.
    return project.root.replace(/[\/]+$/, "").split(/[\/]/).pop() ?? "";
  });

  const selectedEngineInfo = $derived(engines.find((e) => e.id === selectedEngine) ?? null);

  /**
   * The settings dialog's contents.
   *
   * The engine choice lives here rather than in the toolbar: it is set once per
   * project and then not touched, which is the definition of a setting rather
   * than a control.
   */
  const settingsSections = $derived<Section[]>([
    {
      id: "general",
      labelKey: "settings-section-general",
      glyph: "⚙",
      groups: [
        {
          titleKey: "settings-group-editor",
          fields: [
            {
              kind: "toggle",
              labelKey: "menu-view-vim",
              helpKey: "settings-vim-help",
              value: vimMode,
              onchange: (value) => (vimMode = value),
            },
          ],
        },
      ],
    },
    {
      id: "engine",
      labelKey: "settings-section-engine",
      glyph: "⌘",
      groups: [
        {
          titleKey: "settings-group-typesetting",
          fields: [
            {
              kind: "select",
              labelKey: "settings-engine",
              helpKey: "settings-engine-help",
              value: selectedEngine ?? "",
              options: engines.map((engine) => ({
                value: engine.id,
                // Unavailable engines stay listed but unselectable. Hiding one
                // leaves somebody hunting for an engine the docs promised.
                label: engine.available
                  ? engine.label
                  : `${engine.label} — ${t("engine-unavailable-suffix")}`,
                disabled: !engine.available,
              })),
              onchange: (value) => void chooseEngine(value),
              warningKey:
                selectedEngineInfo && !selectedEngineInfo.available
                  ? (selectedEngineInfo.unavailableReasonKey ?? undefined)
                  : undefined,
            },
            ...(project ? [] : [{ kind: "note" as const, labelKey: "settings-engine-no-project" }]),
          ],
        },
      ],
    },
    {
      id: "connections",
      labelKey: "settings-section-connections",
      glyph: "⇄",
      groups: [
        {
          titleKey: "connections-zotero",
          // Notes rather than controls: connecting is a menu action, and this
          // is where the detail behind the status light lives — which source is
          // answering, where it was found, and what to do about it.
          fields: [
            {
              kind: "note",
              labelKey: zoteroStatus ? zoteroStatus.liveStatusKey : "connections-unknown",
            },
            ...(zoteroStatus ? [{ kind: "note" as const, labelKey: zoteroStatus.sourceKey }] : []),
            ...(zoteroStatus?.liveStatusKey === "zotero-live-api-disabled"
              ? [{ kind: "note" as const, labelKey: "zotero-live-api-disabled-help" }]
              : []),
            ...(zoteroStatus?.wasDemoted
              ? [{ kind: "note" as const, labelKey: "zotero-demoted" }]
              : []),
            ...(zoteroStatus && !zoteroStatus.keysAreAuthoritative && zoteroStatus.source !== "none"
              ? [{ kind: "note" as const, labelKey: "zotero-keys-generated" }]
              : []),
          ],
        },
        {
          titleKey: "connections-obsidian",
          fields: [{ kind: "note", labelKey: "connections-not-configured" }],
        },
      ],
    },
  ]);

  function closeProject() {
    project = null;
    currentFile = null;
    docText = "";
    result = null;
    pdfData = null;
    void ipc.pluginSetProject(null);
  }

  const errorCount = $derived(
    result?.diagnostics.filter((d) => d.severity === "error").length ?? 0,
  );

  // Reported once, after mount, so the startup budget is measured against the
  // moment the UI is actually usable rather than when the window appeared.
  $effect(() => {
    void ipc.reportReady().catch(() => {
      /* measurement only; never worth surfacing to the user */
    });
    // Engines are NOT detected here. Detection runs each engine to see whether
    // it exists, and a system TeX on Windows-on-ARM is x86-64 under emulation:
    // four probes cost over two seconds and flashed a console window each.
    // The settings dialog asks for them when it opens, which is the first
    // moment anyone needs the answer.
    //
    // Zotero is not contacted here either. Nothing connects until the user
    // asks, so a session that never cites anything never looks for a library.

    // Plugins load after the first paint, not before it. The window is usable
    // without them, and blocking startup on a plugin would spend the budget in
    // ADR-0015 on something the user has not asked for yet.
    void runtime
      .start({ [ZOTERO_PLUGIN_ID]: ZoteroPlugin })
      .then(refreshCommands)
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
      // Filesystem capabilities are scoped to the open project, so the brokers
      // have to be told. Without this a plugin keeps writing into whichever
      // project was open when it loaded.
      await ipc.pluginSetProject(info.root);
      result = null;
      pdfData = null;
      // The stored choice only. Resolving "no choice" to the first *available*
      // engine would need the engine probe, and that is exactly what has been
      // moved off the startup path; the settings dialog resolves it when opened.
      const settings = await ipc.getProjectSettings(info.root);
      selectedEngine = settings.engineId;
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
  <!-- The window is undecorated, so this row is the title bar. The project
       name lives here, which is where a title bar puts it — and is why the
       long absolute path came out of the toolbar. -->
  <MenuBar {menus} title={windowTitle} />

  <header class="toolbar">
    <button onclick={compile} disabled={!project || busy}>
      {busy ? t("compile-running") : t("compile-run")}
    </button>

    <span class="spacer"></span>

    <!-- Something to glance at, not something to operate: the detail lives in
         Tools > Connections. -->
    <StatusLight {health} labelKey={healthKey} onclick={connectZotero} />
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
          onReady={(api) => {
            editorApi = api;
            refreshCommands();
          }}
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

  {#if picker}
    <Picker
      titleKey={picker.titleKey}
      placeholderKey={picker.placeholderKey}
      emptyKey={picker.emptyKey}
      load={picker.load}
      onchoose={(value) => {
        const pending = picker;
        picker = null;
        pending?.resolve(value);
      }}
      oncancel={() => {
        const pending = picker;
        picker = null;
        // Resolving with undefined is how `ui.pick` reports a dismissal, so a
        // plugin awaiting it is never left hanging.
        pending?.resolve(undefined);
      }}
    />
  {/if}

  {#if settingsOpen}
    <Settings
      sections={settingsSections}
      initial={settingsSection}
      onclose={() => (settingsOpen = false)}
    />
  {/if}

  {#if notice}
    <output class="notice">{notice}</output>
  {/if}

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

  .notice {
    position: fixed;
    inset-block-end: var(--yaz-space-8);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-4);
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    z-index: 110;
  }

</style>
