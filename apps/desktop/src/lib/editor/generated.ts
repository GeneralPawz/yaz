/**
 * The parts of a document LaTeX generates rather than the author writing them.
 *
 * `\tableofcontents` is one word in the source and eight pages in the PDF. In
 * source view that asymmetry is honest; in rich text it is a hole where a
 * reader expects the contents to be, which is the one place in the document
 * where they most want to look.
 *
 * # Built from the buffer, not from the build
 *
 * These lists are drawn from what is in the buffer — the headings for the
 * contents, the captions for the figures, the glossary entries for the
 * glossary. That is deliberately *not* what LaTeX will produce: page numbers
 * come from typesetting, and numbering depends on counters this does not track.
 *
 * So what is drawn is a contents list, and what the PDF gets is the contents
 * list. Which makes stitched mode ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing))
 * the difference between a document that can show its own structure and one
 * that cannot: a `main.tex` on its own holds no headings at all, so the list
 * has nothing to draw and says so.
 *
 * Everything here is a pure function over the text, for the same reason the
 * stitching is — it is checkable without a browser.
 */

import {
  commentRanges,
  environments,
  headings,
  matchBrace,
  plainText,
} from "./structure";

/** Which generated list a command stands for. */
export type ListingKind =
  "contents" | "figures" | "tables" | "glossary" | "bibliography" | "index";

/** A command that stands in for a generated list. */
export interface Listing {
  kind: ListingKind;
  /** Offset of the backslash. */
  from: number;
  /** Offset past the command and any arguments it took. */
  to: number;
}

/** One line of a generated list. */
export interface Entry {
  /** What to show. */
  label: string;
  /** The second line, where there is one — a description, or a caption's kind. */
  detail: string | null;
  /** Nesting, for indenting. Zero is flush left. */
  level: number;
  /** Where in the buffer the thing itself is, so the line can be clicked. */
  at: number;
}

/**
 * The commands, by name.
 *
 * A map rather than a list because the name is read out of the text once and
 * looked up, which also means `\printglossaries` can never be read as
 * `\printglossary` with three characters left over.
 */
const LISTING_KINDS = new Map<string, ListingKind>([
  ["tableofcontents", "contents"],
  ["listoffigures", "figures"],
  ["listoftables", "tables"],
  ["printglossaries", "glossary"],
  ["printglossary", "glossary"],
  ["printacronyms", "glossary"],
  ["printbibliography", "bibliography"],
  ["bibliography", "bibliography"],
  ["printindex", "index"],
]);

/** How a page is ended. */
export type BreakKind =
  "cleardoublepage" | "clearpage" | "newpage" | "pagebreak";

/** A command that ends a page. */
export interface PageBreak {
  kind: BreakKind;
  from: number;
  to: number;
}

const BREAK_KINDS = new Set<string>([
  "cleardoublepage",
  "clearpage",
  "newpage",
  "pagebreak",
]);

/**
 * Commands that arrange for something rather than saying anything.
 *
 * `\makeglossaries` does not appear in the document; it makes the glossary
 * possible. In rich text it is scaffolding standing in the middle of the room,
 * and the author who needs it can see it again in source view.
 */
const MACHINERY = new Set([
  "makeglossaries",
  "makeindex",
  "glsaddall",
  "glsresetall",
]);

/**
 * Walk the text once, handing each command outside a comment to `visit`.
 *
 * The shape is dictated by where this runs. A hundred-page manuscript holds
 * something like fifteen thousand commands, and this happens on every
 * keystroke — so the name is read once and looked up, rather than each of a
 * dozen candidates being tried against every backslash in the document.
 *
 * `first` is the cheapest filter there is: a caller that only cares about
 * commands beginning with `n` never pays to slice out `documentclass`.
 *
 * Character codes rather than characters throughout. `text[i]` allocates a
 * one-character string per character of the document, and a regular expression
 * to ask whether it is a letter allocates a match object per character on top
 * of that — measured over a joined thesis, the two together cost more than
 * everything else in this file put together.
 */
function eachCommand(
  text: string,
  first: ReadonlySet<number>,
  visit: (name: string, at: number, after: number) => void,
): void {
  const comments = commentRanges(text);
  let comment = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== BACKSLASH) continue;
    if (!first.has(text.charCodeAt(index + 1))) continue;

    while (comment < comments.length && comments[comment]!.to <= index) {
      comment += 1;
    }
    const range = comments[comment];
    if (range && index >= range.from && index < range.to) continue;

    let end = index + 1;
    while (end < text.length && isLetter(text.charCodeAt(end))) end += 1;
    visit(text.slice(index + 1, end), index, end);
    index = end - 1;
  }
}

const BACKSLASH = 92;

/** ASCII only, which is what a LaTeX command name is. */
function isLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

/** The character codes of a set of initials, for the filter above. */
function initials(letters: string): ReadonlySet<number> {
  return new Set([...letters].map((letter) => letter.charCodeAt(0)));
}

/** Skip an optional `[...]` and any number of `{...}` arguments. */
function pastArguments(text: string, at: number, braces: number): number {
  let cursor = at;
  if (text[cursor] === "[") {
    const close = text.indexOf("]", cursor);
    if (close === -1) return cursor;
    cursor = close + 1;
  }
  for (let taken = 0; taken < braces; taken += 1) {
    if (text[cursor] !== "{") break;
    const end = matchBrace(text, cursor);
    if (end === null) break;
    cursor = end;
  }
  return cursor;
}

/** Everything in a document that rich text draws rather than shows. */
export interface Generated {
  listings: Listing[];
  breaks: PageBreak[];
  machinery: { from: number; to: number }[];
}

/** The first letters every command below starts with. */
const INITIALS = initials("tlpbcnmga");

/**
 * All three, from one walk of the text.
 *
 * Separately they would be three passes over a hundred-page manuscript on
 * every keystroke, for constructs that are a few dozen characters in total.
 */
export function generatedIn(text: string): Generated {
  const found: Generated = { listings: [], breaks: [], machinery: [] };

  eachCommand(text, INITIALS, (name, at, after) => {
    const listing = LISTING_KINDS.get(name);
    if (listing) {
      // `\bibliography{refs}` names its file; the rest take at most an option.
      const braces = name === "bibliography" ? 1 : 0;
      found.listings.push({
        kind: listing,
        from: at,
        to: pastArguments(text, after, braces),
      });
      return;
    }

    if (BREAK_KINDS.has(name)) {
      found.breaks.push({ kind: name as BreakKind, from: at, to: after });
      return;
    }

    if (name === "addcontentsline") {
      // Three arguments, and all three are bookkeeping: which list, what level,
      // and the text that goes in it — which is already the heading below it.
      found.machinery.push({ from: at, to: pastArguments(text, after, 3) });
      return;
    }

    if (MACHINERY.has(name)) found.machinery.push({ from: at, to: after });
  });

  return found;
}

/** Every generated-list command in the text. */
export function listings(text: string): Listing[] {
  return generatedIn(text).listings;
}

/** Every page break in the text. */
export function pageBreaks(text: string): PageBreak[] {
  return generatedIn(text).breaks;
}

/** Every arranging command, and the range it occupies. */
export function machinery(text: string): { from: number; to: number }[] {
  return generatedIn(text).machinery;
}

/**
 * How deep the contents list goes.
 *
 * `report` and `book` show down to `\section` by default, which is two levels
 * below `\chapter`. Going deeper turns a page of contents into six.
 */
const CONTENTS_DEPTH = 2;

/** The contents, from the document's own headings. */
export function contentsEntries(text: string): Entry[] {
  return headings(text)
    .filter((heading) => heading.level <= CONTENTS_DEPTH)
    .map((heading) => ({
      label: plainText(heading.title),
      detail: null,
      level: heading.level,
      at: heading.titleFrom,
    }));
}

/** The environments each caption list draws from. */
const CAPTIONED: Record<"figures" | "tables", string[]> = {
  figures: ["figure", "figure*", "wrapfigure", "SCfigure"],
  tables: ["table", "table*", "longtable", "sidewaystable"],
};

/**
 * The captions of every figure, or of every table.
 *
 * The short form in `\caption[...]{...}` is what LaTeX puts in the list, so it
 * wins where it exists — that is the whole reason an author writes one.
 */
export function captionEntries(
  text: string,
  kind: "figures" | "tables",
): Entry[] {
  const found: Entry[] = [];

  for (const environment of environments(text, CAPTIONED[kind])) {
    const body = text.slice(environment.bodyFrom, environment.bodyTo);
    const caption = /\\caption\s*(\[)?/.exec(body);
    if (!caption) continue;

    let cursor = environment.bodyFrom + caption.index + caption[0].length;
    if (caption[1] === "[") {
      const close = text.indexOf("]", cursor);
      if (close === -1 || close > environment.bodyTo) continue;
      found.push({
        label: plainText(text.slice(cursor, close)),
        detail: null,
        level: 0,
        at: cursor,
      });
      continue;
    }

    // `cursor` is at the `{`, because the regex stopped before it.
    if (text[cursor] !== "{") {
      const brace = text.indexOf("{", cursor);
      if (brace === -1 || brace > environment.bodyTo) continue;
      cursor = brace;
    }
    const end = matchBrace(text, cursor);
    if (end === null) continue;
    found.push({
      label: plainText(text.slice(cursor + 1, end - 1)),
      detail: null,
      level: 0,
      at: cursor + 1,
    });
  }

  return found;
}

/**
 * The pattern for one field name, compiled once.
 *
 * Built per call, this was the most expensive thing in the file by a wide
 * margin: a glossary of fifty entries asks for two fields each, so a hundred
 * regular expressions were compiled per keystroke — more than the cost of
 * walking the whole document.
 */
const FIELD_PATTERNS = new Map<string, RegExp>();

function fieldPattern(name: string): RegExp {
  const known = FIELD_PATTERNS.get(name);
  if (known) return known;
  const pattern = new RegExp(`(^|[,{\\s])${name}\\s*=\\s*`);
  FIELD_PATTERNS.set(name, pattern);
  return pattern;
}

/** Read `name={...}` or `name=word` out of a glossary entry's fields. */
function field(fields: string, name: string): string | null {
  const at = fieldPattern(name).exec(fields);
  if (!at) return null;
  const start = at.index + at[0].length;
  if (fields[start] === "{") {
    const end = matchBrace(fields, start);
    return end === null ? null : fields.slice(start + 1, end - 1);
  }
  const end = fields.indexOf(",", start);
  return fields.slice(start, end === -1 ? undefined : end).trim();
}

/**
 * The glossary, from the entries the document defines.
 *
 * Both spellings: `\newglossaryentry{key}{name=…, description=…}` and the
 * acronym shorthand `\newacronym{key}{short}{long}`, which are the same thing
 * written two ways and appear in one list.
 */
export function glossaryEntries(text: string): Entry[] {
  const found: Entry[] = [];

  eachCommand(text, GLOSSARY_INITIAL, (name, _at, after) => {
    if (name === "newacronym") {
      const start = text[after] === "[" ? pastArguments(text, after, 0) : after;
      const key = matchBrace(text, start);
      if (key === null || text[key] !== "{") return;
      const short = matchBrace(text, key);
      if (short === null || text[short] !== "{") return;
      const long = matchBrace(text, short);
      if (long === null) return;
      found.push({
        label: text.slice(key + 1, short - 1),
        detail: plainText(text.slice(short + 1, long - 1)),
        level: 0,
        at: key + 1,
      });
      return;
    }

    if (name !== "newglossaryentry") return;
    const key = matchBrace(text, after);
    if (key === null || text[key] !== "{") return;
    const body = matchBrace(text, key);
    if (body === null) return;

    const fields = text.slice(key + 1, body - 1);
    const description = field(fields, "description");
    found.push({
      // The key is the fallback because an entry with no `name` still appears
      // in the glossary, under its key.
      label: field(fields, "name") ?? text.slice(after + 1, key - 1),
      detail: description === null ? null : plainText(description),
      level: 0,
      at: key + 1,
    });
  });

  return found;
}

/** Both spellings start with `n`, which is all the filter needs. */
const GLOSSARY_INITIAL = initials("n");

/** What a listing of each kind is built from. */
export function entriesFor(kind: ListingKind, text: string): Entry[] {
  switch (kind) {
    case "contents":
      return contentsEntries(text);
    case "figures":
      return captionEntries(text, "figures");
    case "tables":
      return captionEntries(text, "tables");
    case "glossary":
      return glossaryEntries(text);
    // A bibliography lives in a `.bib` and an index is built by a second tool.
    // Neither is in the buffer, so neither can be listed from it.
    case "bibliography":
    case "index":
      return [];
  }
}

/**
 * Whether a text has any of this in it at all.
 *
 * A cheap first look, so a document with no generated lists — which is most of
 * them — does not pay for four scans of itself on every keystroke.
 */
export function hasGenerated(text: string): boolean {
  return (
    text.includes("\\tableofcontents") ||
    text.includes("\\listof") ||
    text.includes("\\print") ||
    text.includes("\\bibliography") ||
    text.includes("\\clearpage") ||
    text.includes("\\cleardoublepage") ||
    text.includes("\\newpage") ||
    text.includes("\\pagebreak") ||
    text.includes("\\addcontentsline") ||
    text.includes("\\makeglossaries") ||
    text.includes("\\makeindex") ||
    text.includes("\\glsaddall") ||
    text.includes("\\glsresetall")
  );
}
