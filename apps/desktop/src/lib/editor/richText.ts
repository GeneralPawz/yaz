/**
 * Rich text as decorations over the LaTeX buffer.
 *
 * # There is one document, and it is the `.tex`
 *
 * [ADR-0004](https://generalpawz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer)
 * decides this: there is a single CodeMirror buffer holding the raw source, and
 * rich text is *decorations over it* — never a second document model and never a
 * LaTeX↔document converter.
 *
 * The consequence is worth stating because it is the whole point. Editing in
 * rich text edits the `.tex`. There is no import, no export, no round trip and
 * nothing to lose in translation; undo is one stack; Vim works in both views
 * because there is only one document for it to work on; and a construct yaz does
 * not understand simply shows as itself rather than being silently rewritten by
 * a converter that did not recognise it.
 *
 * # Markup is hidden, not removed
 *
 * `\textbf{bold}` renders as **bold** by hiding `\textbf{` and `}` and styling
 * what is between them. The characters are still in the document; they are
 * `Decoration.replace`d with nothing.
 *
 * # …and it comes back when the cursor is inside
 *
 * Concealed markup that stays concealed while you edit inside it is unusable:
 * the caret moves through characters that are not on screen, and deleting feels
 * random. So a construct whose range touches the selection is shown in full.
 * That is the behaviour that makes conceal-style editing workable, and its
 * absence is what makes it maddening.
 */

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import { braceCommands, headings } from "./structure";

/** Inline commands that render as styled text, mapped to their CSS class. */
const INLINE: Record<string, string> = {
  textbf: "cm-yaz-strong",
  textit: "cm-yaz-emphasis",
  emph: "cm-yaz-emphasis",
  texttt: "cm-yaz-mono",
  underline: "cm-yaz-underline",
  textsc: "cm-yaz-smallcaps",
};

/** Turn rich text on or off. */
export const setRichText = StateEffect.define<boolean>();

/** Whether rich text is on, as editor state so decorations can read it. */
export const richTextEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRichText)) return effect.value;
    }
    return value;
  },
});

/** Nothing at all, used to hide markup. */
const hidden = Decoration.replace({});

/** Whether the selection touches a range, in which case its markup is shown. */
function selectionTouches(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

/**
 * Build the decorations for the whole document.
 *
 * Deliberately over the whole document rather than the visible ranges. A
 * construct can begin above the viewport and end inside it, and scanning only
 * what is visible splits it — the closing brace gets hidden while the opening
 * one, off-screen, does not, so scrolling changes what the text looks like.
 *
 * This is linear in document length and runs on edits. The buffer is one paper,
 * and when that stops being true the Lezer grammar arriving in phase 4 gives an
 * incremental tree to hang this off instead.
 */
function build(view: EditorView): DecorationSet {
  if (!view.state.field(richTextEnabled, false)) return Decoration.none;

  const text = view.state.doc.toString();
  const marks: { from: number; to: number; value: Decoration }[] = [];

  for (const heading of headings(text)) {
    const level = Math.min(heading.level, 6);
    marks.push({
      from: heading.titleFrom,
      to: heading.titleTo,
      value: Decoration.mark({ class: `cm-yaz-heading cm-yaz-h${level}` }),
    });
    if (!selectionTouches(view, heading.from, heading.to)) {
      // Hide `\section{` and the closing brace, leaving the words.
      marks.push({ from: heading.from, to: heading.titleFrom, value: hidden });
      marks.push({ from: heading.titleTo, to: heading.to, value: hidden });
    }
  }

  for (const command of braceCommands(text, Object.keys(INLINE))) {
    const className = INLINE[command.command];
    if (!className) continue;
    // Zero-length arguments would produce an empty mark, which CodeMirror
    // rejects, and `\emph{}` in a draft is not unusual.
    if (command.argTo > command.argFrom) {
      marks.push({
        from: command.argFrom,
        to: command.argTo,
        value: Decoration.mark({ class: className }),
      });
    }
    if (!selectionTouches(view, command.from, command.to)) {
      marks.push({ from: command.from, to: command.argFrom, value: hidden });
      marks.push({ from: command.argTo, to: command.to, value: hidden });
    }
  }

  // CodeMirror requires ranges in order. Sorting by start, then by length with
  // the longer first, keeps an outer mark around an inner one.
  marks.sort((a, b) => a.from - b.from || b.to - a.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) {
    builder.add(mark.from, mark.to, mark.value);
  }
  return builder.finish();
}

/** The decorating plugin. */
const decorator = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      // Selection changes matter as much as edits: moving the caret into a
      // construct is what reveals its markup.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setRichText)),
        )
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The rich-text extension: state, decorations and their styling. */
export function richText(): Extension {
  return [richTextEnabled, decorator, theme];
}

/**
 * How the styled text looks.
 *
 * Sizes are relative so the whole thing scales with the editor's font size, and
 * colours come from the token contract — a literal here would be a lint failure
 * and would stop a user theme restyling the rich view
 * ([ADR-0010](https://generalpawz.github.io/yaz/adr/0010-theming)).
 */
const theme = EditorView.baseTheme({
  ".cm-yaz-heading": {
    fontWeight: "700",
    color: "var(--yaz-text-primary)",
  },
  // `\part` and `\chapter` are rare in a paper but enormous when used.
  ".cm-yaz-h0": { fontSize: "1.9em", lineHeight: "1.3" },
  ".cm-yaz-h1": { fontSize: "1.65em", lineHeight: "1.3" },
  ".cm-yaz-h2": { fontSize: "1.4em", lineHeight: "1.35" },
  ".cm-yaz-h3": { fontSize: "1.2em", lineHeight: "1.4" },
  ".cm-yaz-h4": { fontSize: "1.08em" },
  ".cm-yaz-h5": { fontSize: "1em", fontStyle: "italic" },
  ".cm-yaz-h6": { fontSize: "1em", fontStyle: "italic" },
  ".cm-yaz-strong": { fontWeight: "700", color: "var(--yaz-text-primary)" },
  ".cm-yaz-emphasis": { fontStyle: "italic" },
  ".cm-yaz-mono": { fontFamily: "var(--yaz-font-mono)" },
  ".cm-yaz-underline": { textDecoration: "underline" },
  ".cm-yaz-smallcaps": { fontVariant: "small-caps" },
});
