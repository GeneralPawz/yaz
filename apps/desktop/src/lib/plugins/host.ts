/**
 * The plugin runtime.
 *
 * # What "runtime" means here, and what it does not
 *
 * This builds the `App` object from `@yaz/api` and hands it to plugins. Core
 * plugins are bundled at build time rather than loaded from disk — installing
 * community plugins from a GitHub release is separate work — but the *boundary*
 * is real, and that is the part that matters now: the Zotero plugin imports
 * `@yaz/api` and nothing else, and everything privileged it does goes through a
 * Tauri command that the capability broker refuses first.
 *
 * That is the forcing function in [ADR-0005]. A core plugin with a private back
 * door would tell us nothing about whether the public API is good enough. This
 * one had to have `listAnnotations` and `ui.pick` added as public API precisely
 * because it could not reach around them.
 *
 * # Plugins are not isolated from each other
 *
 * They share one JavaScript realm, so a plugin can read another's state and name
 * its id ([ADR-0006]). Capabilities bound what the plugin layer as a whole can
 * do, not what one plugin can do relative to another. `SECURITY.md` and the Rust
 * `plugin_host` module say the same; it is repeated here because this is the
 * file where someone would otherwise assume otherwise.
 *
 * [ADR-0005]: https://generalpawz.github.io/yaz/adr/0005-extensibility-tiers
 * [ADR-0006]: https://generalpawz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities
 */

import type {
  App,
  Command,
  EditorApi,
  PickerItem,
  PickerOptions,
  Plugin,
  ProjectApi,
} from "@yaz/api";

import { locale, t } from "../i18n";
import * as ipc from "../ipc";
import type { Row } from "../Picker.svelte";

/** A picker the runtime is waiting on, rendered by the application shell. */
export interface PickerRequest {
  titleKey: string;
  placeholderKey?: string | undefined;
  emptyKey?: string | undefined;
  load: (query: string) => Promise<Row[]>;
  resolve: (value: unknown) => void;
}

/** A notice the shell should display. */
export interface Notice {
  id: number;
  text: string;
}

/** A command a plugin registered, as the shell lists it. */
export interface RegisteredCommand {
  pluginId: string;
  id: string;
  /**
   * The message key, kept alongside the resolved name.
   *
   * The menu renders from the key rather than the string so that the i18n check
   * can see it, and so a locale change re-renders the label rather than baking
   * in whatever was active when the plugin loaded.
   */
  nameKey: string;
  name: string;
  callback: () => void | Promise<void>;
  isAvailable?: (() => boolean) | undefined;
}

/** What the shell must supply for the runtime to build an `App`. */
export interface HostContext {
  /** The open project, or null. */
  project(): { root: string; entry: string } | null;
  /** The focused editor, or null. */
  editor(): EditorApi | null;
  /** Compile the open project. */
  compile(): Promise<ipc.CompileResult>;
  /** Show a picker and resolve with the chosen value. */
  requestPicker(request: PickerRequest): void;
  /** Show a transient message. */
  showNotice(text: string): void;
}

/** A text format a plugin contributed, and who contributed it. */
export interface RegisteredFormat {
  pluginId: string;
  id: string;
  extensions: string[];
  nameKey: string;
  /** Loads the language, the first time a file of this format is opened. */
  load: () => Promise<unknown>;
}

/** A LaTeX vocabulary a plugin contributed, and who contributed it. */
export interface RegisteredVocabulary {
  pluginId: string;
  commands: Record<string, unknown>;
  environments: Record<string, unknown>;
}

/**
 * Loads plugins and owns the `App` they see.
 */
export class PluginRuntime {
  readonly commands: RegisteredCommand[] = [];
  /**
   * Text formats plugins have taught the editor about.
   *
   * Held rather than applied: the shell decides which format a file is and
   * whether the user has that format switched on, and the runtime's job is to
   * collect what was offered. A plugin cannot make its format the active one.
   */
  readonly formats: RegisteredFormat[] = [];
  /**
   * What plugins have taught the preview about packages.
   *
   * Held rather than applied, like the formats: which of these is in force is
   * the shell's decision, and a plugin cannot make its own vocabulary the
   * active one.
   */
  readonly vocabularies: RegisteredVocabulary[] = [];
  private readonly loaded = new Map<string, Plugin>();

  constructor(private readonly context: HostContext) {}

  /**
   * Load every bundled plugin the Rust side granted capabilities to.
   *
   * The direction matters: Rust reads each manifest and decides, then this
   * instantiates the code for what came back. A plugin whose manifest did not
   * parse is simply absent here, and its commands never appear — rather than
   * appearing and failing with a capability refusal on first use.
   */
  async start(registry: Record<string, new () => Plugin>): Promise<void> {
    const granted = await ipc.pluginList();
    for (const entry of granted) {
      const factory = registry[entry.id];
      if (!factory) {
        // A manifest bundled without its code, or the reverse. Worth saying:
        // silently skipping would make a missing feature very hard to explain.
        console.warn(`[yaz] no bundled code for plugin ${entry.id}`);
        continue;
      }
      await this.instantiate(entry.id, factory);
    }
  }

  private async instantiate(
    pluginId: string,
    factory: new () => Plugin,
  ): Promise<void> {
    const app = this.createApp(pluginId);
    const plugin = new factory();
    // `app` is declared readonly on the base class, which is right for plugin
    // authors and means the runtime has to install it. This is the only place
    // that happens.
    Object.defineProperty(plugin, "app", { value: app, writable: false });

    const runtime = this;
    plugin.addCommand = function addCommand(command: Command) {
      runtime.commands.push({
        pluginId,
        id: `${pluginId}.${command.id}`,
        nameKey: command.nameKey,
        name: t(command.nameKey),
        callback: command.callback,
        isAvailable: command.isAvailable,
      });
    };

    plugin.registerFormat = function registerFormat(contribution) {
      // Extensions are held lowercased, because a file called `README.MD` is
      // the same format as one called `readme.md` and a plugin author should
      // not have to think about it.
      runtime.formats.push({
        pluginId,
        id: contribution.id,
        extensions: contribution.extensions.map((entry) =>
          entry.toLowerCase().replace(/^[.]/, ""),
        ),
        nameKey: contribution.nameKey,
        load: contribution.load,
      });
    };

    plugin.registerLatexVocabulary = function registerLatexVocabulary(
      vocabulary,
    ) {
      runtime.vocabularies.push({
        pluginId,
        commands: vocabulary.commands ?? {},
        environments: vocabulary.environments ?? {},
      });
    };

    this.loaded.set(pluginId, plugin);
    await plugin.onload();
  }

  /** Commands that are applicable right now. */
  availableCommands(): RegisteredCommand[] {
    return this.commands.filter((c) => c.isAvailable?.() !== false);
  }

  private createApp(pluginId: string): App {
    const context = this.context;

    const project = (): ProjectApi | null => {
      const open = context.project();
      if (!open) return null;
      return {
        root: open.root,
        entry: open.entry,
        async compile() {
          const result = await context.compile();
          return {
            succeeded: result.succeeded,
            // The IPC layer uses null for "the log did not attribute one"; the
            // public API uses an absent property. Translating here keeps the
            // wire format out of the contract plugin authors program against.
            diagnostics: result.diagnostics.map((d) => ({
              severity: d.severity,
              message: d.message,
              file: d.file ?? undefined,
              line: d.line ?? undefined,
            })),
          };
        },
      };
    };

    return {
      get project() {
        return project();
      },
      get editor() {
        return context.editor();
      },

      workspace: {
        registerView() {
          // Plugin-contributed views arrive with the workspace work. Throwing is
          // deliberate: silently doing nothing would look like a plugin bug.
          throw new Error("registerView is not implemented yet");
        },
      },

      fs: {
        async readText(path: string) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.readFile(open.root, path);
        },
        async writeText(path: string, contents: string) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.writeFile(open.root, path, contents);
        },
        async writeBytes(path: string, contents: Uint8Array) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.writeProjectBytes(open.root, path, contents);
        },
        async list() {
          throw new Error("fs.list is not implemented yet");
        },
      },

      i18n: {
        t,
        // A getter, not a value: the public contract is a `string`, but the
        // interface language can change while a plugin is loaded, and a plugin
        // holding the locale it started with would keep formatting dates in it.
        get locale() {
          return locale();
        },
      },

      notices: {
        show(key: string, params?: Record<string, string | number>) {
          context.showNotice(t(key, params));
        },
      },

      ui: {
        pick<T>(options: PickerOptions<T>): Promise<T | null> {
          return new Promise<T | null>((resolve) => {
            const source = options.items;
            const load = async (query: string): Promise<Row[]> => {
              const items: PickerItem<T>[] =
                typeof source === "function"
                  ? await source(query)
                  : filterLocally(source, query);
              // The plugin's value is carried through opaquely; the runtime
              // never inspects it.
              return items.map((item) => ({
                value: item.value,
                label: item.label,
                description: item.description,
                detail: item.detail,
                accentColor: item.accentColor,
              }));
            };

            context.requestPicker({
              titleKey: options.titleKey,
              placeholderKey: options.placeholderKey,
              emptyKey: options.emptyKey,
              load,
              resolve: (value) =>
                resolve(value === undefined ? null : (value as T)),
            });
          });
        },
      },

      zotero: {
        status: () =>
          ipc.zoteroStatus(pluginId).then((status) => ({
            kind: status.source,
            sourceKey: status.sourceKey,
            isLive: status.isLive,
            keysAreAuthoritative: status.keysAreAuthoritative,
            dataDir: status.dataDir,
            detail: status.detail,
          })),
        search: (query: string, limit?: number) =>
          ipc.zoteroSearch(pluginId, query, limit),
        listAnnotations: (itemKey: string) =>
          ipc.zoteroAnnotations(pluginId, itemKey),
        ensureInBibliography: (itemKey: string, bibliography?: string) => {
          const open = context.project();
          if (!open) return Promise.reject(new Error("no project is open"));
          return ipc.zoteroEnsureInBibliography(
            pluginId,
            open.root,
            itemKey,
            bibliography,
          );
        },
        refresh: () => ipc.zoteroReconnect(pluginId),
      },

      obsidian: {
        root: null,
        async listNotes() {
          throw new Error("the Obsidian bridge is not implemented yet");
        },
        async translate() {
          throw new Error("the Obsidian bridge is not implemented yet");
        },
      },
    };
  }
}

/**
 * Filter a fixed list.
 *
 * Case-insensitive across every visible field, because a user typing an author's
 * name into a list whose labels are titles should still find the row.
 */
function filterLocally<T>(
  items: PickerItem<T>[],
  query: string,
): PickerItem<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.label, item.description, item.detail]
      .filter((field): field is string => typeof field === "string")
      .some((field) => field.toLowerCase().includes(needle)),
  );
}
