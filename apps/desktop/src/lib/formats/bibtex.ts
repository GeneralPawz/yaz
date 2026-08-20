/**
 * BibTeX, as a stream language.
 *
 * A `.bib` is the file a LaTeX project reads most and edits least, and it was
 * opening as LaTeX — where `%` is a comment and `@article{` is nothing in
 * particular. It is a small, regular format: an entry type, a key, and fields
 * of `name = {value}`, so a tokeniser gets it almost exactly right.
 *
 * The one thing worth being careful about is the key. It is the name a
 * `\cite` uses, so it is the part of the file an author actually reads, and it
 * is highlighted as its own thing rather than as more field text.
 */

import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** What the tokeniser remembers between tokens. */
interface State {
  /** Inside an entry's braces. */
  inEntry: boolean;
  /** The next word is the citation key, not a field name. */
  expectingKey: boolean;
  /** Depth of braces inside a field's value. */
  depth: number;
}

export function bibtex(): Extension {
  return StreamLanguage.define<State>({
    name: "bibtex",

    startState: () => ({ inEntry: false, expectingKey: false, depth: 0 }),

    token(stream, state) {
      if (stream.eatSpace()) return null;

      // A comment is a whole line beginning with `%`, which is BibTeX's own
      // convention rather than LaTeX's mid-line one.
      if (stream.sol() && stream.peek() === "%") {
        stream.skipToEnd();
        return "comment";
      }

      if (!state.inEntry) {
        if (stream.match(/^@[a-zA-Z]+/)) {
          state.expectingKey = true;
          return "keyword";
        }
        if (stream.match(/^[{(]/)) {
          state.inEntry = true;
          return "bracket";
        }
        stream.next();
        return null;
      }

      if (state.expectingKey) {
        // The key: what every `\cite` in the document names.
        if (stream.match(/^[^\s,{}]+/)) {
          state.expectingKey = false;
          return "atom";
        }
        state.expectingKey = false;
      }

      if (state.depth > 0) {
        if (stream.match(/^[^{}]+/)) return "string";
        if (stream.eat("{")) {
          state.depth += 1;
          return "string";
        }
        if (stream.eat("}")) {
          state.depth -= 1;
          return state.depth === 0 ? "bracket" : "string";
        }
      }

      if (stream.eat("{")) {
        state.depth = 1;
        return "bracket";
      }
      if (stream.match(/^"[^"]*"/)) return "string";
      if (stream.match(/^[a-zA-Z][\w-]*(?=\s*=)/)) return "propertyName";
      if (stream.match(/^\d+/)) return "number";
      if (stream.eat("=")) return "operator";
      if (stream.eat(",")) return "punctuation";
      if (stream.eat("}") || stream.eat(")")) {
        state.inEntry = false;
        return "bracket";
      }

      stream.next();
      return null;
    },

    languageData: {
      commentTokens: { line: "%" },
    },
  });
}
