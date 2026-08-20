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

import { environments, headings, matchBrace, plainText } from "./structure";
import { sectionNumbers } from "./semantics";
import { Kind, tokensIn } from "./tokens";
import { renderingOf } from "./vocabulary";

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
  /**
   * What names this entry elsewhere in the document, where anything does.
   *
   * A glossary entry is reached by its key rather than by its name — `\gls{BIM}`
   * names the key — so the key travels with the entry. Null for a listing whose
   * lines are not named, which is every listing but the glossary.
   */
  key: string | null;
}

/*
 * Which command stands for which list is not decided here.
 *
 * `\tableofcontents` is LaTeX's and `\printglossaries` is the glossaries
 * package's, so the set depends on what is installed
 * ([`vocabulary.ts`](./vocabulary.ts)). The name is still read out of the text
 * once and looked up, which is what stops `\printglossaries` being read as
 * `\printglossary` with three characters left over.
 */

/** How a page is ended. */
export type BreakKind =
  "cleardoublepage" | "clearpage" | "newpage" | "pagebreak";

/** A command that ends a page. */
export interface PageBreak {
  kind: BreakKind;
  from: number;
  to: number;
}

/**
 * Walk the text once, handing each command outside a comment to `visit`.
 *
 * The shape is dictated by where this runs. A hundred-page manuscript holds
 * something like fifteen thousand commands, and this happens on every
 * keystroke — so the name is read once and looked up, rather than each of a
 * dozen candidates being tried against every backslash in the document.
 *
 * The document is not walked here. `tokens.ts` walks it once for the whole
 * decoration pass and this reads the result — which is the difference between
 * a scanner whose cost follows the number of characters in a document and one
 * whose cost follows the number of commands in it.
 */
function eachCommand(
  text: string,
  visit: (name: string, at: number, after: number) => void,
): void {
  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command) continue;
    visit(token.name, token.at, token.after);
  }
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

/**
 * All three, from one walk of the text.
 *
 * Separately they would be three passes over a hundred-page manuscript on
 * every keystroke, for constructs that are a few dozen characters in total.
 */
export function generatedIn(text: string): Generated {
  const found: Generated = { listings: [], breaks: [], machinery: [] };

  eachCommand(text, (name, at, after) => {
    const rendering = renderingOf(name);
    if (!rendering) return;

    switch (rendering.kind) {
      case "listing":
        found.listings.push({
          kind: rendering.listing,
          from: at,
          // `\bibliography{refs}` names its file; the rest take at most an
          // option, and the vocabulary says which is which.
          to: pastArguments(text, after, rendering.braces ?? 0),
        });
        break;
      case "pagebreak":
        found.breaks.push({ kind: name as BreakKind, from: at, to: after });
        break;
      case "setting":
        // The arguments go with it: `\addcontentsline{toc}{chapter}{Glossar}`
        // is bookkeeping all the way to its last brace.
        found.machinery.push({
          from: at,
          to: pastArguments(text, after, rendering.braces),
        });
        break;
      case "silent":
        found.machinery.push({ from: at, to: after });
        break;
      default:
        break;
    }
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
/**
 * How deep the contents goes.
 *
 * Three, which is `\subsubsection` — what `\setcounter{tocdepth}{2}` gives by
 * default in `report` and what a thesis actually has. Two showed a contents
 * with the numbered subsections missing, which read as the list being wrong
 * rather than as being shallow.
 */
const CONTENTS_DEPTH = 3;

/** The contents, from the document's own headings. */
export function contentsEntries(text: string): Entry[] {
  const found = headings(text);
  const numbers = sectionNumbers(found);
  return found
    .filter((heading) => heading.level <= CONTENTS_DEPTH)
    .map((heading) => ({
      label: plainText(heading.title),
      // The number LaTeX will print in front of it — `2.1.3` — carried as the
      // detail so the list reads as a table of contents rather than as an
      // indented outline. A starred heading has none, which is correct: it is
      // not numbered in the document either.
      detail: numbers.get(heading.from) ?? null,
      level: heading.level,
      at: heading.titleFrom,
      key: null,
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
        key: null,
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
      key: null,
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

  eachCommand(text, (name, _at, after) => {
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
        key: text.slice(after + 1, key - 1).trim(),
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
      key: text.slice(after + 1, key - 1).trim(),
    });
  });

  // Alphabetical, and by the *key* — which is what `\printglossaries` sorts by
  // and is not always what the entry is called. `\newglossaryentry{BIM}` sorts
  // under B whatever its `name` field says.
  //
  // Sorted here rather than left in source order because a glossary in the
  // order somebody happened to define its terms is not a glossary; it is a
  // list, and the reader cannot look anything up in it.
  return found.sort((left, right) =>
    (left.key ?? left.label).localeCompare(
      right.key ?? right.label,
      undefined,
      {
        sensitivity: "base",
        numeric: true,
      },
    ),
  );
}

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
