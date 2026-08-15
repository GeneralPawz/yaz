/**
 * The public plugin API for yaz.
 *
 * # What this is
 *
 * Everything a plugin can do, and nothing else. Plugins run in the application's
 * webview with full DOM access — which is what lets them build real user
 * interfaces — but they have **no ambient authority**: `fetch`,
 * `XMLHttpRequest`, WebSocket and the raw IPC handle are removed before plugin
 * code runs. Privileged operations go through the methods here, and every one of
 * them is brokered by the Rust core against the capabilities the user granted.
 *
 * # Two rules that shape this file
 *
 * **No framework types.** The application shell is built with Svelte, and
 * nothing here exposes that. A plugin receives `HTMLElement`s and plain objects.
 * This is what allows the shell to be rebuilt on a different framework without
 * breaking a single plugin.
 *
 * **This is a promise.** Every export is semver-stable. A breaking change is a
 * major bump, without exception, because plugin authors depend on that being
 * trustworthy.
 *
 * @see {@link https://generalpawz.github.io/yaz/adr/0005-extensibility-tiers | ADR-0005}
 * @see {@link https://generalpawz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities | ADR-0006}
 *
 * @packageDocumentation
 */

/**
 * Base class for a plugin. Every plugin's entry point default-exports a subclass.
 *
 * @example
 * ```ts
 * import { Plugin } from "@yaz/api";
 *
 * export default class WordGoal extends Plugin {
 *   async onload() {
 *     this.addCommand({
 *       id: "show-goal",
 *       nameKey: "word-goal.command.show",
 *       callback: () => this.app.notices.show("word-goal.notice.on-track"),
 *     });
 *   }
 * }
 * ```
 *
 * @since 0.1.0
 */
export abstract class Plugin {
  /** The application this plugin is loaded into. */
  readonly app!: App;

  /** Called once when the plugin is enabled. Keep it fast — it is on the startup path. */
  abstract onload(): void | Promise<void>;

  /**
   * Called when the plugin is disabled or the application is closing.
   *
   * Anything registered through `add*` or `register*` is cleaned up
   * automatically; this is for resources the API does not know about.
   */
  onunload(): void | Promise<void> {}

  /** Register a command, available in the palette and bindable to a key. */
  addCommand(_command: Command): void {
    throw new Error("not implemented");
  }

  /** Add a settings tab for this plugin. */
  addSettingsTab(_tab: SettingsTab): void {
    throw new Error("not implemented");
  }

  /** Add an editor extension — a completion source, decoration, or diagnostic. */
  registerEditorExtension(_extension: EditorExtension): void {
    throw new Error("not implemented");
  }

  /** Read this plugin's persisted settings. */
  loadData<T>(): Promise<T | null> {
    throw new Error("not implemented");
  }

  /** Persist this plugin's settings. */
  saveData<T>(_data: T): Promise<void> {
    throw new Error("not implemented");
  }
}

/**
 * The application surface available to a plugin.
 *
 * @since 0.1.0
 */
export interface App {
  /** The open project, or `null` if none is open. */
  readonly project: ProjectApi | null;
  /** The active editor, or `null` if no document is focused. */
  readonly editor: EditorApi | null;
  /** Panes, tabs and views. */
  readonly workspace: WorkspaceApi;
  /** Filesystem access, bounded by granted capabilities. */
  readonly fs: FileSystemApi;
  /** Message resolution against the active locale. */
  readonly i18n: I18nApi;
  /** Transient user-facing messages. */
  readonly notices: NoticeApi;
  /** Zotero library access. Requires the `zotero` capability. */
  readonly zotero: ZoteroApi;
  /** Obsidian vault access. Requires the `obsidian` capability. */
  readonly obsidian: ObsidianApi;
}

/**
 * A named command.
 *
 * Note that `nameKey` is a message key, not a label. Hardcoded user-facing
 * strings are rejected by lint — see ADR-0011. The command registry is also what
 * generates the command reference in the docs, so the key must resolve.
 *
 * @since 0.1.0
 */
export interface Command {
  /** Unique within the plugin. */
  id: string;
  /** Message key for the display name. */
  nameKey: string;
  /** Message key for the longer description shown in the docs and palette. */
  descriptionKey?: string;
  /** Default keybinding, e.g. `"Mod+Shift+G"`. `Mod` is Ctrl on Windows/Linux. */
  defaultHotkey?: string;
  /** Invoked when the command runs. */
  callback: () => void | Promise<void>;
  /**
   * Return `false` to hide the command in the current context, e.g. when no
   * document is open.
   */
  isAvailable?: () => boolean;
}

/**
 * The active editor.
 *
 * There is exactly one editor buffer per document and it holds the raw `.tex`
 * source in **both** source and visual mode — visual mode is decorations over
 * this same text, not a separate document model. An extension registered here
 * therefore works in both modes without knowing modes exist.
 *
 * @see {@link https://generalpawz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer | ADR-0004}
 * @since 0.1.0
 */
export interface EditorApi {
  /** The full buffer contents — always the real LaTeX source. */
  getText(): string;
  /** Replace a byte range. */
  replaceRange(from: number, to: number, text: string): void;
  /** Current selection as byte offsets. */
  getSelection(): { from: number; to: number };
  /** Which rendering mode is active. Does not affect the buffer contents. */
  getMode(): "source" | "visual";
}

/**
 * Filesystem access, bounded by granted capabilities.
 *
 * Every call is brokered by the Rust core. Paths are canonicalised — `..`
 * collapsed and symlinks resolved — *before* being checked against the granted
 * root, so traversal and symlink escapes are refused rather than followed.
 *
 * @since 0.1.0
 */
export interface FileSystemApi {
  /**
   * Read a file as text.
   *
   * @throws {CapabilityError} if the path is outside the granted capabilities.
   */
  readText(path: string): Promise<string>;

  /**
   * Write a file, atomically.
   *
   * @throws {CapabilityError} if the path is outside the granted capabilities.
   */
  writeText(path: string, contents: string): Promise<void>;

  /** List a directory. */
  list(path: string): Promise<string[]>;
}

/**
 * Thrown when a plugin attempts an operation outside its granted capabilities.
 *
 * The three cases are distinct and worth handling differently: `not-declared`
 * is a bug in the plugin's manifest, `not-granted` means the user declined or
 * revoked, and `out-of-scope` means the capability is held but this particular
 * path or host is not covered by it.
 *
 * @since 0.1.0
 */
export class CapabilityError extends Error {
  constructor(
    /** The capability that would have been required. */
    readonly capability: string,
    /** Why the request was refused. */
    readonly reason: "not-declared" | "not-granted" | "out-of-scope",
  ) {
    super(`capability ${capability} refused: ${reason}`);
    this.name = "CapabilityError";
  }
}

/** Message resolution against the active interface locale. @since 0.1.0 */
export interface I18nApi {
  /** Resolve a message key, with optional interpolation parameters. */
  t(key: string, params?: Record<string, string | number>): string;
  /** The active interface locale, e.g. `"de-AT"`. */
  readonly locale: string;
}

/** Transient user-facing messages. @since 0.1.0 */
export interface NoticeApi {
  /** Show a notice. Takes a message key, never a literal string. */
  show(key: string, params?: Record<string, string | number>): void;
}

/** Panes, tabs and views. @since 0.1.0 */
export interface WorkspaceApi {
  /**
   * Register a view type this plugin can render.
   *
   * The factory is handed a plain `HTMLElement` to render into — deliberately,
   * so that the plugin contract does not depend on the shell's framework.
   */
  registerView(
    type: string,
    factory: (container: HTMLElement) => ViewHandle,
  ): void;
}

/** Handle returned by a view factory. @since 0.1.0 */
export interface ViewHandle {
  /** Called when the view is destroyed. */
  destroy(): void;
}

/** The open project. @since 0.1.0 */
export interface ProjectApi {
  /** Absolute path to the project root. */
  readonly root: string;
  /** Entry document, relative to the root. */
  readonly entry: string;
  /** Compile the project. */
  compile(): Promise<CompileResult>;
}

/** Outcome of a compilation. @since 0.1.0 */
export interface CompileResult {
  /**
   * Whether a usable PDF was produced.
   *
   * Note this is not the inverse of "has errors": LaTeX frequently emits errors
   * and a PDF at the same time.
   */
  succeeded: boolean;
  /** Structured diagnostics parsed from the engine log. */
  diagnostics: CompileDiagnostic[];
}

/** A diagnostic from the compiler. @since 0.1.0 */
export interface CompileDiagnostic {
  severity: "error" | "warning" | "info";
  /** The engine's own message text. */
  message: string;
  /** Source file, when the log attributes one. */
  file?: string;
  /** 1-based line number, when the log attributes one. */
  line?: number;
}

/**
 * Zotero library access. Requires the `zotero` capability.
 *
 * The active source is exposed deliberately: silently serving results from a
 * stale exported `.bib` while presenting them as the live library would be a
 * correctness problem in a citation tool.
 *
 * @see {@link https://generalpawz.github.io/yaz/adr/0008-zotero-integration | ADR-0008}
 * @since 0.1.0
 */
export interface ZoteroApi {
  /** Which source is currently serving queries, and whether it is live. */
  readonly source: {
    kind: "better-bibtex" | "local-api" | "exported-bib" | "sqlite" | "none";
    isLive: boolean;
  };
  /** Search the library. */
  search(query: string): Promise<ZoteroItem[]>;
  /** Ensure an item exists in the project `.bib` and return its citation key. */
  ensureInBibliography(itemKey: string): Promise<string>;
}

/** A Zotero library item. @since 0.1.0 */
export interface ZoteroItem {
  key: string;
  citationKey: string | null;
  title: string;
  creators: string[];
  year: number | null;
}

/**
 * Obsidian vault access. Requires the `obsidian` capability.
 *
 * The vault is read-only. @since 0.1.0
 */
export interface ObsidianApi {
  /** Absolute path to the vault root, or `null` if none is configured. */
  readonly root: string | null;
  /** List note paths, relative to the vault root. */
  listNotes(): Promise<string[]>;
  /** Translate a note to LaTeX using the project's mapping. */
  translate(notePath: string): Promise<string>;
}

/** An editor extension: a completion source, decoration, or diagnostic provider. @since 0.1.0 */
export interface EditorExtension {
  kind: "completion" | "decoration" | "diagnostic";
  /** Implementation, typed per `kind` in a future release. */
  provider: unknown;
}

/** A settings tab contributed by a plugin. @since 0.1.0 */
export interface SettingsTab {
  /** Message key for the tab title. */
  titleKey: string;
  /** Render into the supplied container. */
  render(container: HTMLElement): void;
}
