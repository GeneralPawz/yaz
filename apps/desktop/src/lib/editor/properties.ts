/**
 * The standardised things a document declares, read from and written to the
 * source.
 *
 * # Why this is a text transformation and not a data model
 *
 * The ribbon lets someone set the author without knowing that an author is
 * `\author{...}` in the preamble. That is the whole point of it. But there is
 * still one document and it is the `.tex` (ADR-0004), so "the author" is not a
 * field held beside the source that has to be kept in step — it is read out of
 * the source when asked and written back into it when changed.
 *
 * Which means a co-author who types `\author{}` by hand and a co-author who
 * uses the ribbon are editing the same thing, and neither can produce a
 * document where the two disagree.
 *
 * # Where things go
 *
 * A property that is already there is edited where it is. One that is not is
 * inserted in the place LaTeX expects it — package options in the
 * `\documentclass` line or a `\usepackage`, title-block commands in the
 * preamble just above `\begin{document}`. Appending everything to the end of
 * the preamble would work and would produce a preamble nobody wants to read.
 */

import { environments, matchBrace, plainText } from "./structure";

/** What the ribbon can set. */
export interface Properties {
  title: string;
  author: string;
  date: string;
  /** The babel language, e.g. `ngerman`. Empty when the document sets none. */
  language: string;
  /** The paper size as `geometry` names it, e.g. `a4paper`. */
  paper: string;
}

/** An edit to apply. */
export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/** Paper sizes offered, in the order the ribbon lists them. */
export const PAPER_SIZES = [
  "a4paper",
  "a5paper",
  "letterpaper",
  "legalpaper",
  "b5paper",
] as const;

/** Their dimensions in millimetres, for drawing a page. */
export const PAPER_DIMENSIONS: Record<
  string,
  { width: number; height: number }
> = {
  a4paper: { width: 210, height: 297 },
  a5paper: { width: 148, height: 210 },
  letterpaper: { width: 216, height: 279 },
  legalpaper: { width: 216, height: 356 },
  b5paper: { width: 176, height: 250 },
};

/** What a document that says nothing is. */
export const DEFAULT_PAPER = "a4paper";

/** Languages offered, as babel names them. */
export const LANGUAGES = [
  { option: "english", labelKey: "language-english" },
  { option: "ngerman", labelKey: "language-german" },
  { option: "french", labelKey: "language-french" },
  { option: "spanish", labelKey: "language-spanish" },
  { option: "italian", labelKey: "language-italian" },
] as const;

/** Read a single-argument command's contents. */
function commandValue(text: string, name: string): string {
  const pattern = new RegExp(String.raw`\\${name}\s*\{`, "g");
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    // A commented-out `\title` is not the title.
    const lineStart = text.lastIndexOf("\n", open) + 1;
    if (/(^|[^\\])%/.test(text.slice(lineStart, match.index))) continue;
    const close = matchBrace(text, open);
    if (close !== null) return text.slice(open + 1, close - 1);
  }
  return "";
}

/** The options of a `\usepackage[...]{name}`, or `null` if it is absent. */
function packageOptions(
  text: string,
  name: string,
): { from: number; to: number; options: string } | null {
  const pattern = new RegExp(
    String.raw`\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}`,
    "g",
  );
  for (const match of text.matchAll(pattern)) {
    const packages = (match[2] ?? "").split(",").map((entry) => entry.trim());
    if (!packages.includes(name)) continue;
    return {
      from: match.index,
      to: match.index + match[0].length,
      options: match[1] ?? "",
    };
  }
  return null;
}

/** Everything the ribbon shows, read out of the source. */
export function readProperties(text: string): Properties {
  const geometry = packageOptions(text, "geometry");
  const paper =
    geometry?.options
      .split(",")
      .map((entry) => entry.trim())
      .find((entry) => entry.endsWith("paper")) ?? DEFAULT_PAPER;

  const babel = packageOptions(text, "babel");
  const language =
    babel?.options
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1) ?? "";

  return {
    title: plainText(commandValue(text, "title")),
    author: plainText(commandValue(text, "author")),
    date: commandValue(text, "date"),
    language,
    paper,
  };
}

/** Where the preamble ends — everything is inserted before this. */
function preambleEnd(text: string): number {
  const [document] = environments(text, ["document"]);
  return document?.from ?? text.length;
}

/**
 * Set one of the title-block commands.
 *
 * Edited in place when it is already there, and otherwise inserted just above
 * `\begin{document}` — where a reader looking for the title expects to find
 * it, rather than wherever the file happened to end.
 */
function setCommand(text: string, name: string, value: string): Edit | null {
  const pattern = new RegExp(String.raw`\\${name}\s*\{`, "g");
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const close = matchBrace(text, open);
    if (close === null) continue;
    if (text.slice(open + 1, close - 1) === value) return null;
    return { from: open + 1, to: close - 1, insert: value };
  }

  if (value === "") return null;
  const at = preambleEnd(text);
  return { from: at, to: at, insert: `\\${name}{${value}}\n` };
}

/**
 * Set a package option, adding the package if the document does not have it.
 *
 * The option is replaced rather than appended when one of its kind is already
 * there: `\usepackage[a4paper,a5paper]{geometry}` is not a document with two
 * paper sizes, it is a document with a mistake in it.
 */
function setPackageOption(
  text: string,
  name: string,
  value: string,
  matches: (option: string) => boolean,
): Edit | null {
  const existing = packageOptions(text, name);

  if (existing) {
    const options = existing.options
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const without = options.filter((option) => !matches(option));
    const next = value === "" ? without : [...without, value];
    if (next.join(",") === options.join(",")) return null;

    const replacement =
      next.length > 0
        ? `\\usepackage[${next.join(",")}]{${name}}`
        : `\\usepackage{${name}}`;
    return { from: existing.from, to: existing.to, insert: replacement };
  }

  if (value === "") return null;
  const at = preambleEnd(text);
  return { from: at, to: at, insert: `\\usepackage[${value}]{${name}}\n` };
}

/**
 * The edit that sets a property, or `null` when nothing needs to change.
 *
 * One edit at a time, because the ribbon changes one field at a time and an
 * edit that touched several would make undo mean something the author did not
 * do.
 */
export function setProperty(
  text: string,
  key: keyof Properties,
  value: string,
): Edit | null {
  switch (key) {
    case "title":
      return setCommand(text, "title", value);
    case "author":
      return setCommand(text, "author", value);
    case "date":
      return setCommand(text, "date", value);
    case "language":
      // Babel's language is an option rather than an argument, and the last
      // one listed is the document's main language.
      return setPackageOption(text, "babel", value, (option) =>
        LANGUAGES.some((language) => language.option === option),
      );
    case "paper":
      return setPackageOption(text, "geometry", value, (option) =>
        option.endsWith("paper"),
      );
  }
}
