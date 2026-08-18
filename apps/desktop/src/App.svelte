<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import type { EditorApi } from "@yaz/api";
  import type { Menu } from "./lib/MenuBar.svelte";
  import Ribbon, { type RibbonTab } from "./lib/Ribbon.svelte";
  import TitleBar from "./lib/TitleBar.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import { countWords } from "./lib/editor/wordCount";
  import {
    DEFAULT_PAPER,
    LANGUAGES,
    PAPER_DIMENSIONS,
    PAPER_SIZES,
    readProperties,
    setProperty,
  } from "./lib/editor/properties";
  import type { Properties } from "./lib/editor/properties";
  import Settings, { type Section } from "./lib/Settings.svelte";
  import type { Health } from "./lib/StatusLight.svelte";
  import History from "./lib/History.svelte";
  import Outline from "./lib/Outline.svelte";
  import type { Heading } from "./lib/editor/structure";
  import { LINE_NUMBERING } from "./lib/editor/lineNumbers";
  import { KeyDispatcher } from "./lib/keys/dispatcher";
  import {
    DEFAULT_PREFERENCES,
    SUITES,
    conflicts,
    describe as describeBinding,
    isOptional,
    resolve as resolveShortcuts,
  } from "./lib/keys/registry";
  import type { CommandId, KeyPreferences, SuiteId } from "./lib/keys/registry";
  import type { LineNumbering } from "./lib/editor/lineNumbers";
  import Prompt from "./lib/Prompt.svelte";
  import ThemeBuilder from "./lib/ThemeBuilder.svelte";
  import * as theming from "./lib/theme";
  import { setLocale, availableLocales, t } from "./lib/i18n";
  import Pane from "./lib/workspace/Pane.svelte";
  import * as layoutTree from "./lib/workspace/layout";
  import type { Node as LayoutNode, TabId } from "./lib/workspace/layout";
  import PdfView from "./lib/PdfView.svelte";
  import Picker from "./lib/Picker.svelte";
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
  /** How many pages the compiled PDF has, for the status bar. */
  let pdfPages = $state<number | null>(null);
  let vimMode = $state(false);
  /** Render the source as styled text. Same buffer, decorations only. */
  let richText = $state(false);
  /** Caret offset, so the outline can show where the reader is. */
  let cursor = $state(0);
  /**
   * How the gutter numbers lines.
   *
   * Absolute to begin with, because that is what a compiler error names. Prose
   * does not want numbers at all and Vim wants them relative, which is why
   * this is three states rather than a checkbox.
   */
  let numbering = $state<LineNumbering>("absolute");
  /**
   * Whether the file list is showing, and whether it stays showing.
   *
   * Pinned is the resting state: a file list you have to summon is a file list
   * you stop using. Unpinned it collapses to a strip and gives its width back
   * to the document, which is what a long writing session wants.
   */
  let filesPinned = $state(true);
  let filesOpen = $state(true);
  /** Whether the editor sets the text on a page rather than filling the pane. */
  let pageView = $state(false);
  /** How large the text is drawn, as a percentage. */
  let zoom = $state(100);
  /** Whether the ribbon's body shows, and which way it runs. */
  let ribbonOpen = $state(true);
  let ribbonVertical = $state(false);
  /** Whether saving happens by itself. */
  let autosave = $state(false);
  /** What is in the title bar's search box. */
  let search = $state("");

  /**
   * The standardised things the document declares.
   *
   * Read out of the source rather than held beside it: there is one document
   * and it is the `.tex` (ADR-0004), so a co-author who writes `\author{}` by
   * hand and one who uses the ribbon are editing the same thing.
   */
  const properties = $derived<Properties>(readProperties(docText));
  const paperSize = $derived(
    PAPER_DIMENSIONS[properties.paper] ?? PAPER_DIMENSIONS[DEFAULT_PAPER]!,
  );
  const wordCount = $derived(countWords(docText));

  /**
   * How the application looks and what language it speaks.
   *
   * Held here rather than read where it is needed, because a theme is one
   * attribute on the document and a language is a catalogue swap: both are
   * application-wide by nature, and threading them through components would
   * make every component care about something none of them decide.
   */
  let appearance = $state<ipc.Appearance>({
    theme: theming.BUNDLED_THEME,
    colourMode: "system",
    interfaceLocale: "en-US",
  });
  let themes = $state<ipc.ThemeInfo[]>([]);
  let buildingTheme = $state(false);

  /**
   * What the keyboard does.
   *
   * The registry declares every shortcut; this is only what the user changed —
   * suites switched off, bindings replaced. Kept whole rather than as a list of
   * bindings so that adding a shortcut in a later version reaches people who
   * have customised others.
   */
  let keyPreferences = $state<KeyPreferences>(DEFAULT_PREFERENCES);
  const shortcuts = $derived(resolveShortcuts(keyPreferences));
  const keyConflicts = $derived(conflicts(shortcuts));

  /** Put the chosen theme and mode on the document. */
  async function applyAppearance() {
    theming.applyAppearance(appearance.theme, appearance.colourMode);
    setLocale(appearance.interfaceLocale);
    try {
      theming.applyStylesheet(await ipc.themeStylesheet(appearance.theme));
    } catch {
      // A theme whose file has gone leaves the token defaults in place, which
      // is a working interface rather than an unstyled one.
      theming.applyStylesheet("");
    }
  }

  /** Store the appearance and put it into effect. */
  async function changeAppearance(next: Partial<ipc.Appearance>) {
    appearance = { ...appearance, ...next };
    await applyAppearance();
    try {
      await ipc.setAppearance(appearance);
    } catch (error) {
      failure = String(error);
    }
  }
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
  let recent = $state<ipc.RecentProject[]>([]);

  let vcs = $state<ipc.VcsStatus | null>(null);
  let vcsBackends = $state<ipc.VcsBackend[]>([]);
  let commits = $state<ipc.Commit[]>([]);
  let vcsBusy = $state(false);
  /** Set while the commit-message prompt is open. */
  let askingForMessage = $state(false);

  /** Refresh version-control state and history for the open project. */
  async function refreshVcs() {
    if (!project) {
      vcs = null;
      commits = [];
      return;
    }
    try {
      vcs = await ipc.vcsStatus(project.root);
      commits = vcs.enabled ? await ipc.vcsHistory(project.root) : [];
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Turn recording on or off.
   *
   * Off is a settings line: the repository and every recorded version stay
   * exactly where they are, and switching back on finds them.
   */
  async function toggleVcs() {
    if (!project) return;
    vcsBusy = true;
    try {
      vcs = vcs?.enabled
        ? await ipc.vcsDisable(project.root)
        : await ipc.vcsEnable(project.root, vcs?.backend ?? "git");
      commits = vcs.enabled ? await ipc.vcsHistory(project.root) : [];
      showNotice(t(vcs.enabled ? "vcs-recording" : "vcs-not-recording"));
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  /**
   * Record a version.
   *
   * `message` absent means "you describe it" — the backend generates one from
   * what changed. A message the author wrote is never overruled.
   */
  async function recordVersion(message?: string) {
    if (!project || !vcs?.enabled) return;
    vcsBusy = true;
    try {
      const commit = await ipc.vcsCommit(project.root, message);
      if (commit) {
        showNotice(t("vcs-committed", { id: commit.shortId }));
      }
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  async function restoreVersion(commit: ipc.Commit) {
    if (!project) return;
    vcsBusy = true;
    try {
      await ipc.vcsRestore(project.root, commit.id);
      showNotice(t("vcs-restored", { id: commit.shortId }));
      // The file on disk changed underneath the editor, so re-read it.
      if (currentFile) await openFile(currentFile);
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  /**
   * Jump to the source behind a point in the compiled PDF.
   *
   * The PDF is a rendering of the file being edited, so a click in it is a
   * question about the source — "what wrote this?" — and answering it is what
   * makes the two panes one document rather than two windows.
   *
   * A location in a file that is not the open one opens that file first. A
   * location outside the project is reported rather than silently ignored:
   * more often than not it is a package, and knowing that is the answer.
   */
  async function jumpToSource(page: number, x: number, y: number) {
    if (!project || !result?.synctexPath) return;
    try {
      const found = await ipc.locateInSource(project.root, result.synctexPath, page, x, y);
      if (!found) return;
      if (!found.inProject) {
        showNotice(t("synctex-outside-project", { path: found.path }));
        return;
      }
      if (found.path !== currentFile) await openFile(found.path);
      revealLine(found.line);
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Put the cursor on a line of the open document.
   *
   * Offsets rather than a line API because the buffer is the `.tex` in both
   * views (ADR-0004), so counting line breaks in the text the shell already
   * holds gives the same answer the editor would.
   */
  function revealLine(line: number) {
    let start = 0;
    for (let current = 1; current < line; current += 1) {
      const next = docText.indexOf("\n", start);
      if (next === -1) break;
      start = next + 1;
    }
    const end = docText.indexOf("\n", start);
    editorApi?.revealRange(start, end === -1 ? docText.length : end);
  }

  /**
   * Read the stored appearance before anything is painted.
   *
   * `system` has to keep following the system, so the change listener outlives
   * this: a machine that switches to dark at sunset should take the
   * application with it.
   */
  $effect(() => {
    void (async () => {
      try {
        appearance = await ipc.getAppearance();
        themes = await ipc.listThemes();
        // The stored suites are strings: a settings file written by a later
        // version can name a group this one has never heard of, and the
        // registry ignores what it does not recognise rather than refusing to
        // start.
        const stored = await ipc.getKeyPreferences();
        keyPreferences = {
          disabledSuites: stored.disabledSuites as SuiteId[],
          overrides: stored.overrides,
        };
      } catch {
        // Defaults are already in place, and an interface that will not start
        // because it could not read a colour preference would be worse.
      }
      await applyAppearance();
    })();

    return theming.watchSystemMode(() => {
      if (appearance.colourMode === "system") {
        theming.applyAppearance(appearance.theme, appearance.colourMode);
      }
    });
  });

  /**
   * Install a theme bundle the user points at.
   *
   * A folder rather than a zip: unzipping is something every desktop already
   * does, and asking yaz to do it too would mean carrying an archive library
   * for a step the file manager finished a moment ago.
   */
  async function installTheme() {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen !== "string") return;
    try {
      const installed = await ipc.installTheme(chosen);
      themes = await ipc.listThemes();
      showNotice(t("theme-installed", { name: installed.name }));
      await changeAppearance({ theme: installed.id });
    } catch (error) {
      failure = String(error);
    }
  }

  /** Write a built theme somewhere the user can share it from. */
  async function exportTheme(_id: string, css: string, manifest: string) {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen !== "string") return;
    try {
      const written = await ipc.exportTheme(chosen, manifest, css);
      showNotice(t("theme-exported", { path: written }));
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Use a theme that was just built.
   *
   * It is written into the themes folder first, because "use this" has to
   * survive closing the window — a theme that exists only in the builder's
   * state would vanish on the next start and take the interface's appearance
   * with it.
   */
  async function applyBuiltTheme(id: string, name: string, css: string, manifest: string) {
    try {
      await ipc.saveTheme(manifest, css);
      themes = await ipc.listThemes();
      await changeAppearance({ theme: id });
      showNotice(t("theme-installed", { name }));
    } catch (error) {
      failure = String(error);
    }
    buildingTheme = false;
  }

  /**
   * Change one of the document's declared properties.
   *
   * Written into the source through the editor rather than to the file, so it
   * is one undo step and the editor's view of the document never diverges from
   * the shell's.
   */
  function changeProperty(key: keyof Properties, value: string) {
    const edit = setProperty(docText, key, value);
    if (!edit) return;
    if (editorApi) {
      editorApi.replaceRange(edit.from, edit.to, edit.insert);
      return;
    }
    // No editor open: the file is still the document, so edit the text and let
    // the usual save path carry it.
    docText = docText.slice(0, edit.from) + edit.insert + docText.slice(edit.to);
    dirty = true;
  }

  /**
   * Save by itself, once the typing stops.
   *
   * Debounced rather than on every keystroke: a save is a write to disk and,
   * with version control on, a commit — doing either per character would make
   * the history unreadable and the disk busy for no benefit.
   */
  $effect(() => {
    if (!autosave || !dirty || !currentFile) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  });

  /** Keep the keyboard the user arranged. */
  async function saveKeys() {
    try {
      await ipc.setKeyPreferences(keyPreferences);
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Do what a shortcut asked for.
   *
   * The window-scoped half of the registry ends up here. The editor-scoped
   * half never does — those run inside CodeMirror, where they can see the
   * document.
   */
  function runShortcut(command: CommandId) {
    switch (command) {
      case "view.toggleRichText":
        richText = !richText;
        return;
      case "view.toggleSource":
        richText = false;
        return;
      case "view.togglePageView":
        pageView = !pageView;
        return;
      case "view.toggleFiles":
        filesPinned = !filesPinned;
        filesOpen = filesPinned;
        return;
      case "view.lineNumbers":
        // Round the three states rather than to a fixed one: a shortcut that
        // always lands on the same setting is half a shortcut.
        numbering =
          LINE_NUMBERING[
            (LINE_NUMBERING.indexOf(numbering) + 1) % LINE_NUMBERING.length
          ] ?? "absolute";
        return;
      case "navigate.outline":
        updateLayout(
          layoutTree.isOpen(layout, "outline")
            ? layoutTree.closeTab(layout, "outline")
            : layoutTree.openTab(layout, "outline"),
        );
        return;
      case "document.compile":
        void compile();
        return;
      case "document.recordVersion":
        askingForMessage = true;
        return;
      default:
        // Editor-scoped commands reach CodeMirror instead, and anything else
        // is a command declared but not yet wired — which the settings list
        // will show as bound to a key that does nothing.
        return;
    }
  }

  /**
   * The keyboard, at the window.
   *
   * Capture phase, so a chord prefix is taken before CodeMirror is asked for
   * it. Everything else falls through untouched, which is what lets the editor
   * keep its own bindings.
   */
  $effect(() => {
    const dispatcher = new KeyDispatcher(runShortcut);
    dispatcher.update(shortcuts);

    const onkeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatcher.cancel();
        return;
      }
      if (dispatcher.handle(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", onkeydown, true);
    return () => window.removeEventListener("keydown", onkeydown, true);
  });

  /** Refresh the recent list. Cheap, and only read when a menu opens. */
  async function loadRecent() {
    try {
      recent = await ipc.recentProjects();
    } catch {
      recent = [];
    }
  }

  /**
   * The pane layout.
   *
   * Replaces a hard-coded editor-left / PDF-right grid. Every view added after
   * those two — rich text, an outline, a diff — would otherwise have needed its
   * own slot and its own arrangement rule; a tree costs the same for two panes
   * or six, and "close the preview and give the source the whole window" stops
   * being a special case.
   */
  let layout = $state<LayoutNode>(layoutTree.defaultLayout());

  /** Tab names. A filename is data, so it is not a message key. */
  const tabTitles = $derived<Record<TabId, string>>({
    editor: currentFile ?? t("workspace-tab-editor"),
    outline: t("workspace-tab-outline"),
    pdf: t("workspace-tab-pdf"),
    history: t("workspace-tab-history"),
  });

  /**
   * Persist the arrangement with the project.
   *
   * Per project rather than globally: a thesis and a conference paper want
   * different arrangements, and the engine choice already lives here.
   */
  async function saveLayout() {
    if (!project) return;
    try {
      await ipc.setProjectWorkspace(project.root, layoutTree.serialise(layout));
    } catch {
      // A layout is a convenience. Failing to store it must not interrupt
      // whatever the user was actually doing.
    }
  }

  function updateLayout(next: LayoutNode | null) {
    layout = next ?? layoutTree.defaultLayout();
    void saveLayout();
  }

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
    // Detecting git is a process start, so it happens when the dialog that
    // shows the answer is opened rather than at launch.
    if (vcsBackends.length === 0) {
      void ipc
        .vcsBackends()
        .then((found) => (vcsBackends = found))
        .catch(() => {});
    }
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
        { labelKey: "menu-file-open-folder",
          icon: "folder" as const, action: chooseProject },
        {
          labelKey: "menu-file-open-recent",
          icon: "clock" as const,
          // Titles here are folder names, which are data rather than interface
          // copy, so they are passed through as labels and not message keys.
          items:
            recent.length > 0
              ? recent.map((entry) => ({
                  labelKey: entry.name,
                  literalLabel: true,
                  tooltip: entry.root,
                  action: () => openProjectAt(entry.root),
                }))
              : [{ labelKey: "menu-file-no-recent", disabled: true }],
        },
        {
          labelKey: "menu-file-save",
          icon: "save" as const,
          action: save,
          disabled: !currentFile || !dirty,
        },
        {
          labelKey: "menu-file-compile",
          icon: "play" as const,
          action: compile,
          disabled: !project || busy,
          separatorBefore: true,
        },
        {
          labelKey: "menu-file-close-project",
          icon: "close" as const,
          action: closeProject,
          disabled: !project,
          separatorBefore: true,
        },
      ],
    },
    {
      labelKey: "menu-edit",
      items: [
        { labelKey: "menu-edit-undo",
          icon: "undo" as const, action: notImplemented, disabled: true },
        { labelKey: "menu-edit-redo",
          icon: "redo" as const, action: notImplemented, disabled: true },
        {
          labelKey: "menu-edit-find",
          icon: "search" as const,
          action: notImplemented,
          disabled: true,
          separatorBefore: true,
        },
        {
          labelKey: "menu-edit-settings",
          icon: "settings" as const,
          action: () => openSettings("engine"),
          separatorBefore: true,
        },
      ],
    },
    {
      labelKey: "menu-view",
      items: [
        {
          labelKey: "menu-view-rich-text",
          icon: "text" as const,
          checked: richText,
          action: () => {
            richText = !richText;
          },
        },
        {
          labelKey: "menu-view-vim",
          icon: "wrench" as const,
          checked: vimMode,
          action: () => {
            vimMode = !vimMode;
          },
        },
        {
          labelKey: "menu-view-files",
          icon: "list" as const,
          checked: filesPinned,
          action: () => {
            filesPinned = !filesPinned;
            filesOpen = filesPinned;
          },
        },
        {
          labelKey: "menu-view-line-numbers",
          icon: "numbers" as const,
          separatorBefore: true,
          items: LINE_NUMBERING.map((mode) => ({
            labelKey: `menu-view-line-numbers-${mode}`,
            // A tick rather than a radio dot: the menu has no radio group, and
            // exactly one of the three is always ticked, which reads the same.
            checked: numbering === mode,
            action: () => {
              numbering = mode;
            },
          })),
        },
        {
          labelKey: "menu-view-tabs",
          icon: "layout" as const,
          separatorBefore: true,
          // Closed tabs come back from here. A tab that can be closed and not
          // reopened is a tab that gets closed once and then missed.
          items: [
            {
              // Not a workspace tab — a shell region. It is listed here because
              // this is where someone looks to get a part of the window back,
              // and a ribbon nobody can find again is a ribbon nobody collapses.
              labelKey: "ribbon-title",
              checked: ribbonOpen,
              action: () => {
                ribbonOpen = !ribbonOpen;
              },
            },
            ...(["editor", "pdf", "outline", "history"] as TabId[]).map((tab) => ({
            labelKey: `workspace-tab-${tab}`,
            checked: layoutTree.isOpen(layout, tab),
            action: () => {
              updateLayout(
                layoutTree.isOpen(layout, tab)
                  ? layoutTree.closeTab(layout, tab)
                  : layoutTree.openTab(layout, tab),
              );
            },
            })),
          ],
        },
        {
          labelKey: "menu-view-reset-layout",
          icon: "layout" as const,
          action: () => updateLayout(layoutTree.defaultLayout()),
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
          labelKey: "vcs-commit-with-message",
          icon: "branch" as const,
          disabled: !vcs?.enabled || !vcs.dirty || vcsBusy,
          separatorBefore: commands.length > 0,
          action: () => {
            askingForMessage = true;
          },
        },
        {
          labelKey: "menu-tools-connections",
          icon: "plug" as const,
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
        { labelKey: "menu-help-documentation",
          icon: "book" as const, action: notImplemented, disabled: true },
        { labelKey: "menu-help-report-issue",
          icon: "bug" as const, action: notImplemented, disabled: true },
        {
          labelKey: "menu-help-about",
          icon: "info" as const,
          action: notImplemented,
          disabled: true,
          separatorBefore: true,
        },
      ],
    },
  ]);

  /**
   * The ribbon, built from the menus plus the tabs only it can have.
   *
   * The menus are not rewritten: each becomes a tab, its plain entries become
   * buttons and its flyouts become dropdowns. One declaration, two shapes —
   * otherwise every command would have to be added in both places, and one of
   * them would fall behind.
   *
   * Layout and Document are the tabs that justify the ribbon existing. They let
   * someone set a paper size or an author without knowing that those are a
   * package option and a preamble command, which is the whole point.
   */
  const ribbonTabs = $derived<RibbonTab[]>([
    ...menus.map((menu) => ({
      id: menu.labelKey,
      labelKey: menu.labelKey,
      groups: [
        {
          titleKey: menu.labelKey,
          controls: menu.items.map((item) =>
            item.items?.length
              ? { kind: "menu" as const, labelKey: item.labelKey, items: item.items }
              : {
                  kind: "action" as const,
                  labelKey: item.labelKey,
                  disabled: item.disabled,
                  checked: item.checked,
                  onclick: () => void item.action?.(),
                },
          ),
        },
      ],
    })),
    {
      id: "layout",
      labelKey: "ribbon-layout",
      groups: [
        {
          titleKey: "ribbon-page-setup",
          controls: [
            {
              kind: "select" as const,
              labelKey: "ribbon-paper",
              value: properties.paper,
              options: PAPER_SIZES.map((size) => ({
                value: size,
                label: t(`paper-${size}`),
              })),
              onchange: (value: string) => changeProperty("paper", value),
            },
          ],
        },
        {
          titleKey: "ribbon-view",
          controls: [
            {
              kind: "action" as const,
              labelKey: "menu-view-page",
              glyph: "▭",
              checked: pageView,
              onclick: () => (pageView = !pageView),
            },
            {
              kind: "action" as const,
              labelKey: "ribbon-vertical",
              glyph: "▤",
              checked: ribbonVertical,
              onclick: () => (ribbonVertical = !ribbonVertical),
            },
          ],
        },
      ],
    },
    {
      id: "document",
      labelKey: "ribbon-document",
      groups: [
        {
          titleKey: "ribbon-title-block",
          controls: [
            {
              kind: "text" as const,
              labelKey: "ribbon-doc-title",
              value: properties.title,
              onchange: (value: string) => changeProperty("title", value),
            },
            {
              kind: "text" as const,
              labelKey: "ribbon-doc-author",
              value: properties.author,
              onchange: (value: string) => changeProperty("author", value),
            },
            {
              kind: "text" as const,
              labelKey: "ribbon-doc-date",
              placeholderKey: "ribbon-doc-date-today",
              value: properties.date,
              onchange: (value: string) => changeProperty("date", value),
            },
          ],
        },
        {
          titleKey: "settings-document-locale",
          controls: [
            {
              kind: "select" as const,
              labelKey: "settings-document-locale",
              value: properties.language,
              options: [
                { value: "", label: t("status-language-unset") },
                ...LANGUAGES.map((language) => ({
                  value: language.option,
                  label: t(language.labelKey),
                })),
              ],
              onchange: (value: string) => changeProperty("language", value),
            },
          ],
        },
      ],
    },
    {
      // The buttons that used to sit beside the title bar. Gathered rather than
      // scattered, until there is a reason to put each somewhere better.
      id: "work",
      labelKey: "ribbon-work",
      groups: [
        {
          titleKey: "ribbon-work",
          controls: [
            {
              kind: "action" as const,
              labelKey: "compile-run",
              glyph: "▶",
              disabled: !project || busy,
              onclick: () => void compile(),
            },
            {
              kind: "action" as const,
              labelKey: "view-mode-source",
              glyph: "⟨⟩",
              checked: !richText,
              onclick: () => (richText = !richText),
            },
            {
              kind: "action" as const,
              labelKey: vcs?.enabled ? "vcs-recording" : "vcs-enable",
              glyph: "⑂",
              disabled: !project || vcsBusy,
              checked: vcs?.enabled,
              onclick: () => void toggleVcs(),
            },
            {
              kind: "action" as const,
              labelKey: "connections-title",
              glyph: "◈",
              onclick: () => void connectZotero(),
            },
          ],
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
      id: "appearance",
      labelKey: "settings-appearance",
      glyph: "◐",
      groups: [
        {
          titleKey: "settings-appearance",
          fields: [
            {
              kind: "select" as const,
              labelKey: "settings-theme",
              helpKey: "settings-theme-help",
              value: appearance.theme,
              // A theme's name is its author's, so it is data and not a
              // message key — translating it would be renaming someone's work.
              options: themes.map((theme) => ({ value: theme.id, label: theme.name })),
              onchange: (id: string) => void changeAppearance({ theme: id }),
            },
            {
              kind: "select" as const,
              labelKey: "settings-colour-mode",
              value: appearance.colourMode,
              options: theming.COLOUR_MODES.map((mode) => ({
                value: mode,
                label: t(`settings-colour-mode-${mode}`),
              })),
              onchange: (mode: string) =>
                void changeAppearance({ colourMode: mode as ipc.Appearance["colourMode"] }),
            },
            {
              kind: "select" as const,
              labelKey: "settings-interface-locale",
              helpKey: "settings-interface-locale-help",
              value: appearance.interfaceLocale,
              // Endonyms: a language list is read by people looking for their
              // own, and someone who cannot read the current interface can
              // still find "Deutsch".
              options: availableLocales.map((entry) => ({
                value: entry.code,
                label: entry.name,
              })),
              onchange: (code: string) => void changeAppearance({ interfaceLocale: code }),
            },
          ],
        },
        {
          titleKey: "settings-appearance-build",
          fields: [
            {
              kind: "button" as const,
              labelKey: "settings-appearance-build",
              helpKey: "settings-appearance-build-help",
              actionKey: "settings-appearance-build-open",
              onclick: () => {
                settingsOpen = false;
                buildingTheme = true;
              },
            },
            {
              kind: "button" as const,
              labelKey: "settings-appearance-install",
              actionKey: "settings-appearance-install",
              onclick: () => void installTheme(),
            },
          ],
        },
      ],
    },
    {
      id: "keys",
      labelKey: "settings-section-keys",
      glyph: "⌨",
      groups: [
        {
          titleKey: "keys-suites",
          fields: SUITES.map((suite) => ({
            kind: "toggle" as const,
            labelKey: suite.labelKey,
            helpKey: suite.helpKey,
            value: !keyPreferences.disabledSuites.includes(suite.id),
            onchange: (on: boolean) => {
              // The core cannot be switched off. Offering the switch and
              // ignoring it would be worse than not offering it, so it is
              // shown as already on and stays that way.
              if (!isOptional(suite.id)) return;
              keyPreferences = {
                ...keyPreferences,
                disabledSuites: on
                  ? keyPreferences.disabledSuites.filter((id) => id !== suite.id)
                  : [...keyPreferences.disabledSuites, suite.id],
              };
              void saveKeys();
            },
          })),
        },
        ...SUITES.map((suite) => ({
          titleKey: suite.labelKey,
          fields: shortcuts
            .filter((shortcut) => shortcut.suites.includes(suite.id))
            .map((shortcut) => ({
              kind: "shortcut" as const,
              labelKey: shortcut.labelKey,
              binding: describeBinding(shortcut.binding),
              active: shortcut.active,
              conflicting: [...keyConflicts.values()].some((ids) =>
                ids.includes(shortcut.id),
              ),
              changed: shortcut.changed,
              onrebind: (binding: string) => {
                keyPreferences = {
                  ...keyPreferences,
                  overrides: { ...keyPreferences.overrides, [shortcut.id]: binding },
                };
                void saveKeys();
              },
              onreset: () => {
                const { [shortcut.id]: _removed, ...rest } = keyPreferences.overrides;
                keyPreferences = { ...keyPreferences, overrides: rest };
                void saveKeys();
              },
            })),
        })),
      ],
    },
    {
      id: "version-control",
      labelKey: "vcs-title",
      glyph: "⎇",
      groups: [
        {
          titleKey: "vcs-title",
          fields: [
            {
              kind: "select",
              labelKey: "vcs-settings-backend",
              helpKey: "vcs-settings-backend-help",
              value: vcs?.backend ?? "git",
              options: vcsBackends.map((backend) => ({
                value: backend.id,
                label: backend.available
                  ? t(backend.labelKey)
                  : `${t(backend.labelKey)} — ${t("engine-unavailable-suffix")}`,
                disabled: !backend.available,
              })),
              onchange: (value) => void switchBackend(value),
            },
            {
              kind: "note",
              labelKey: vcs?.enabled ? "vcs-recording" : "vcs-not-recording",
            },
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

  /** Change which backend records this project. */
  async function switchBackend(id: string) {
    if (!project) return;
    vcsBusy = true;
    try {
      vcs = vcs?.enabled ? await ipc.vcsEnable(project.root, id) : { ...vcs!, backend: id };
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

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
    // A small TOML read, so it can happen at startup without being felt - and
    // the File menu needs it populated the first time it is opened.
    void loadRecent();

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
    await openProjectAt(picked);
  }

  async function openProjectAt(picked: string) {
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
      layout = layoutTree.deserialise(settings.workspace);
      void loadRecent();
      void refreshVcs();
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
    // Recording is part of saving when it is switched on. A save with no edits
    // records nothing, so this does not fill the history with empty versions.
    if (vcs?.enabled) await recordVersion();
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

<!--
  What each tab renders. A snippet rather than a component map, so the editor and
  the preview keep the props they already had and the workspace stays ignorant
  of what a tab actually is.
-->
{#snippet tabContent(tab: TabId)}
  {#if tab === "editor"}
    {#if currentFile && EditorComponent}
      <EditorComponent
        doc={docText}
        docId={currentFile}
        {vimMode}
        onChange={(text) => {
          docText = text;
          dirty = true;
        }}
        onSave={save}
        rich={richText}
        {numbering}
        {shortcuts}
        {pageView}
        page={paperSize}
        {zoom}
        onCursor={(offset) => (cursor = offset)}
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
  {:else if tab === "pdf"}
    <PdfView data={pdfData} onclickpoint={jumpToSource} onpages={(n) => (pdfPages = n)} />
  {:else if tab === "outline"}
    <Outline
      doc={docText}
      file={currentFile}
      {cursor}
      onnavigate={(heading: Heading) => {
        // The offsets address the raw source, which is the same buffer in both
        // views — so this works identically in rich text.
        editorApi?.revealRange(heading.titleFrom, heading.titleTo);
      }}
    />
  {:else if tab === "history"}
    <History
      status={vcs}
      {commits}
      busy={vcsBusy}
      onenable={toggleVcs}
      onrestore={restoreVersion}
      oncommit={() => {
        askingForMessage = true;
      }}
    />
  {/if}
{/snippet}

{#if buildingTheme}
  <ThemeBuilder
    mode={theming.resolveMode(appearance.colourMode)}
    onapply={applyBuiltTheme}
    onexport={exportTheme}
    onclose={() => (buildingTheme = false)}
  />
{/if}

<div class="app">
  <!-- The window is undecorated, so this row is the title bar. The project
       name lives here, which is where a title bar puts it — and is why the
       long absolute path came out of the toolbar. -->
  <!-- The window is undecorated, so this row is the title bar. What is on
       it is what you reach for without thinking about which part of the
       application it belongs to; everything else went to the ribbon. -->
  <TitleBar
    title={windowTitle}
    {dirty}
    canSave={Boolean(currentFile)}
    onsave={save}
    {autosave}
    onautosave={(on) => (autosave = on)}
    onundo={() => showNotice(t("menu-not-implemented"))}
    onredo={() => showNotice(t("menu-not-implemented"))}
    {search}
    onsearch={(value) => (search = value)}
  />

  {#if !ribbonVertical}
    <Ribbon
      tabs={ribbonTabs}
      orientation="horizontal"
      expanded={ribbonOpen}
      ontoggle={() => (ribbonOpen = !ribbonOpen)}
    />
  {/if}

  <div class="body" class:narrow={!filesOpen}>
    {#if ribbonVertical}
      <Ribbon
        tabs={ribbonTabs}
        orientation="vertical"
        expanded={ribbonOpen}
        ontoggle={() => (ribbonOpen = !ribbonOpen)}
      />
    {/if}
    <nav
      class="files"
      class:collapsed={!filesOpen}
      onmouseenter={() => (filesOpen = true)}
      onmouseleave={() => {
        if (!filesPinned) filesOpen = false;
      }}
    >
      <!-- The pin is the only control the strip needs: everything else about
           the list is the list. -->
      <div class="files-bar">
        <button
          type="button"
          class="pin"
          class:on={filesPinned}
          title={filesPinned ? t("files-unpin") : t("files-pin")}
          aria-label={filesPinned ? t("files-unpin") : t("files-pin")}
          aria-pressed={filesPinned}
          onclick={() => {
            filesPinned = !filesPinned;
            filesOpen = filesPinned;
          }}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M9 1.5l3.5 3.5-1.6 1.6-1-.4-2.4 2.4.5 2.1-1 1-4.2-4.2 1-1 2.1.5 2.4-2.4-.4-1z"
              fill="currentColor"
              stroke="none"
            />
            <path d="M4.3 9.7L1.5 12.5" stroke="currentColor" stroke-width="1.3" fill="none" />
          </svg>
        </button>
      </div>
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

    <Pane
      node={layout}
      titles={tabTitles}
      content={tabContent}
      onmove={(tab, target, zone) =>
        updateLayout(layoutTree.moveTab(layout, tab, target, zone))}
      onfocus={(tab) => updateLayout(layoutTree.focusTab(layout, tab))}
      onclose={(tab) => updateLayout(layoutTree.closeTab(layout, tab))}
      onresize={(path, sizes) => updateLayout(layoutTree.resize(layout, path, sizes))}
    />
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

  {#if askingForMessage}
    <Prompt
      titleKey="vcs-commit-title"
      placeholderKey="vcs-commit-placeholder"
      hintKey="vcs-commit-hint"
      onsubmit={(value) => {
        askingForMessage = false;
        // Null is a dismissal; an empty string is "you describe it", which is
        // why they are distinguished rather than both treated as cancel.
        if (value !== null) void recordVersion(value);
      }}
    />
  {/if}

  {#if notice}
    <output class="notice">{notice}</output>
  {/if}

  <StatusBar
    compileMessage={failure ??
      (result
        ? result.succeeded
          ? t("compile-succeeded", { seconds: (result.elapsedMs / 1000).toFixed(1) })
          : t("compile-failed")
        : null)}
    compileFailed={Boolean(failure) || (result !== null && !result.succeeded)}
    compileErrors={errorCount}
    {health}
    healthLabel={t(healthKey)}
    onhealth={connectZotero}
    page={null}
    pages={pdfPages}
    words={wordCount}
    language={properties.language}
    languages={LANGUAGES.map((language) => ({
      value: language.option,
      label: t(language.labelKey),
    }))}
    onlanguage={(value) => changeProperty("language", value)}
    {pageView}
    onpageview={() => (pageView = !pageView)}
    rich={richText}
    onsource={() => (richText = !richText)}
    {zoom}
    onzoom={(percent) => (zoom = percent)}
  />
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
    /* The file list, then the workspace, which arranges itself. */
    grid-template-columns: 15rem 1fr;
    min-block-size: 0;
    transition: grid-template-columns 140ms ease;
  }

  /* Collapsed, the list keeps a strip: something to point at to get it back,
     and somewhere for the pin to live. A pane that vanishes completely is one
     the user has to remember exists. */
  .body.narrow {
    grid-template-columns: 1.75rem 1fr;
  }

  .files.collapsed ul,
  .files.collapsed .empty {
    display: none;
  }

  .files-bar {
    display: flex;
    justify-content: flex-end;
    padding: var(--yaz-space-1);
  }

  .pin {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.25rem;
    block-size: 1.25rem;
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--yaz-radius-sm);
    color: var(--yaz-text-muted);
    cursor: pointer;
    opacity: 0.6;
  }

  .pin svg {
    inline-size: 0.75rem;
    block-size: 0.75rem;
  }

  .pin:hover {
    opacity: 1;
    background: var(--yaz-bg-hover);
  }

  .pin.on {
    opacity: 1;
    color: var(--yaz-accent);
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

  .empty {
    color: var(--yaz-text-muted);
    padding: var(--yaz-space-4);
    margin: 0;
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
