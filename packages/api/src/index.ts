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

  /**
   * Teach the editor a text format.
   *
   * The editor opens any text file with line numbers, wrapping, Vim and
   * search whether or not a plugin knows the format; what this adds is
   * highlighting and whatever else the format wants. So registering is
   * additive and failing to register is not fatal — a format nobody
   * contributes is a file that still opens.
   *
   * @since 0.3.0
   */
  registerFormat(_format: FormatContribution): void {
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
  /** Chooser dialogs. */
  readonly ui: UiApi;
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
  /**
   * Replace the selection with `text`, or insert at the cursor when nothing is
   * selected.
   *
   * Equivalent to `replaceRange(...getSelection(), text)`, which is what every
   * plugin that inserts anything would otherwise write.
   */
  insertAtCursor(text: string): void;
  /** Which rendering mode is active. Does not affect the buffer contents. */
  getMode(): "source" | "visual";
  /**
   * Select a range and scroll it into view.
   *
   * For navigating to something the plugin found — an outline entry, a search
   * result, a diagnostic. Offsets address the raw source in both modes, because
   * there is only one buffer (ADR-0004).
   */
  revealRange(from: number, to: number): void;
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

  /**
   * Write a file as bytes, creating the folders above it.
   *
   * For what is not text: an image, a generated figure. Same capability check
   * as {@link FileSystemApi.writeText} — the bytes make no difference to
   * *where* a plugin may write.
   *
   * @throws {CapabilityError} if the path is outside the granted capabilities.
   * @since 0.3.0
   */
  writeBytes(path: string, contents: Uint8Array): Promise<void>;

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
  file?: string | undefined;
  /** 1-based line number, when the log attributes one. */
  line?: number | undefined;
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
  /**
   * Which source is answering, and whether it is current.
   *
   * Asynchronous because connecting is deferred until something actually asks:
   * probing a closed Zotero costs a connection timeout, and paying it during
   * startup would slow launch for every user including those who never open the
   * citation picker.
   */
  status(): Promise<ZoteroStatus>;

  /** Search the library. An empty query lists recent items. */
  search(query: string, limit?: number): Promise<ZoteroItem[]>;

  /**
   * Every passage a reader marked in an item.
   *
   * Note that not all of them are quotable — see
   * {@link ZoteroAnnotation.isQuotable}.
   */
  listAnnotations(itemKey: string): Promise<ZoteroAnnotation[]>;

  /**
   * Ensure an item exists in the project `.bib` and return its citation key.
   *
   * The project `.bib` is the compile-time source of truth, so this copies the
   * entry in rather than pointing at the library: a document has to build on a
   * co-author's machine that has never had Zotero installed.
   *
   * Calling this twice for the same item does not append a duplicate.
   */
  ensureInBibliography(
    itemKey: string,
    bibliography?: string,
  ): Promise<CitationKey>;

  /** Re-probe the sources, e.g. after the user starts Zotero. */
  refresh(): Promise<void>;
}

/**
 * Which source is serving library queries.
 *
 * Exposed deliberately: silently serving results from a stale exported `.bib`
 * while presenting them as the live library would be a correctness problem in a
 * citation tool.
 *
 * @since 0.1.0
 */
export interface ZoteroStatus {
  kind: "better-bibtex" | "local-api" | "exported-bib" | "sqlite" | "none";
  /** Message key naming the source, for display. */
  sourceKey: string;
  /** Whether the source reflects the library as it is right now. */
  isLive: boolean;
  /**
   * Whether citation keys come from a source that owns them.
   *
   * `false` means keys are generated locally and **may not match** what a
   * collaborator's Better BibTeX produces. Worth surfacing rather than
   * discovering later in someone else's document.
   */
  keysAreAuthoritative: boolean;
  /** The data directory in use, when reading offline. */
  dataDir: string | null;
  /** Diagnostic text when no source is available. */
  detail: string | null;
}

/** A Zotero library item. @since 0.1.0 */
export interface ZoteroItem {
  key: string;
  citationKey: string | null;
  /** Zotero's item type, e.g. `journalArticle`. */
  itemType: string;
  title: string;
  creators: string[];
  year: number | null;
  /** Journal, proceedings or book title, when the item has one. */
  container: string | null;
}

/**
 * A passage a reader marked in an attachment.
 *
 * Zotero anchors these to an attachment and the attachment to an item; that
 * indirection is resolved before it reaches a plugin, so `itemKey` is the
 * citable work rather than the PDF.
 *
 * @since 0.1.0
 */
export interface ZoteroAnnotation {
  key: string;
  /** The citable item this belongs to. */
  itemKey: string;
  kind: "highlight" | "note" | "image" | "ink" | "underline" | "other";
  /** Message key naming the kind. */
  kindKey: string;
  /** The marked text. Empty for kinds that mark a region rather than text. */
  text: string;
  /** The reader's own comment, which is not the source's words. */
  comment: string | null;
  /**
   * Highlight colour as Zotero records it, e.g. `#ffd400`.
   *
   * Readers encode meaning in colour — one for claims, another for method — so
   * a picker that discards it throws away the only organisation many libraries
   * have.
   */
  color: string | null;
  /**
   * The page label as the document assigns it, which is not always a number.
   *
   * `null` when the attachment has no pagination, rather than the placeholder
   * Zotero stores — citing page "-" is worse than citing no page.
   */
  pageLabel: string | null;
  /**
   * Whether this marks text worth offering as a quotation.
   *
   * `false` for ink and image marks, which cover a region and have no text, and
   * for notes, which are the reader's words rather than the source's — quoting
   * one as the source would misattribute it.
   */
  isQuotable: boolean;
}

/** The outcome of ensuring an item is citable from this project. @since 0.1.0 */
export interface CitationKey {
  /** The key to use in `\cite{...}`. */
  key: string;
  /** Whether this call appended the entry. */
  added: boolean;
  /** The bibliography file, relative to the project root. */
  bibliography: string;
  /** Whether the key came from a source that owns citation keys. */
  isAuthoritative: boolean;
}

/**
 * Chooser dialogs.
 *
 * A plugin could build one out of raw DOM — it has the access — but then every
 * plugin's picker would look and behave differently, and none of them would
 * follow the theme or the keyboard conventions. This is the shared one.
 *
 * @since 0.1.0
 */
export interface UiApi {
  /**
   * Present a list and resolve with the chosen value, or `null` if dismissed.
   *
   * @typeParam T - the value carried by each row, returned as chosen.
   */
  pick<T>(options: PickerOptions<T>): Promise<T | null>;
}

/** Configuration for {@link UiApi.pick}. @since 0.1.0 */
export interface PickerOptions<T> {
  /** Message key for the dialog title. */
  titleKey: string;
  /** Message key for the filter field's placeholder. */
  placeholderKey?: string | undefined;
  /** Message key shown when there is nothing to choose from. */
  emptyKey?: string | undefined;
  /**
   * The rows.
   *
   * A function is called on every keystroke and is how a picker searches a
   * library too large to send at once; an array is filtered locally.
   */
  items: PickerItem<T>[] | ((query: string) => Promise<PickerItem<T>[]>);
}

/**
 * One row in a picker.
 *
 * The text fields here are **data, not interface copy** — a paper's title, an
 * author's name, a highlighted sentence — so they are strings rather than
 * message keys. This is the one place that distinction matters: a title must not
 * be translated, and there is no catalogue that could contain it.
 *
 * @since 0.1.0
 */
export interface PickerItem<T> {
  /** Returned by {@link UiApi.pick} when this row is chosen. */
  value: T;
  /** Primary text. */
  label: string;
  /**
   * Secondary text, shown beside the label.
   *
   * Written `| undefined` rather than plain optional so that a caller under
   * `exactOptionalPropertyTypes` can pass a value that may be absent — which is
   * what building a row from library data always looks like.
   */
  description?: string | undefined;
  /** Longer text, shown beneath. */
  detail?: string | undefined;
  /**
   * A colour to accent the row with, e.g. a highlight's own colour.
   *
   * The one sanctioned exception to "no literal colours" (ADR-0010): this is a
   * value that came out of the user's data, not a design decision, and no theme
   * token could represent it.
   */
  accentColor?: string | undefined;
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

/**
 * A text format a plugin teaches the editor about.
 *
 * # Why the language is loaded rather than given
 *
 * `load` is called the first time a file of this format is opened, and not
 * before. A plugin that handed over its language at registration would have
 * that language in the startup bundle for every user who never opens the
 * format — which is the whole cost the plugin system exists to avoid, paid at
 * the moment a plugin is installed rather than the moment it is used.
 *
 * @since 0.3.0
 */
export interface FormatContribution {
  /** Stable identifier, e.g. `markdown`. Unique across plugins. */
  id: string;
  /** Extensions that name it, without the dot. Matched case-insensitively. */
  extensions: string[];
  /** Message key for the format's name, as settings lists it. */
  nameKey: string;
  /**
   * Load the language support, once, when it is first needed.
   *
   * Returns a CodeMirror `Extension`. Typed as `unknown` here for the same
   * reason {@link EditorExtension} is: the API does not make CodeMirror part
   * of its own public contract, so that a later editor core is a change to
   * yaz rather than a break for every plugin.
   */
  load(): Promise<unknown>;
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
