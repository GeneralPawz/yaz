/**
 * How many words will reach the PDF.
 *
 * # Why not just split on whitespace
 *
 * A `.tex` file is mostly not the document. The preamble is configuration, a
 * command is an instruction, a comment is a note to the author, and a label is
 * a name nobody reads. Counting the file gives a number that is wrong by a wide
 * and *varying* margin — and wrong in the flattering direction, which is the
 * worst kind for someone writing to a limit.
 *
 * So this counts what a reader would count: the words between
 * `\begin{document}` and `\end{document}`, with the machinery taken out.
 *
 * # It is an estimate and says so
 *
 * A count taken from source before it is typeset cannot be exact. A citation
 * becomes "(Smith, 2020)" — one word here, two or three in print. A macro may
 * expand to a sentence. `texcount` has the same problem and the same answer.
 * The interface labels this an estimate for that reason, rather than implying a
 * precision it does not have.
 */

import { commentRanges, environments } from "./structure";

/**
 * Environments whose contents are not prose.
 *
 * Mathematics is not words; a figure's contents are not words; a bibliography
 * is a list. Counting them makes a paper look longer than the part anyone has
 * to read.
 */
const NOT_PROSE = [
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "alignat",
  "alignat*",
  "displaymath",
  "eqnarray",
  "eqnarray*",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
  "verbatim",
  "lstlisting",
  "thebibliography",
  "tikzpicture",
];

/**
 * Commands whose argument is not read.
 *
 * `\label{eq:main}` names something; `\cite{smith}` is replaced by a citation
 * whose length nobody can know from here. Their arguments are dropped rather
 * than counted.
 */
const NOT_READ = new Set([
  "label",
  "ref",
  "eqref",
  "pageref",
  "cite",
  "citep",
  "citet",
  "input",
  "include",
  "usepackage",
  "documentclass",
  "bibliography",
  "bibliographystyle",
  "includegraphics",
]);

/** An estimate of the words that will be printed. */
export function countWords(text: string): number {
  return prose(text).split(/\s+/).filter(Boolean).length;
}

/**
 * The document reduced to the words a reader would see.
 *
 * Exported for the tests, which are much easier to read as "this source
 * becomes these words" than as a number.
 */
export function prose(text: string): string {
  const [document] = environments(text, ["document"]);
  // A fragment with no `\begin{document}` is an `\input`-ed chapter, which is
  // all body — counting nothing would be wrong for the file people most often
  // have open.
  let body = document ? text.slice(document.bodyFrom, document.bodyTo) : text;

  // Comments first: everything after them is a note to the author, and a
  // command inside one is not a command.
  const comments = commentRanges(body);
  for (const range of [...comments].reverse()) {
    body = body.slice(0, range.from) + body.slice(range.to);
  }

  // Then the environments that are not prose, innermost last so removing one
  // does not move the bounds of another still to be removed.
  const blocks = environments(body, NOT_PROSE).filter(
    (environment, _, all) =>
      !all.some(
        (other) =>
          other !== environment &&
          other.from < environment.from &&
          other.to > environment.to,
      ),
  );
  for (const block of [...blocks].reverse()) {
    body = body.slice(0, block.from) + body.slice(block.to);
  }

  return strip(body);
}

/**
 * Remove commands, keeping the words their arguments contain.
 *
 * `\textbf{loud}` is one word. `\label{x}` is none. The difference is the list
 * above, and anything unknown keeps its argument — a macro an author defined is
 * far more likely to print its argument than to swallow it.
 */
function strip(text: string): string {
  let out = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (character !== "\\") {
      // Braces are grouping, not text; `$` is a mathematics delimiter and what
      // is between a pair of them is not prose.
      if (character === "{" || character === "}") continue;
      if (character === "$") {
        const close = text.indexOf("$", index + 1);
        index = close === -1 ? text.length : close;
        continue;
      }
      out += character;
      continue;
    }

    const name = /^[a-zA-Z]+/.exec(text.slice(index + 1))?.[0];
    if (!name) {
      // An escaped character is a character: `\&` is an ampersand, and `50\%`
      // is one word rather than two.
      out += text[index + 1] ?? "";
      index += 1;
      continue;
    }

    let cursor = index + 1 + name.length;
    // The optional argument, which is never prose in the commands that take one.
    if (text[cursor] === "[") {
      const close = text.indexOf("]", cursor);
      cursor = close === -1 ? text.length : close + 1;
    }

    if (NOT_READ.has(name)) {
      // Drop the argument with the command.
      if (text[cursor] === "{") {
        let depth = 0;
        while (cursor < text.length) {
          if (text[cursor] === "{") depth += 1;
          else if (text[cursor] === "}") {
            depth -= 1;
            if (depth === 0) {
              cursor += 1;
              break;
            }
          }
          cursor += 1;
        }
      }
      // A command standing where a word was still separates the words either
      // side of it.
      out += " ";
      index = cursor - 1;
      continue;
    }

    // Anything else: the command goes, its argument stays and is walked into.
    out += " ";
    index = cursor - 1;
  }

  return out;
}
