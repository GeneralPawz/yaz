/**
 * Every keyboard shortcut yaz has, in one place.
 *
 * # Why a registry rather than keymaps where the features are
 *
 * A shortcut is not a property of the thing it does. It is a property of the
 * keyboard, and the keyboard is shared: two features that each seem entitled to
 * `Ctrl+B` cannot both have it, and neither can discover the conflict from
 * inside itself. Declaring them all here makes "what does this key do?" and
 * "what is bound twice?" answerable, which is also what makes them listable in
 * settings and rebindable at all.
 *
 * # Suites
 *
 * Each shortcut carries tags, and a tag can be switched off wholesale — the
 * Word-style bindings are the reason. Someone arriving from Word wants `Ctrl+B`
 * to embolden; someone arriving from Vim wants that key for something else and
 * would rather it did nothing than something surprising. Neither is talked out
 * of it, and the choice is one switch rather than fifteen.
 *
 * # Chords
 *
 * A binding may be a sequence: `Ctrl+Space R` means the modifier combination,
 * then the letter. Chords exist because the single-key space is full — every
 * `Ctrl+<letter>` is spoken for by the platform, the editor, or Word — and
 * because a prefix is how a person remembers a family of related commands
 * rather than fifteen unrelated ones.
 */

/** What a shortcut asks the application to do. */
export type CommandId =
  // Views
  | "view.toggleRichText"
  | "view.toggleSource"
  | "view.toggleFiles"
  | "view.togglePageView"
  | "view.lineNumbers"
  // Document
  | "document.save"
  | "document.compile"
  | "document.recordVersion"
  // Formatting
  | "format.bold"
  | "format.italic"
  | "format.underline"
  | "format.monospace"
  | "format.smallCaps"
  | "format.quote"
  | "format.heading1"
  | "format.heading2"
  | "format.heading3"
  | "format.clear"
  // Structure, inside the editor
  | "list.continue"
  | "list.indent"
  | "list.outdent"
  // Navigation
  | "navigate.outline"
  | "navigate.search"
  | "edit.complete";

/**
 * A group a shortcut belongs to.
 *
 * `core` cannot be switched off — those are the bindings without which the
 * application has no keyboard at all.
 */
export type SuiteId = "core" | "word" | "lists" | "yaz";

/** One shortcut, as declared. */
export interface Shortcut {
  id: CommandId;
  /** Message key for what it does. */
  labelKey: string;
  /**
   * The keys, in CodeMirror's notation.
   *
   * A space separates the steps of a chord: `"Mod-Space r"` is
   * Ctrl+Space then R. `Mod` is Ctrl on Windows and Linux, Cmd on macOS,
   * which is the difference the whole notation exists to hide.
   */
  keys: string;
  suites: SuiteId[];
  /**
   * Whether this runs inside the editor.
   *
   * Editor shortcuts reach CodeMirror's keymap, where they can see the
   * document and stop the default from happening. The rest are window-level,
   * and must not fire while the caret is in a text field.
   */
  editor?: boolean;
}

/** Whether a suite may be switched off. */
export function isOptional(suite: SuiteId): boolean {
  return suite !== "core";
}

/** Every suite, in the order settings offers them. */
export const SUITES: readonly {
  id: SuiteId;
  labelKey: string;
  helpKey: string;
}[] = [
  { id: "core", labelKey: "keys-suite-core", helpKey: "keys-suite-core-help" },
  { id: "yaz", labelKey: "keys-suite-yaz", helpKey: "keys-suite-yaz-help" },
  { id: "word", labelKey: "keys-suite-word", helpKey: "keys-suite-word-help" },
  {
    id: "lists",
    labelKey: "keys-suite-lists",
    helpKey: "keys-suite-lists-help",
  },
];

/**
 * The shortcuts, as they ship.
 *
 * Ordered by suite so the settings list reads as groups rather than as an
 * alphabet.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  // ---- core: without these there is no keyboard ---------------------------
  {
    id: "document.save",
    labelKey: "menu-file-save",
    keys: "Mod-s",
    suites: ["core"],
    editor: true,
  },
  {
    id: "navigate.search",
    labelKey: "menu-edit-find",
    keys: "Mod-f",
    suites: ["core"],
    editor: true,
  },
  {
    // Displaced from Ctrl+Space, which is now the prefix every yaz shortcut
    // hangs off. Listed here rather than silently moved: a key that used to do
    // something and now does nothing is worse than one that moved somewhere a
    // user can look up.
    id: "edit.complete",
    labelKey: "keys-complete",
    keys: "Mod-Shift-Space",
    suites: ["core"],
    editor: true,
  },

  // ---- yaz's own, all behind one prefix -----------------------------------
  //
  // `Ctrl+Space` then a letter. The prefix is free — the editor's completion
  // is on `Ctrl+Space` alone, and a chord starting with it still leaves that
  // working, because a chord only commits when its second key arrives.
  {
    id: "view.toggleRichText",
    labelKey: "menu-view-rich-text",
    keys: "Mod-Space r",
    suites: ["yaz"],
  },
  {
    id: "view.toggleSource",
    labelKey: "view-mode-source",
    keys: "Mod-Space s",
    suites: ["yaz"],
  },
  {
    id: "view.togglePageView",
    labelKey: "menu-view-page",
    keys: "Mod-Space p",
    suites: ["yaz"],
  },
  {
    id: "view.toggleFiles",
    labelKey: "menu-view-files",
    keys: "Mod-Space f",
    suites: ["yaz"],
  },
  {
    id: "view.lineNumbers",
    labelKey: "menu-view-line-numbers",
    keys: "Mod-Space n",
    suites: ["yaz"],
  },
  {
    id: "navigate.outline",
    labelKey: "workspace-tab-outline",
    keys: "Mod-Space o",
    suites: ["yaz"],
  },
  {
    id: "document.compile",
    labelKey: "compile-run",
    keys: "Mod-Space Enter",
    suites: ["yaz"],
  },
  {
    id: "document.recordVersion",
    labelKey: "vcs-commit-title",
    keys: "Mod-Space v",
    suites: ["yaz"],
  },

  // ---- what someone arriving from Word already knows ----------------------
  {
    id: "format.bold",
    labelKey: "format-bold",
    keys: "Mod-b",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.italic",
    labelKey: "format-italic",
    keys: "Mod-i",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.underline",
    labelKey: "format-underline",
    keys: "Mod-u",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.monospace",
    labelKey: "format-monospace",
    keys: "Mod-Shift-m",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.smallCaps",
    labelKey: "format-small-caps",
    keys: "Mod-Shift-k",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.quote",
    labelKey: "format-quote",
    keys: "Mod-Shift-q",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.heading1",
    labelKey: "format-heading-1",
    keys: "Mod-Alt-1",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.heading2",
    labelKey: "format-heading-2",
    keys: "Mod-Alt-2",
    suites: ["word"],
    editor: true,
  },
  {
    id: "format.heading3",
    labelKey: "format-heading-3",
    keys: "Mod-Alt-3",
    suites: ["word"],
    editor: true,
  },
  {
    // Word puts "clear formatting" on Ctrl+Space, which is the one key this
    // cannot have: the window takes that as the chord prefix before the editor
    // is asked, so an editor binding behind it could never fire. Ctrl+Shift+N
    // is Word's other way to the same place.
    id: "format.clear",
    labelKey: "format-clear",
    keys: "Mod-Shift-n",
    suites: ["word"],
    editor: true,
  },

  // ---- what a list does when typed into -----------------------------------
  //
  // These are shortcuts and not editor behaviour, deliberately. Enter and Tab
  // doing something other than what they say is exactly the sort of surprise a
  // user needs to be able to find, name and switch off.
  {
    id: "list.continue",
    labelKey: "keys-list-continue",
    keys: "Enter",
    suites: ["lists"],
    editor: true,
  },
  {
    id: "list.indent",
    labelKey: "keys-list-indent",
    keys: "Tab",
    suites: ["lists"],
    editor: true,
  },
  {
    id: "list.outdent",
    labelKey: "keys-list-outdent",
    keys: "Shift-Tab",
    suites: ["lists"],
    editor: true,
  },
];

/** How the user has changed things. */
export interface KeyPreferences {
  /** Suites that are switched off. */
  disabledSuites: SuiteId[];
  /** Bindings the user replaced, by command. An empty string unbinds. */
  overrides: Record<string, string>;
}

/** Nothing changed. */
export const DEFAULT_PREFERENCES: KeyPreferences = {
  disabledSuites: [],
  overrides: {},
};

/** A shortcut with the user's preferences applied. */
export interface ResolvedShortcut extends Shortcut {
  /** What it is actually bound to now; empty when unbound. */
  binding: string;
  /** Whether any suite it belongs to is switched on. */
  active: boolean;
  /** Whether the binding differs from the one it shipped with. */
  changed: boolean;
}

/**
 * Apply preferences to the declared shortcuts.
 *
 * A shortcut is active when *any* of its suites is on: a binding in two suites
 * belongs to someone who wants either, and switching off one of them should
 * not take away something the other was providing.
 */
export function resolve(preferences: KeyPreferences): ResolvedShortcut[] {
  const off = new Set(preferences.disabledSuites.filter(isOptional));
  return SHORTCUTS.map((shortcut) => {
    const override = preferences.overrides[shortcut.id];
    return {
      ...shortcut,
      binding: override ?? shortcut.keys,
      active: shortcut.suites.some((suite) => !off.has(suite)),
      changed: override !== undefined && override !== shortcut.keys,
    };
  });
}

/**
 * Bindings claimed by more than one active shortcut.
 *
 * Returned rather than prevented. A user rebinding one shortcut onto another's
 * key has usually not finished yet, and refusing the first half of a swap makes
 * swapping impossible; the settings list says which keys are contested and
 * lets them sort it out.
 */
export function conflicts(
  resolved: ResolvedShortcut[],
): Map<string, CommandId[]> {
  const claims = new Map<string, CommandId[]>();
  for (const shortcut of resolved) {
    if (!shortcut.active || shortcut.binding === "") continue;
    const key = normalise(shortcut.binding);
    claims.set(key, [...(claims.get(key) ?? []), shortcut.id]);
  }
  return new Map([...claims].filter(([, ids]) => ids.length > 1));
}

/**
 * A binding in a comparable form.
 *
 * `Mod-Shift-b` and `Shift-Mod-B` are the same shortcut, and a conflict check
 * that missed that would report no conflict for two bindings that fight.
 */
export function normalise(binding: string): string {
  return binding
    .split(" ")
    .map((step) =>
      step
        .split("-")
        .map((part) => (part.length === 1 ? part.toLowerCase() : part))
        .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
        .join("-"),
    )
    .join(" ");
}

/** Modifiers sort before the key they modify. */
function order(part: string): number {
  const index = ["Mod", "Ctrl", "Cmd", "Meta", "Alt", "Shift"].indexOf(part);
  return index === -1 ? 99 : index;
}

/**
 * A binding as a person reads it.
 *
 * `Mod` becomes the key that is actually on their keyboard, and the steps of a
 * chord are separated by a comma — because "Ctrl+Space then R" is a sequence,
 * and writing it as `Ctrl+Space+R` says something else entirely.
 */
export function describe(
  binding: string,
  platform = navigator.platform,
): string {
  if (!binding) return "";
  const mac = /mac|iphone|ipad/i.test(platform);
  return binding
    .split(" ")
    .map((step) =>
      step
        .split("-")
        .map((part) => {
          if (part === "Mod") return mac ? "⌘" : "Ctrl";
          if (part === "Alt") return mac ? "⌥" : "Alt";
          if (part === "Shift") return mac ? "⇧" : "Shift";
          if (part === "Space") return "Space";
          return part.length === 1 ? part.toUpperCase() : part;
        })
        .join(mac ? "" : "+"),
    )
    .join(", ");
}
