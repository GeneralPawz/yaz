/**
 * Markdown, as a stream language.
 *
 * Written here rather than pulled in, because the alternative is a dependency
 * whose whole value would be highlighting six constructs. A stream language is
 * a tokeniser over one line at a time with a little state carried between
 * them — which is exactly enough for Markdown's block structure, and honestly
 * short of what a real parser gives.
 *
 * What it does not do is the part a parser would be needed for: nesting
 * emphasis inside links inside list items, or reference definitions resolved
 * across the document. A highlighter that is wrong about those is wrong about
 * colour, which is a smaller thing to be wrong about than the text.
 */

import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** What the tokeniser remembers between lines. */
interface State {
  /** Inside a fenced code block, and what fence opened it. */
  fence: string | null;
}

/** A fence: three or more backticks or tildes, and whatever follows them. */
const FENCE = /^\s*(`{3,}|~{3,})/;

export function markdown(): Extension {
  return StreamLanguage.define<State>({
    name: "markdown",

    startState: () => ({ fence: null }),

    token(stream, state) {
      // A fenced block swallows everything, including things that would
      // otherwise look like headings — which is most of what a code block in a
      // README is for.
      if (state.fence !== null) {
        const closing = FENCE.exec(stream.string);
        if (closing && closing[1]!.startsWith(state.fence[0]!)) {
          state.fence = null;
          stream.skipToEnd();
          return "meta";
        }
        stream.skipToEnd();
        return "string";
      }

      if (stream.sol()) {
        const opening = FENCE.exec(stream.string);
        if (opening) {
          state.fence = opening[1]!;
          stream.skipToEnd();
          return "meta";
        }

        // A heading is the whole line, so that its size and weight apply to it
        // rather than to the hashes.
        if (stream.match(/^\s{0,3}#{1,6}\s/)) {
          stream.skipToEnd();
          return "heading";
        }
        if (stream.match(/^\s{0,3}>/)) {
          stream.skipToEnd();
          return "quote";
        }
        // A rule, before the list marker below reads its dashes as bullets.
        if (stream.match(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/)) return "meta";
        if (stream.match(/^\s*([-*+]|\d+[.)])\s/)) return "list";
      }

      if (stream.match(/^`[^`]*`/)) return "string";
      if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return "link";
      if (stream.match(/^(\*\*|__)(?=\S)[\s\S]*?\S\1/)) return "strong";
      if (stream.match(/^([*_])(?=\S)[^*_]*?\S\1/)) return "emphasis";

      // Nothing matched: one character, so the tokeniser always advances.
      stream.next();
      return null;
    },

    languageData: {
      commentTokens: { block: { open: "<!--", close: "-->" } },
    },
  });
}
