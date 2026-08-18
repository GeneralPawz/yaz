/**
 * Applying formatting to a selection.
 *
 * # Toggling, not just wrapping
 *
 * `Ctrl+B` on bold text has to make it not-bold. A command that only ever
 * wraps turns `\textbf{word}` into `\textbf{\textbf{word}}` on the second
 * press, which is how a shortcut stops being usable — you can no longer press
 * it without looking at what you have.
 *
 * So each command asks first: is the selection already inside this command? If
 * it is, the command comes off. The check is on the source, because the source
 * is the document (ADR-0004) — there is no separate model holding "this run is
 * bold" that could disagree with it.
 *
 * # With nothing selected
 *
 * The markup is inserted empty and the cursor put between the braces, which is
 * what pressing Ctrl+B before typing means everywhere else.
 */

import { braceCommands, environments, matchBrace } from "./structure";

/** An edit to apply. */
export interface Edit {
  changes: { from: number; to: number; insert: string }[];
  /** Where the selection ends up. */
  from: number;
  to: number;
}

/** The inline commands formatting can apply. */
export type InlineFormat =
  "textbf" | "textit" | "underline" | "texttt" | "textsc" | "emph";

/**
 * Wrap or unwrap a selection in an inline command.
 *
 * The unwrap case looks for a command of this kind whose argument *is* the
 * selection, or which contains it entirely — pressing Ctrl+B anywhere inside a
 * bold run should un-bold the run, not bold a word inside it.
 */
export function toggleInline(
  text: string,
  from: number,
  to: number,
  command: InlineFormat,
): Edit {
  const existing = braceCommands(text, [command]).find(
    (found) => found.argFrom <= from && found.argTo >= to,
  );

  if (existing) {
    // Remove `\command{` and its closing brace, and keep everything between.
    const inner = text.slice(existing.argFrom, existing.argTo);
    const shift = existing.argFrom - existing.from;
    return {
      changes: [{ from: existing.from, to: existing.to, insert: inner }],
      from: from - shift,
      to: to - shift,
    };
  }

  const selected = text.slice(from, to);
  const opening = `\\${command}{`;
  return {
    changes: [{ from, to, insert: `${opening}${selected}}` }],
    from: from + opening.length,
    to: from + opening.length + selected.length,
  };
}

/**
 * Wrap or unwrap the selected lines in an environment.
 *
 * Used for `quote`, which is a block: the whole paragraph is quoted, never
 * half of one, so this works in whole lines rather than at the selection's
 * exact edges.
 */
export function toggleEnvironment(
  text: string,
  from: number,
  to: number,
  name: string,
): Edit {
  const existing = environments(text, [name]).find(
    (found) => found.bodyFrom <= from && found.bodyTo >= to,
  );

  if (existing) {
    const body = text
      .slice(existing.bodyFrom, existing.bodyTo)
      .replace(/^\n|\n$/g, "");
    const shift = existing.bodyFrom - existing.from + 1;
    return {
      changes: [{ from: existing.from, to: existing.to, insert: body }],
      from: Math.max(from - shift, existing.from),
      to: Math.max(to - shift, existing.from),
    };
  }

  const start = text.lastIndexOf("\n", Math.max(from - 1, 0)) + 1;
  const finish =
    text.indexOf("\n", to) === -1 ? text.length : text.indexOf("\n", to);
  const body = text.slice(start, finish);
  const opening = `\\begin{${name}}\n`;
  return {
    changes: [
      { from: start, to: finish, insert: `${opening}${body}\n\\end{${name}}` },
    ],
    from: from + opening.length,
    to: to + opening.length,
  };
}

/** Sectioning commands by the level a shortcut names. */
const HEADINGS = ["section", "subsection", "subsubsection"];

/**
 * Make the current line a heading, or stop it being one.
 *
 * Pressing the same level again removes it, which is how the heading buttons in
 * a word processor behave — and without it there is no shortcut for "this is
 * not a heading after all".
 */
export function toggleHeading(
  text: string,
  at: number,
  level: 1 | 2 | 3,
): Edit {
  const command = HEADINGS[level - 1]!;
  const start = text.lastIndexOf("\n", Math.max(at - 1, 0)) + 1;
  const finish =
    text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at);
  const line = text.slice(start, finish);

  const heading =
    /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{/.exec(
      line,
    );

  if (heading) {
    const open = start + heading[0].length - 1;
    const close = matchBrace(text, open);
    const title =
      close === null
        ? line.slice(heading[0].length)
        : text.slice(open + 1, close - 1);
    const indent = heading[1] ?? "";

    // The same level again: back to plain text. A different level: re-mark it.
    if (heading[2] === command) {
      return {
        changes: [{ from: start, to: finish, insert: `${indent}${title}` }],
        from: start + indent.length,
        to: start + indent.length + title.length,
      };
    }
    const replacement = `${indent}\\${command}{${title}}`;
    return {
      changes: [{ from: start, to: finish, insert: replacement }],
      from: start + replacement.length - 1,
      to: start + replacement.length - 1,
    };
  }

  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const title = line.trim();
  const replacement = `${indent}\\${command}{${title}}`;
  return {
    changes: [{ from: start, to: finish, insert: replacement }],
    from: start + replacement.length - 1,
    to: start + replacement.length - 1,
  };
}

/**
 * Strip the inline formatting from a selection.
 *
 * Only the commands formatting applies — an unknown command in the selection is
 * the author's and is left alone. "Clear formatting" that also removed a
 * `\cite` would be a data-loss button wearing a tidy label.
 */
export function clearFormatting(text: string, from: number, to: number): Edit {
  const known: InlineFormat[] = [
    "textbf",
    "textit",
    "underline",
    "texttt",
    "textsc",
    "emph",
  ];
  const inside = braceCommands(text, known).filter(
    (found) => found.from >= from && found.to <= to,
  );
  if (inside.length === 0) return { changes: [], from, to };

  // Innermost first, so removing an outer command does not move the offsets of
  // an inner one that has not been removed yet.
  const ordered = [...inside].sort((a, b) => b.from - a.from);
  const changes = ordered.map((found) => ({
    from: found.from,
    to: found.to,
    insert: text.slice(found.argFrom, found.argTo),
  }));

  const removed = inside.reduce(
    (total, found) =>
      total + (found.to - found.from) - (found.argTo - found.argFrom),
    0,
  );
  return { changes, from, to: to - removed };
}
