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
  if (text === memoisedText) return memoisedComments;

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

  memoisedText = text;
  memoisedComments = ranges;
  return ranges;
}

/**
 * The last answer, because everything here asks the same question first.
 *
 * A single decoration pass runs six scanners over one string, and each of them
 * needs to know where the comments are. Without this the document is walked
 * six extra times per keystroke, which is the budget ADR-0015 sets for the
 * whole keystroke. One entry is enough: the callers within a pass are handed
 * the same string, so the comparison is a pointer check.
 */
let memoisedText: string | null = null;
let memoisedComments: { from: number; to: number }[] = [];

/**
 * Whether an offset falls inside any of the ranges.
 *
 * A binary search rather than a scan. The ranges come out of
 * {@link commentRanges} in order, and this is asked once per backslash in the
 * document — a linear answer to a linear question is quadratic overall, and a
 * heavily commented draft is exactly where that would show.
 */
function within(
  ranges: { from: number; to: number }[],
  offset: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle]!;
    if (offset < range.from) high = middle - 1;
    else if (offset >= range.to) low = middle + 1;
    else return true;
  }
  return false;
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
  const byLength = SECTION_COMMANDS.map((command, level) => ({
    command,
    level,
  })).sort((a, b) => b.command.length - a.command.length);

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
        while (cursor < title.length && /[a-zA-Z]/.test(title[cursor] ?? ""))
          cursor += 1;
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
export function braceCommands(
  text: string,
  names: readonly string[],
): BraceCommand[] {
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

/** A `\begin{...}` … `\end{...}` pair found in the source. */
export interface Environment {
  /** The name as written, including any star: `itemize`, `align*`. */
  name: string;
  /** Offset of the `\begin` backslash. */
  from: number;
  /** Offset just past the closing brace of `\end{...}`. */
  to: number;
  /**
   * Offset just past `\begin{name}`.
   *
   * Deliberately *before* any arguments the environment takes — `tabular`'s
   * column specification, `minipage`'s width. Whether a following `{...}` is an
   * argument or the document's own text depends entirely on the environment, so
   * guessing here would mean guessing wrong for everything else.
   */
  bodyFrom: number;
  /** Offset of the `\end` backslash. */
  bodyTo: number;
  /** How many environments enclose this one. */
  depth: number;
}

/**
 * Every environment in the source, in document order.
 *
 * Pairs `\begin` with `\end` through a stack, so a nested `itemize` inside an
 * `itemize` closes in the right order. An `\end` with no open environment of
 * that name is ignored rather than closing whichever one happens to be open —
 * half-written source is the normal state of a document being typed, and
 * closing the wrong environment would make the rest of the file render as
 * something it is not.
 *
 * Pass `names` to filter; the stack still tracks every environment, because
 * pairing depends on the ones not asked for.
 */
export function environments(
  text: string,
  names?: readonly string[],
): Environment[] {
  const all =
    text === memoisedEnvironmentText ? memoisedEnvironments : scan(text);
  if (!names) return all;
  const wanted = new Set(names);
  return all.filter((environment) => wanted.has(environment.name));
}

/**
 * The last answer, for the same reason the comments are remembered.
 *
 * A decoration pass asks for tables, then for mathematics environments, then
 * for lists — three walks of the same document for three subsets of one
 * answer. Scanning once and filtering is the difference between three passes
 * and one, on the keystroke path.
 */
let memoisedEnvironmentText: string | null = null;
let memoisedEnvironments: Environment[] = [];

/** Every environment in the text, which {@link environments} then filters. */
function scan(text: string): Environment[] {
  const comments = commentRanges(text);
  const open: { name: string; from: number; bodyFrom: number }[] = [];
  const found: Environment[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\\") continue;
    if (within(comments, index)) continue;

    const begins = text.startsWith("begin", index + 1);
    const ends = !begins && text.startsWith("end", index + 1);
    if (!begins && !ends) continue;

    const cursor = index + 1 + (begins ? "begin".length : "end".length);
    // `\beginning` is not `\begin`.
    if (/[a-zA-Z]/.test(text[cursor] ?? "")) continue;
    if (text[cursor] !== "{") continue;

    const close = matchBrace(text, cursor);
    if (close === null) continue;
    const name = text.slice(cursor + 1, close - 1).trim();

    if (begins) {
      open.push({ name, from: index, bodyFrom: close });
    } else {
      let at = -1;
      for (let level = open.length - 1; level >= 0; level -= 1) {
        if (open[level]!.name === name) {
          at = level;
          break;
        }
      }
      if (at !== -1) {
        const opened = open[at]!;
        open.length = at;
        found.push({
          name,
          from: opened.from,
          to: close,
          bodyFrom: opened.bodyFrom,
          bodyTo: index,
          depth: at,
        });
      }
    }
    index = close - 1;
  }

  // The stack yields environments in closing order, which is not reading order.
  found.sort((a, b) => a.from - b.from);

  memoisedEnvironmentText = text;
  memoisedEnvironments = found;
  return found;
}

/** A stretch of mathematics, with the delimiters and what is between them. */
export interface MathSpan {
  /** Offset of the opening delimiter. */
  from: number;
  /** Offset just past the closing delimiter. */
  to: number;
  /** Offset of the first character of the mathematics. */
  bodyFrom: number;
  /** Offset just past the last character of the mathematics. */
  bodyTo: number;
  /** Display mathematics, set on its own line, rather than inline in a sentence. */
  display: boolean;
}

/** The delimiter pairs, longest opener first so `$$` is not read as two `$`. */
const MATH_DELIMITERS: { open: string; close: string; display: boolean }[] = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
];

/**
 * Find the closing delimiter, honouring escapes.
 *
 * Returns `null` when there is none — an unterminated `$` is a document being
 * typed, not a licence to treat the rest of the file as mathematics.
 */
function findDelimiter(text: string, at: number, close: string): number | null {
  for (let index = at; index <= text.length - close.length; index += 1) {
    if (text[index] === "\\") {
      // The closer may itself begin with a backslash, so it is checked before
      // the escape is consumed. Otherwise `\$` is a dollar sign and `\\` is a
      // line break, and neither closes anything.
      if (close.startsWith("\\") && text.startsWith(close, index)) return index;
      index += 1;
      continue;
    }
    if (text.startsWith(close, index)) return index;
  }
  return null;
}

/**
 * Every stretch of mathematics in the source.
 *
 * Covers the four delimiter pairs. Mathematics environments — `equation`,
 * `align` and the rest — are not here: they are environments, and
 * {@link environments} already finds them.
 *
 * A span may not contain a blank line. That is LaTeX's own rule for `$…$`, and
 * enforcing it is what stops `costs $5 and $10 more` in a draft from turning
 * the words between two prices into mathematics.
 */
export function mathSpans(text: string): MathSpan[] {
  const comments = commentRanges(text);
  const found: MathSpan[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\\") {
      const opener = MATH_DELIMITERS.find(
        (candidate) =>
          candidate.open.startsWith("\\") &&
          text.startsWith(candidate.open, index),
      );
      if (!opener) {
        // An escape: skip what it escapes, so `\$` never opens mathematics.
        index += 1;
        continue;
      }
      const span = readMath(text, index, opener, comments);
      if (span) {
        found.push(span);
        index = span.to - 1;
      } else {
        index += 1;
      }
      continue;
    }

    if (character !== "$") continue;
    const opener = text.startsWith("$$", index)
      ? MATH_DELIMITERS[0]!
      : MATH_DELIMITERS[3]!;
    const span = readMath(text, index, opener, comments);
    if (span) {
      found.push(span);
      index = span.to - 1;
    }
  }

  return found;
}

/** One span, or `null` if it does not close, is empty, or crosses a blank line. */
function readMath(
  text: string,
  from: number,
  opener: { open: string; close: string; display: boolean },
  comments: { from: number; to: number }[],
): MathSpan | null {
  if (within(comments, from)) return null;
  const bodyFrom = from + opener.open.length;
  const bodyTo = findDelimiter(text, bodyFrom, opener.close);
  if (bodyTo === null) return null;
  const body = text.slice(bodyFrom, bodyTo);
  if (/\n[ \t]*\n/.test(body)) return null;
  if (body.trim() === "") return null;
  return {
    from,
    to: bodyTo + opener.close.length,
    bodyFrom,
    bodyTo,
    display: opener.display,
  };
}

/**
 * Everything up to and including `\begin{document}`, when there is one.
 *
 * The preamble is machinery — packages, margins, macro definitions — and the
 * document being written is not it. Returns `null` for a fragment with no
 * `\begin{document}`, which is what an `\input`-ed chapter file looks like.
 */
export function preamble(text: string): { from: number; to: number } | null {
  for (
    let at = text.indexOf(BEGIN_DOCUMENT);
    at !== -1;
    at = text.indexOf(BEGIN_DOCUMENT, at + 1)
  ) {
    if (!commentedOut(text, at))
      return { from: 0, to: at + BEGIN_DOCUMENT.length };
  }
  return null;
}

/** What ends a preamble. */
const BEGIN_DOCUMENT = "\\begin{document}";

/**
 * Whether an offset sits after an unescaped `%` on its own line.
 *
 * A narrower question than {@link commentRanges} answers, and asked this way
 * because the preamble is looked for on the keystroke path: a native `indexOf`
 * and a scan of one line beats scanning the whole file for comments.
 */
function commentedOut(text: string, at: number): boolean {
  const start = text.lastIndexOf("\n", at) + 1;
  for (let index = start; index < at; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "%") return true;
  }
  return false;
}

/** An `\item` marker, with the optional label some lists give it. */
export interface ItemMarker {
  /** Offset of the backslash. */
  from: number;
  /** Offset just past the marker, including any `[label]` and the space after. */
  to: number;
  /** Offset of the first character of the label, when there is one. */
  labelFrom: number | null;
  /** Offset just past the label. */
  labelTo: number | null;
}

/**
 * Every `\item` in the source.
 *
 * Which list each belongs to is left to the caller, which knows the
 * environments: an item belongs to the innermost list containing it, and
 * working that out here would mean finding the environments twice.
 */
export function itemMarkers(text: string): ItemMarker[] {
  const comments = commentRanges(text);
  const found: ItemMarker[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\\") continue;
    if (within(comments, index)) continue;
    if (!text.startsWith("item", index + 1)) continue;

    let cursor = index + 1 + "item".length;
    // `\itemsep` is a length, not an item.
    if (/[a-zA-Z]/.test(text[cursor] ?? "")) continue;

    let labelFrom: number | null = null;
    let labelTo: number | null = null;
    if (text[cursor] === "[") {
      const close = text.indexOf("]", cursor);
      if (close !== -1) {
        labelFrom = cursor + 1;
        labelTo = close;
        cursor = close + 1;
      }
    }
    // Swallow the space that separates the marker from the text, so the
    // rendered bullet is not followed by a gap the author did not write.
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;

    found.push({ from: index, to: cursor, labelFrom, labelTo });
    index = cursor - 1;
  }

  return found;
}
