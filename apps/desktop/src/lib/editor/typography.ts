/**
 * The declarations that change how the rest of a group is set.
 *
 * `{\huge\bfseries \thetitle \par}` is a title page's title, and until now the
 * rich-text view showed it as those words. Six of the nine lines of a real
 * title page are declarations like this, which is why it looked least like the
 * PDF exactly where it matters most — the first page anybody sees.
 *
 * # A declaration applies to its group
 *
 * `\huge` is not a command with an argument; it changes the size until the
 * enclosing group ends. So the range a declaration styles is found by looking
 * *backwards* for the brace that opened the group it is in — past whitespace
 * and past any other declarations, since `{\huge\bfseries X}` is two of them on
 * one group.
 *
 * The failure mode is deliberate and visible: a declaration that is not
 * immediately inside a group styles nothing, rather than being guessed at and
 * styling half a chapter.
 */

import { environments, matchBrace } from "./structure";
import { Kind, tokensIn } from "./tokens";

/** Size declarations, from smallest to largest, with their scale. */
export const SIZES: Record<string, number> = {
  tiny: 0.5,
  scriptsize: 0.6,
  footnotesize: 0.7,
  small: 0.85,
  normalsize: 1,
  large: 1.2,
  Large: 1.44,
  LARGE: 1.73,
  huge: 2.07,
  Huge: 2.49,
};

/** Shape and weight declarations, with the class each one draws as. */
export const SHAPES: Record<string, string> = {
  bfseries: "cm-yaz-strong",
  itshape: "cm-yaz-emphasis",
  slshape: "cm-yaz-emphasis",
  scshape: "cm-yaz-smallcaps",
  ttfamily: "cm-yaz-mono",
  sffamily: "cm-yaz-sans",
  upshape: "",
  mdseries: "",
  normalfont: "",
};

/** Declarations that set how a group is aligned. */
export const ALIGNMENTS: Record<string, string> = {
  centering: "center",
  raggedright: "start",
  raggedleft: "end",
};

/** One declaration and the range it applies to. */
export interface Declaration {
  /** The command, without the backslash. */
  command: string;
  /** Where the command itself sits, so it can be hidden. */
  from: number;
  to: number;
  /** The group it styles: from just inside the brace to just before its close. */
  bodyFrom: number;
  bodyTo: number;
}

/** Every declaration in the text, with the group each one applies to. */
export function declarations(text: string): Declaration[] {
  const found: Declaration[] = [];

  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command) continue;
    const known =
      token.name in SIZES || token.name in SHAPES || token.name in ALIGNMENTS;
    if (!known) continue;

    // An alignment is nearly always the first thing in an environment rather
    // than inside a brace — `\begin{titlepage}` then `\centering` is how every
    // title page is written — so it falls back to the environment it opens.
    const group =
      groupAround(text, token.at) ??
      (token.name in ALIGNMENTS ? environmentAround(text, token.at) : null);
    if (!group) continue;
    found.push({
      command: token.name,
      from: token.at,
      to: token.after,
      bodyFrom: group.from,
      bodyTo: group.to,
    });
  }

  return found;
}

/**
 * How far back a group's opening brace is looked for.
 *
 * Bounded because this runs on the keystroke path and because a declaration
 * whose brace is two thousand characters above it is not a declaration anyone
 * is reasoning about — it is a document that will surprise its author whatever
 * the editor draws.
 */
const LOOK_BACK = 64;

/**
 * The group a declaration sits at the start of.
 *
 * Immediately inside the brace, allowing whitespace and other declarations
 * before it — `{\huge\bfseries X}` is two declarations on one group, and
 * `{ \Large Text}` is one with a space in front of it.
 */
function groupAround(
  text: string,
  at: number,
): { from: number; to: number } | null {
  let cursor = at - 1;
  const floor = Math.max(0, at - LOOK_BACK);

  while (cursor >= floor) {
    const character = text[cursor];
    if (character === undefined) return null;

    if (character === "{") {
      const end = matchBrace(text, cursor);
      return end === null ? null : { from: cursor + 1, to: end - 1 };
    }
    if (/\s/.test(character)) {
      cursor -= 1;
      continue;
    }

    // Another declaration in front of this one. Step over its name and keep
    // looking: the brace belongs to both of them.
    if (/[a-zA-Z]/.test(character)) {
      let start = cursor;
      while (start > floor && /[a-zA-Z]/.test(text[start - 1] ?? ""))
        start -= 1;
      const name = text.slice(start, cursor + 1);
      const isDeclaration =
        name in SIZES || name in SHAPES || name in ALIGNMENTS;
      if (isDeclaration && text[start - 1] === "\\") {
        cursor = start - 2;
        continue;
      }
    }
    return null;
  }

  return null;
}

/**
 * The environment a declaration sits at the start of.
 *
 * Innermost first, so `\centering` inside a figure inside a landscape aligns
 * the figure. Only when the declaration is at the *start* of the body: an
 * alignment halfway down an environment applies from there to its end, and
 * drawing it as though it applied to the whole thing would move text that
 * LaTeX will leave where it is.
 */
function environmentAround(
  text: string,
  at: number,
): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null;

  for (const found of environments(text)) {
    if (at < found.bodyFrom || at >= found.bodyTo) continue;
    if (text.slice(found.bodyFrom, at).trim() !== "") continue;
    if (!best || found.bodyFrom > best.from) {
      best = { from: found.bodyFrom, to: found.bodyTo };
    }
  }

  return best;
}

/** A stretch of vertical space the document asks for. */
export interface VerticalSpace {
  from: number;
  to: number;
  /** How much, in `em`. Null for `\vfill`, which takes what is left. */
  em: number | null;
}

/** The fixed skips, in em. */
const SKIPS: Record<string, number> = {
  bigskip: 1,
  medskip: 0.5,
  smallskip: 0.25,
};

/**
 * A length in TeX's units, as a multiple of the body size.
 *
 * Approximate by nature — an `em` depends on the font — and that is the right
 * amount of precision for a view whose job is proportion rather than
 * typesetting.
 */
export function lengthInEm(value: string): number | null {
  const match = /^\s*(-?[\d.]+)\s*(cm|mm|in|pt|em|ex|baselineskip)?/.exec(
    value,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  switch (match[2]) {
    case "cm":
      return amount * 2.4;
    case "mm":
      return amount * 0.24;
    case "in":
      return amount * 6.1;
    case "pt":
      return amount / 12;
    case "ex":
      return amount * 0.5;
    case "baselineskip":
      return amount * 1.2;
    default:
      return amount;
  }
}

/** Every vertical space in the text. */
export function verticalSpaces(text: string): VerticalSpace[] {
  const found: VerticalSpace[] = [];

  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command) continue;

    if (token.name === "vfill") {
      found.push({ from: token.at, to: token.after, em: null });
      continue;
    }

    const skip = SKIPS[token.name];
    if (skip !== undefined) {
      found.push({ from: token.at, to: token.after, em: skip });
      continue;
    }

    if (token.name !== "vspace") continue;
    // `\vspace*` is the starred form, which differs only in whether the space
    // survives a page break — nothing this view is deciding.
    let cursor = token.after;
    if (text[cursor] === "*") cursor += 1;
    if (text[cursor] !== "{") continue;
    const end = matchBrace(text, cursor);
    if (end === null) continue;

    const em = lengthInEm(text.slice(cursor + 1, end - 1));
    if (em === null) continue;
    found.push({ from: token.at, to: end, em });
  }

  return found;
}

/**
 * What a document's own metadata commands stand for.
 *
 * A title page does not write the title; it writes `\thetitle`, which the
 * preamble `\let` to `\@title`. Resolving the handful that every template
 * defines is the difference between a title page that reads as one and a title
 * page that reads as a list of commands.
 *
 * Read from the source each time rather than held: there is one document and
 * it is the `.tex` (ADR-0004), so changing `\title{...}` changes the title
 * page in the same keystroke.
 */
export function metadata(text: string): Map<string, string> {
  const found = new Map<string, string>();

  // `\title{...}` and friends, and the `\def\thesubtitle{...}` that a template
  // builds out of `\newcommand{\subtitle}[1]{\def\thesubtitle{#1}}`.
  for (const [command, source] of [
    ["thetitle", "title"],
    ["theauthor", "author"],
    ["thedate", "date"],
    ["thesubtitle", "subtitle"],
    ["thereviewer", "reviewer"],
  ] as const) {
    const value = argumentOf(text, source);
    if (value !== null) found.set(command, value);
  }

  return found;
}

/**
 * Fill a document's metadata into a stretch of its source.
 *
 * For the places that are rendered from the text rather than decorated over
 * it — a table's cells, above all. The title page of the thesis this was built
 * against sets the author and the reviewer in a `tabular`, and a table is drawn
 * from its source, so `\theauthor` reached the screen as those letters.
 */
export function fillMetadata(
  text: string,
  declared: ReadonlyMap<string, string>,
): string {
  let filled = text;
  for (const [command, value] of declared) {
    filled = filled.split(`${BACKSLASH}${command}`).join(value);
  }
  return filled;
}

const BACKSLASH = String.fromCharCode(92);

/** The argument of the last `\name{...}` in the text, outside comments. */
function argumentOf(text: string, name: string): string | null {
  let value: string | null = null;

  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command || token.name !== name) continue;
    if (text[token.after] !== "{") continue;
    const end = matchBrace(text, token.after);
    if (end === null) continue;
    // The *definition* wins over an earlier one, which is what a template that
    // redefines its own title does.
    value = text.slice(token.after + 1, end - 1).trim();
  }

  return value;
}
