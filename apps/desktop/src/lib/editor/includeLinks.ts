/**
 * `\include{...}` as somewhere to click.
 *
 * The smaller half of the multi-file problem
 * ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)):
 * moving between files. It needs none of the stitching machinery, works in
 * single-file mode where most people will stay, and is also what is left for a
 * file stitched mode declined to expand — one that is missing, or included a
 * second time.
 *
 * # Only what is on screen
 *
 * The scan runs over the visible ranges rather than the document. A hundred-page
 * manuscript has perhaps twenty `\include`s and half a million characters, and
 * ADR-0015 does not allow the second number onto the keystroke path for the
 * sake of the first.
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

/** The commands that name another file. Kept in step with `stitch.ts`. */
const INCLUDE = /\\(?:include|input|subfile)\s*\{([^}\n]*)\}/g;

/** Where the argument sits in a line, and what it says. */
interface Link {
  from: number;
  to: number;
  argument: string;
}

/**
 * Whether an offset is inside a comment, judged from its own line.
 *
 * Locally rather than by parsing the document, because this runs as the user
 * types: a `%` earlier in the line comments the rest of it out unless it is
 * escaped, and nothing further up the file changes that.
 */
function commented(line: string, at: number): boolean {
  for (let i = 0; i < at; i += 1) {
    if (line[i] === "\\") {
      i += 1;
      continue;
    }
    if (line[i] === "%") return true;
  }
  return false;
}

/** Every clickable argument in a stretch of text starting at `offset`. */
export function linksIn(text: string, offset = 0): Link[] {
  const links: Link[] = [];

  for (const line of text.split("\n")) {
    for (const match of line.matchAll(INCLUDE)) {
      const argument = match[1] ?? "";
      if (argument.trim() === "") continue;
      if (commented(line, match.index)) continue;
      // The argument only. The command is LaTeX and stays styled as LaTeX;
      // what someone wants to click is the name of the file.
      const start = offset + match.index + match[0].indexOf(argument);
      links.push({ from: start, to: start + argument.length, argument });
    }
    offset += line.length + 1;
  }

  return links;
}

/**
 * Make the file names clickable, and tell the shell which one was clicked.
 *
 * The path is passed on as written. Resolving it against the file that contains
 * it is the shell's business — this extension does not know which file the
 * buffer is, and in stitched mode neither does the buffer.
 */
export function includeLinks(onOpen: (argument: string) => void): Extension {
  const decorate = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      for (const link of linksIn(view.state.doc.sliceString(from, to), from)) {
        builder.add(
          link.from,
          link.to,
          Decoration.mark({
            class: "cm-yaz-include-link",
            attributes: { "data-yaz-include": link.argument },
          }),
        );
      }
    }
    return builder.finish();
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorate(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [
    plugin,
    EditorView.domEventHandlers({
      mousedown(event) {
        const target = event.target as HTMLElement | null;
        const link = target?.closest?.("[data-yaz-include]");
        // Plain click, and only with a modifier held it would be a selection —
        // so the caret can still be put inside the path to edit it by hand.
        if (!link || event.button !== 0 || event.altKey) return false;
        const argument = link.getAttribute("data-yaz-include");
        if (!argument) return false;
        event.preventDefault();
        onOpen(argument);
        return true;
      },
    }),
    theme,
  ];
}

const theme = EditorView.baseTheme({
  ".cm-yaz-include-link": {
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "0.2em",
    color: "var(--yaz-syntax-reference)",
  },
  ".cm-yaz-include-link:hover": {
    textDecorationStyle: "solid",
    color: "var(--yaz-accent)",
  },
});
