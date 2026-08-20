/**
 * Every command and every comment in a document, found in one walk.
 *
 * # Why this exists
 *
 * Rich text is a dozen scanners — headings, lists, mathematics, references,
 * citations, glossary entries, page breaks — and each of them used to walk the
 * whole document looking for a backslash. Measured against a joined thesis that
 * is 175,000 characters holding 2,072 commands: a walk costs about 3 ms and the
 * work at each command costs almost nothing, so eight scanners cost eight walks
 * and 3 ms became 30 — against the 16 ms ADR-0015 gives a whole keystroke.
 *
 * So the document is walked once, here, and every scanner reads the index. The
 * ratio is the point: the number of *commands* still grows with the document,
 * but a scanner's cost stops being tied to the number of *characters* in it.
 *
 * # Comments come from the same walk
 *
 * They have to be found by walking anyway — a `%` is a comment unless a
 * backslash escapes it, which is exactly the distinction this walk is already
 * making — and every scanner needs them. Finding them here rather than in a
 * second pass is free, and it is what lets this module depend on nothing.
 *
 * # Memoised on identity
 *
 * Every scanner in one decoration pass is handed the same string object, so the
 * comparison is a pointer check and only the first of them pays.
 */

/** What a token is. */
export const enum Kind {
  /** `\section`, `\gls` — a backslash and letters. */
  Command,
  /** `\,`, `\%`, `\\` — a backslash and exactly one other character. */
  Escape,
  /** `$` and `~`, which mean something without being commands. */
  Special,
}

/** One command-like thing in the text. */
export interface Token {
  kind: Kind;
  /** Offset of the backslash, or of the `$`/`~`. */
  at: number;
  /** Offset just past the name, the escaped character, or the special. */
  after: number;
  /** The command's name without the backslash. Empty unless `kind` is Command. */
  name: string;
  /**
   * The escaped character, or the special itself. Empty for a named command.
   */
  character: string;
}

/** A half-open range of the text. */
export interface Span {
  from: number;
  to: number;
}

/** What one walk of a document yields. */
export interface Index {
  /** Every command, escape and special, in the order they appear. */
  tokens: Token[];
  /** Every comment, from the `%` to the end of its line. */
  comments: Span[];
}

/**
 * Index a text.
 *
 * Nothing inside a comment is indexed at all — the walk steps over comments —
 * so a scanner reading this list never has to ask whether a command it found is
 * one the author switched off.
 *
 * Deliberately syntactic and shallow otherwise: this says *where* the commands
 * are and what they are called, never what they mean. Meaning is the caller's, which is
 * what lets one walk serve scanners that disagree about everything else.
 */
export function index(text: string): Index {
  if (text === memoisedText) return memoised;

  const tokens: Token[] = [];
  const comments: Span[] = [];

  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);

    if (code === PERCENT) {
      // A comment runs to the end of the line, and nothing in it is a command.
      const end = text.indexOf("\n", at);
      const to = end === -1 ? text.length : end;
      comments.push({ from: at, to });
      at = to;
      continue;
    }

    if (code === DOLLAR || code === TILDE) {
      tokens.push({
        kind: Kind.Special,
        at,
        after: at + 1,
        name: "",
        character: text[at]!,
      });
      continue;
    }

    if (code !== BACKSLASH) continue;

    let end = at + 1;
    while (end < text.length && isLetter(text.charCodeAt(end))) end += 1;

    if (end > at + 1) {
      tokens.push({
        kind: Kind.Command,
        at,
        after: end,
        name: text.slice(at + 1, end),
        character: "",
      });
      // Past the name, so `\alpha` is one token and not six.
      at = end - 1;
      continue;
    }

    // A backslash and one other character: `\,` is a thin space, `\%` is a per
    // cent sign that does *not* start a comment, and `\\` is a line break whose
    // second backslash must not be read as the start of another token.
    tokens.push({
      kind: Kind.Escape,
      at,
      after: at + 2,
      name: "",
      character: text[at + 1] ?? "",
    });
    at += 1;
  }

  memoisedText = text;
  memoised = { tokens, comments };
  return memoised;
}

/**
 * Every comment in the text.
 *
 * Kept as its own name because it is what a dozen callers ask for, and because
 * "the comments" is a thing about a document rather than a detail of how the
 * commands were found.
 */
export function commentRanges(text: string): Span[] {
  return index(text).comments;
}

/** Every command, escape and special in the text. */
export function tokensIn(text: string): Token[] {
  return index(text).tokens;
}

/**
 * Whether an offset falls inside one of a sorted list of ranges.
 *
 * A binary search, because this is asked once per command over a document with
 * thousands of them.
 */
export function within(ranges: readonly Span[], offset: number): boolean {
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

const BACKSLASH = 92;
const DOLLAR = 36;
const TILDE = 126;
const PERCENT = 37;

/** ASCII only, which is what a LaTeX command name is. */
function isLetter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

/** The last answer, for the reason the module comment gives. */
let memoisedText: string | null = null;
let memoised: Index = { tokens: [], comments: [] };
