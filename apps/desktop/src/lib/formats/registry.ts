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

/**
 * A format the editor knows something about.
 *
 * The built-in ones are named; a plugin's is whatever string it registered,
 * which is why this is not a closed union. Closing it would mean a plugin
 * could not name a format the application had not heard of, which is the
 * point of letting a plugin contribute one.
 */
export type FormatId =
  "latex" | "markdown" | "toml" | "yaml" | "bibtex" | "text" | (string & {});

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
 * The formats the application itself knows.
 *
 * Two, and both are here because neither can be a plugin's. LaTeX is what the
 * application is for, and an editor whose LaTeX support could be switched off
 * would have a setting nobody should touch. Plain text is the floor that makes
 * every file openable, and a floor supplied by a plugin is a floor that can go
 * missing.
 *
 * Everything else — Markdown, TOML, YAML, BibTeX — is contributed by
 * `yaz-formats` through `registerFormat`, which is what proves the
 * contribution API works before anyone outside meets it (ADR-0005, ADR-0021).
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
    id: "text",
    extensions: [],
    labelKey: "format-text",
    load: null,
  },
];

/**
 * Formats a plugin taught the editor about, added to the built-in ones.
 *
 * A separate list rather than a mutated `FORMATS`, so that what ships and what
 * was contributed stay distinguishable — which is what makes "why is this file
 * highlighted like that" answerable.
 *
 * Contributed formats are consulted *after* the built-in ones, so a plugin
 * cannot take `.tex` away from LaTeX by claiming it. A plugin that wants to
 * replace a built-in format is a thing to decide deliberately, not something
 * to fall out of load order.
 */
let contributed: Format[] = [];

/** Replace the contributed formats. Called when plugins finish loading. */
export function setContributedFormats(formats: Format[]): void {
  contributed = formats;
}

/** Every format the editor knows, built in and contributed. */
export function allFormats(): Format[] {
  return [...FORMATS, ...contributed];
}

/** Formats whose support can be switched off. */
export function optionalFormats(): Format[] {
  return allFormats().filter(
    (format) => format.id !== "latex" && format.id !== "text",
  );
}

/** Which format a path names. */
export function formatOf(path: string): FormatId {
  const name = path.toLowerCase();
  // The final extension, and `.tex.bak` is not a `.tex`.
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";

  const found = allFormats().find((format) =>
    format.extensions.includes(extension),
  );
  return found?.id ?? "text";
}

/** The format with an id, or plain text. */
export function format(id: FormatId): Format {
  return (
    allFormats().find((candidate) => candidate.id === id) ??
    FORMATS.find((candidate) => candidate.id === "text")!
  );
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
