/**
 * Rendering a short stretch of LaTeX to HTML.
 *
 * Used where the rich-text view has to draw text it cannot leave in the buffer
 * — inside a table cell, or as a list's own label. Everywhere else the text
 * stays where the author wrote it and is merely decorated, which is the whole
 * design (ADR-0004); this is for the places a widget has to exist at all.
 *
 * # Escaping
 *
 * Everything the document supplies is escaped before it becomes HTML. The
 * exception is KaTeX's output, which is markup by construction and is trusted
 * for that reason and no other.
 */

import { renderMath } from "./math";
import { matchBrace } from "./structure";

/** Commands that wrap their argument in an element. */
const WRAPPERS: Record<string, { tag: string; className?: string }> = {
  textbf: { tag: "strong" },
  textit: { tag: "em" },
  emph: { tag: "em" },
  texttt: { tag: "code" },
  underline: { tag: "u" },
  textsc: { tag: "span", className: "cm-yaz-smallcaps" },
};

/** Commands that stand for a character. */
const SYMBOLS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  textemdash: "—",
  textendash: "–",
  copyright: "©",
  pounds: "£",
  textbackslash: "\\",
};

/** Make text safe to place in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a fragment of LaTeX as HTML.
 *
 * Handles the inline commands the rich-text view already knows, `$…$`
 * mathematics, escaped characters and a few symbol commands. A command it does
 * not know keeps its argument and loses its name, which is the same rule the
 * outline uses: the words matter more than the markup around them.
 */
export function inlineHtml(source: string): string {
  let out = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (character === "\\") {
      const rest = source.slice(index + 1);
      const name = /^[a-zA-Z]+/.exec(rest)?.[0];

      if (!name) {
        const escaped = source[index + 1];
        // `\\` is a line break, and a cell that contained one would have been
        // split before reaching here. Dropping it beats printing a backslash.
        if (escaped !== undefined && escaped !== "\\")
          out += escapeHtml(escaped);
        index += 1;
        continue;
      }

      let cursor = index + 1 + name.length;
      // LaTeX swallows the spaces that end a control word.
      while (source[cursor] === " ") cursor += 1;

      if (source[cursor] === "{") {
        const end = matchBrace(source, cursor);
        if (end !== null) {
          const inner = inlineHtml(source.slice(cursor + 1, end - 1));
          const wrapper = WRAPPERS[name];
          out += wrapper
            ? `<${wrapper.tag}${wrapper.className ? ` class="${wrapper.className}"` : ""}>${inner}</${wrapper.tag}>`
            : inner;
          index = end - 1;
          continue;
        }
      }

      const symbol = SYMBOLS[name];
      if (symbol) out += escapeHtml(symbol);
      // Anything else with no argument — `\hline`, a spacing command, a macro
      // from the author's own preamble — leaves nothing behind.
      index = cursor - 1;
      continue;
    }

    if (character === "$") {
      const close = source.indexOf("$", index + 1);
      if (close !== -1) {
        const rendered = renderMath(source.slice(index + 1, close), false);
        // KaTeX output is markup; anything it refused stays as the source the
        // author typed, delimiters and all.
        out += rendered ?? escapeHtml(source.slice(index, close + 1));
        index = close;
        continue;
      }
    }

    if (character === "{" || character === "}") continue;
    if (character === "~") {
      out += "&nbsp;";
      continue;
    }

    out += escapeHtml(character);
  }

  return out;
}
