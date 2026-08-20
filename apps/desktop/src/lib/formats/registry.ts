/**
 * What kind of text a file is, and what the editor can do about it.
 *
 * # Every text file opens
 *
 * The editor is not a LaTeX editor that also happens to hold other files. A
 * project has a `.bib`, a `yaz.toml`, a CI workflow, a README — and until now
 * each of those opened as LaTeX, which is worse than opening as nothing:
 * `%` became a comment in a file where it is a per cent sign.
 *
 * So the floor is a plain text editor with line numbers, wrapping, Vim and
 * search, which works for any file at all. A format adds to that floor; it is
 * never what makes the file openable.
 *
 * # And the extra is a plugin, loaded when it is needed
 *
 * Each format's language is behind a dynamic import, so a session that never
 * opens a `.yaml` never loads the YAML mode. The registry holds the loaders
 * rather than the languages themselves, which is what keeps that true —
 * importing a language here to name it would load all of them at startup.
 *
 * Each can be switched off, and off means the plain text floor rather than
 * nothing: someone who finds a highlighter wrong about their file wants their
 * file, not an error.
 */

import type { Extension } from "@codemirror/state";

/** A format the editor knows something about. */
export type FormatId =
  "latex" | "markdown" | "toml" | "yaml" | "bibtex" | "text";

/** What a format is, apart from its language. */
export interface Format {
  id: FormatId;
  /** The extensions that name it, without the dot, lowercased. */
  extensions: string[];
  /** Message key for its name in settings. */
  labelKey: string;
  /**
   * Load the language support.
   *
   * `null` for plain text, which needs none — and that is the difference
   * between a format with a plugin and the floor every file gets.
   */
  load: (() => Promise<Extension>) | null;
}

/**
 * The formats, in the order settings lists them.
 *
 * LaTeX is first and is not optional: it is what the application is for, and
 * an editor whose LaTeX support can be switched off is an editor with a
 * setting nobody should touch.
 */
export const FORMATS: Format[] = [
  {
    id: "latex",
    extensions: ["tex", "sty", "cls", "clo", "def", "ltx"],
    labelKey: "format-latex",
    load: async () => {
      const [{ StreamLanguage }, { stex }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/stex"),
      ]);
      return StreamLanguage.define(stex);
    },
  },
  {
    id: "markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    labelKey: "format-markdown",
    load: async () => (await import("./markdown")).markdown(),
  },
  {
    id: "toml",
    extensions: ["toml"],
    labelKey: "format-toml",
    load: async () => {
      const [{ StreamLanguage }, { toml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/toml"),
      ]);
      return StreamLanguage.define(toml);
    },
  },
  {
    id: "yaml",
    extensions: ["yaml", "yml"],
    labelKey: "format-yaml",
    load: async () => {
      const [{ StreamLanguage }, { yaml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/yaml"),
      ]);
      return StreamLanguage.define(yaml);
    },
  },
  {
    id: "bibtex",
    extensions: ["bib", "bibtex"],
    labelKey: "format-bibtex",
    load: async () => (await import("./bibtex")).bibtex(),
  },
  {
    id: "text",
    extensions: [],
    labelKey: "format-text",
    load: null,
  },
];

/** Formats whose support can be switched off. */
export const OPTIONAL_FORMATS = FORMATS.filter(
  (format) => format.id !== "latex" && format.id !== "text",
);

/** Which format a path names. */
export function formatOf(path: string): FormatId {
  const name = path.toLowerCase();
  // The final extension, and `.tex.bak` is not a `.tex`.
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";

  const found = FORMATS.find((format) => format.extensions.includes(extension));
  return found?.id ?? "text";
}

/** The format with an id, or plain text. */
export function format(id: FormatId): Format {
  return FORMATS.find((candidate) => candidate.id === id) ?? FORMATS.at(-1)!;
}

/** Which formats are switched on. Absent means on, so a new one arrives on. */
export type FormatPreferences = Partial<Record<FormatId, boolean>>;

/**
 * Whether a format's own support should be used.
 *
 * LaTeX and plain text are never off: one is what the application is, and the
 * other is the floor that makes every file openable.
 */
export function isEnabled(
  id: FormatId,
  preferences: FormatPreferences,
): boolean {
  if (id === "latex" || id === "text") return true;
  return preferences[id] !== false;
}

/**
 * Load a format's language, or nothing.
 *
 * Nothing is a perfectly good answer: it leaves the plain text editor, which
 * is what a file of an unknown format gets and what a switched-off format
 * falls back to.
 */
export async function languageFor(
  id: FormatId,
  preferences: FormatPreferences,
): Promise<Extension | null> {
  if (!isEnabled(id, preferences)) return null;
  const found = format(id);
  if (!found.load) return null;
  try {
    return await found.load();
  } catch {
    // A chunk that will not load leaves the floor rather than an empty pane.
    return null;
  }
}
