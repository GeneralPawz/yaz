/**
 * Reading structure out of LaTeX source.
 *
 * Shared by the outline view and the rich-text decorations, because they are
 * asking the same question — where are the constructs and what do they contain —
 * and two answers would drift apart.
 *
 * # Deliberately not a parser
 *
 * This scans for a fixed set of commands and matches their braces. It does not
 * build a syntax tree, expand macros or understand `\newcommand`, and it will
 * never be right about a document that redefines `\section`.
 *
 * That is the correct amount of machinery for what it feeds. An outline that
 * misses a heading in a pathological document is a mildly wrong list; the real
 * syntax tree arrives with the Lezer grammar in phase 4
 * ([ADR-0004](https://generalpawz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer)),
 * and these consumers will move onto it. Writing a half-parser now would be
 * building the thing that replaces itself.
 */

/** Sectioning commands, outermost first. The index is the level. */
const SECTION_COMMANDS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const;

/** A heading found in the source. */
export interface Heading {
  /** Nesting depth: 0 for `\part`, 2 for `\section`, and so on. */
  level: number;
  /** The command, without the backslash. */
  command: string;
  /** The heading text, with markup left in. */
  title: string;
  /** Offset of the backslash. */
  from: number;
  /** Offset just past the closing brace. */
  to: number;
  /** Offset of the first character of the title. */
  titleFrom: number;
  /** Offset just past the last character of the title. */
  titleTo: number;
  /** Whether it was the starred form, which is unnumbered. */
  starred: boolean;
}

/**
 * Find the brace group starting at `open`, returning the index just past its
 * close.
 *
 * Counts nesting and honours escaping, so `\section{a \{ b}` and
 * `\section{The \emph{good} bit}` both end where a reader would expect. Returns
 * `null` for an unclosed group rather than guessing, which is what stops a
 * missing brace turning every following heading into nonsense.
 */
export function matchBrace(text: string, open: number): number | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      // A backslash escapes whatever follows, including a brace.
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

/**
 * Offsets that fall inside a comment.
 *
 * A `%` starts a comment unless escaped, and it runs to the end of the line.
 * Without this, a commented-out `\section` appears in the outline — which is
 * exactly the sort of thing people comment out.
 */
export function commentRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "%") {
      const end = text.indexOf("\n", index);
      ranges.push({ from: index, to: end === -1 ? text.length : end });
      index = end === -1 ? text.length : end;
    }
  }
  return ranges;
}

/** Whether an offset falls inside any of the ranges. */
function within(ranges: { from: number; to: number }[], offset: number): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}

/**
 * Every heading in the source, in document order.
 *
 * Handles the starred form and the optional short-title argument, both of which
 * are ordinary in a real paper: `\section*{Acknowledgements}` and
 * `\section[Short]{A rather longer title for the contents page}`.
 */
export function headings(text: string): Heading[] {
  const comments = commentRanges(text);
  const found: Heading[] = [];

  // Longest first, so `subsubsection` is not matched as `subsection`.
  const byLength = SECTION_COMMANDS.map((command, level) => ({ command, level })).sort(
    (a, b) => b.command.length - a.command.length,
  );

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\\") continue;
    if (within(comments, index)) continue;

    const match = byLength.find((candidate) =>
      text.startsWith(candidate.command, index + 1),
    );
    if (!match) continue;

    let cursor = index + 1 + match.command.length;
    // `\sectionname` is a different command, not a section.
    if (/[a-zA-Z]/.test(text[cursor] ?? "")) continue;

    const starred = text[cursor] === "*";
    if (starred) cursor += 1;

    // The optional short title, which is skipped rather than shown: the outline
    // should say what the section is called, and the short form exists for the
    // contents page.
    if (text[cursor] === "[") {
      const close = text.indexOf("]", cursor);
      if (close === -1) continue;
      cursor = close + 1;
    }

    if (text[cursor] !== "{") continue;
    const end = matchBrace(text, cursor);
    if (end === null) continue;

    found.push({
      level: match.level,
      command: match.command,
      title: text.slice(cursor + 1, end - 1),
      from: index,
      to: end,
      titleFrom: cursor + 1,
      titleTo: end - 1,
      starred,
    });
    index = end - 1;
  }

  return found;
}

/**
 * Strip the markup a heading title may contain, for display in a list.
 *
 * Removes commands while keeping their argument, so `The \emph{good} bit` reads
 * as `The good bit`. Not a renderer — the outline is a list of labels, and a
 * label that shows `\emph{}` is worse than one that shows the words.
 */
export function plainText(title: string): string {
  let out = "";
  for (let index = 0; index < title.length; index += 1) {
    const character = title[index];
    if (character === "\\") {
      // An escaped character is literal: `\&` is an ampersand.
      const next = title[index + 1] ?? "";
      if (/[a-zA-Z]/.test(next)) {
        // A command: skip its name, and drop a following brace pair's braces
        // while keeping the contents.
        let cursor = index + 1;
        while (cursor < title.length && /[a-zA-Z]/.test(title[cursor] ?? "")) cursor += 1;
        index = cursor - 1;
        continue;
      }
      out += next;
      index += 1;
      continue;
    }
    if (character === "{" || character === "}") continue;
    out += character;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The document title from `\title{...}`, when there is one. */
export function documentTitle(text: string): string | null {
  const comments = commentRanges(text);
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\\") continue;
    if (!text.startsWith("title", index + 1)) continue;
    if (within(comments, index)) continue;
    const cursor = index + 6;
    if (text[cursor] !== "{") continue;
    const end = matchBrace(text, cursor);
    if (end === null) continue;
    return plainText(text.slice(cursor + 1, end - 1));
  }
  return null;
}

/** A command applied to a single brace group, e.g. `\textbf{bold}`. */
export interface BraceCommand {
  /** The command, without the backslash. */
  command: string;
  /** Offset of the backslash. */
  from: number;
  /** Offset just past the closing brace. */
  to: number;
  /** Offset of the first character of the argument. */
  argFrom: number;
  /** Offset just past the last character of the argument. */
  argTo: number;
}

/**
 * Find every occurrence of the named one-argument commands.
 *
 * Nested occurrences are all reported — `\textbf{very \emph{good}}` yields both
 * — because the rich-text view styles them independently and hiding the inner
 * markup is the whole point.
 *
 * Comments are skipped, for the same reason headings skip them.
 */
export function braceCommands(text: string, names: readonly string[]): BraceCommand[] {
  const comments = commentRanges(text);
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const found: BraceCommand[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\\") continue;
    if (within(comments, index)) continue;

    const command = byLength.find((name) => text.startsWith(name, index + 1));
    if (!command) continue;

    const after = index + 1 + command.length;
    // `\textbfx` is not `\textbf`.
    if (/[a-zA-Z]/.test(text[after] ?? "")) continue;
    if (text[after] !== "{") continue;

    const end = matchBrace(text, after);
    if (end === null) continue;

    found.push({
      command,
      from: index,
      to: end,
      argFrom: after + 1,
      argTo: end - 1,
    });
    // Deliberately not skipping past `end`: a nested command inside the
    // argument must be found too.
  }

  return found;
}
