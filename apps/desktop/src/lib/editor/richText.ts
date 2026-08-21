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
 *
 * # Two kinds of construct, and why some are drawn instead of styled
 *
 * Most are *styled in place*: the text stays where the author typed it and only
 * the markup around it is hidden. Headings, emphasis and lists work this way,
 * because they are prose and prose has to be typed into.
 *
 * Mathematics and tables cannot be. A rendered formula shares no characters
 * with its source, so it is drawn as a widget standing in for the range — and
 * touching it brings the source back, which is how it is edited. The line
 * between the two is whether the rendered form still contains the author's own
 * characters.
 *
 * # Why a state field rather than a view plugin
 *
 * CodeMirror forbids a view plugin from supplying block decorations or
 * replacements that cover a line break, because those change the document's
 * line structure and the viewport is measured before plugins run. Folding the
 * preamble, hiding a `\begin{itemize}` line and drawing a table all do exactly
 * that, so the decorations live in a state field, which is allowed to.
 */

import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type {
  Extension,
  StateEffectType,
  Text,
  Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { t } from "../i18n";
import {
  Covered,
  drawable,
  emptyLayout,
  NO_LAYOUT,
  replace,
  touched,
} from "./pass";
import { semanticMarkup, semanticTheme } from "./semanticView";
import type { Meaning } from "./semanticView";
import { labelledMarker } from "./semantics";
import type { Layout, Pass, Tall } from "./pass";
import { escapeHtml, inlineHtml } from "./inline";
import { renderMath, renderMathEnvironment } from "./math";
import { renderTable, tooComplexToDraw } from "./tabular";
import { fillMetadata, metadata } from "./typography";
import { charactersPerLine, linesPerPage } from "./geometry";
import { entriesFor, generatedIn, hasGenerated } from "./generated";
import { readProperties } from "./properties";
import type { BreakKind, Entry, ListingKind } from "./generated";
import {
  commandsOfKind,
  environmentRenderingOf,
  environmentsOfKind,
  renderingOf,
} from "./vocabulary";
import { setShowLineBreaks, showLineBreaks, showMachinery } from "./viewModes";
import {
  braceCommands,
  commentRanges,
  environments,
  headings,
  itemMarkers,
  mathSpans,
  matchBrace,
  preamble,
} from "./structure";
import type { Environment } from "./structure";

/** Inline commands that render as styled text, mapped to their CSS class. */
/**
 * What each inline command draws as, from the vocabulary rather than a copy.
 *
 * This was a list here, and a list here is a list that goes out of date: a
 * command added to the vocabulary would be *recognised* and then drawn as
 * nothing, because the map that says how to draw it had not been told. It also
 * meant a plugin could contribute an inline command and never see it drawn,
 * which would have made `registerLatexVocabulary` a half-promise.
 *
 * Rebuilt on demand rather than cached, because the vocabulary changes when
 * plugins load and reload.
 */
function inlineClasses(): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of commandsOfKind("inline")) {
    const rendering = renderingOf(name);
    if (rendering?.kind === "inline") found.set(name, rendering.className);
  }
  return found;
}

/** Bullets by nesting depth, as LaTeX itself sets them. */
const BULLETS = ["•", "◦", "▪", "·"];

/** What the heading over a generated list costs, in rows. */
const LISTING_HEADING_ROWS = 2;

// Re-exported so a caller reaches for one module to switch any part of the
// view on or off, rather than having to know which file each flag lives in.
export {
  setShowLineBreaks,
  setShowMachinery,
  showLineBreaks,
  showMachinery,
} from "./viewModes";

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

/** Show or hide the author's comments. */
export const setShowComments = StateEffect.define<boolean>();

/**
 * Whether the comments in the source are on screen.
 *
 * On, because a comment is something the author wrote and rich text is a view
 * of what they wrote. Off is for reading: a document commented as heavily as a
 * thesis under review has more `%` in it than prose, and none of it is going
 * into the PDF.
 *
 * Hidden is not deleted. The characters stay in the buffer, exactly as the
 * markup around a heading does (ADR-0004).
 */
export const showComments = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShowComments)) return effect.value;
    }
    return value;
  },
});

/** Show or hide the LaTeX around the text. */
export const setWrapperCollapsed = StateEffect.define<boolean>();

/**
 * Whether the LaTeX wrapping the text is folded away.
 *
 * Collapsed to begin with. The preamble is machinery — `\usepackage` lines,
 * margins, macro definitions — and `\end{document}` is punctuation for the
 * compiler. A view whose purpose is to show the document as it will read
 * should not open on half a page of configuration.
 */
export const wrapperCollapsed = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWrapperCollapsed)) return effect.value;
    }
    return value;
  },
});

/**
 * Rendered content standing in for a range of source.
 *
 * Holds HTML rather than a DOM node so that two widgets for the same formula
 * compare equal, which is what stops CodeMirror re-rendering every formula in
 * the document on every keystroke.
 */
class RenderedWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly className: string,
  ) {
    super();
  }

  override eq(other: RenderedWidget): boolean {
    return other.html === this.html && other.className === this.className;
  }

  override toDOM(view: EditorView): HTMLElement {
    const node = document.createElement("span");
    node.className = this.className;
    node.innerHTML = this.html;
    // Clicking a rendered formula or table is how its source is reached: put
    // the cursor where the construct is, and the decoration steps aside on the
    // next update. Without this the widget swallows the click and the source
    // can only be reached by arrowing in from outside it.
    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const position = view.posAtDOM(node);
      view.dispatch({ selection: EditorSelection.cursor(position) });
      view.focus();
    });
    return node;
  }

  /** Handled above; CodeMirror should not act on it as well. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * A generated list — the contents, the figures, the glossary — drawn out.
 *
 * Built from the buffer rather than from a build, so it is what the document
 * says about itself and not what LaTeX will paginate. That is why there are no
 * page numbers: a number here would be a guess, and a wrong page number is
 * worse than none in the one place a reader trusts numbers.
 *
 * Each line goes to the thing it names, which is what makes this a way of
 * moving around the document rather than a picture of one.
 */
class ListingWidget extends WidgetType implements Tall {
  constructor(
    readonly kind: ListingKind,
    readonly entries: Entry[],
    /** Which sheet of the listing this is, counting from one. */
    readonly sheet = 1,
    /** How many sheets the whole listing runs to. */
    readonly sheets = 1,
    /**
     * How many rows of paper this stands on, when it is its own sheet.
     *
     * Zero for the first sheet of a listing, which sits on a line and takes
     * the sheet that line is on. The sheets after it are block widgets with no
     * line of their own, so they have to be paper themselves — otherwise they
     * come out as tall as their contents and with none of the margins, which
     * is a page of glossary floating in the middle of the document.
     */
    readonly paperRows = 0,
  ) {
    super();
  }

  /**
   * As tall as it has entries, plus the heading over them.
   *
   * The page view needs this because a listing is the one thing in the
   * preview that produces pages of content from a single line of source: a
   * glossary of two hundred terms is `\printglossaries`, and a sheet told it
   * was one line long would stretch to two hundred rows to hold it.
   */
  get rows(): number {
    return this.entries.length + LISTING_HEADING_ROWS;
  }

  /**
   * Compared by content, so a keystroke elsewhere does not rebuild the list.
   *
   * A contents list of a hundred lines is a hundred DOM nodes, and rebuilding
   * them on every character would be the most expensive thing on the keystroke
   * path by a wide margin.
   */
  override eq(other: ListingWidget): boolean {
    return (
      other.kind === this.kind &&
      other.sheet === this.sheet &&
      other.sheets === this.sheets &&
      other.paperRows === this.paperRows &&
      other.entries.length === this.entries.length &&
      other.entries.every(
        (entry, index) =>
          entry.label === this.entries[index]?.label &&
          entry.detail === this.entries[index]?.detail &&
          entry.level === this.entries[index]?.level,
      )
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-yaz-listing";

    if (this.paperRows > 0) {
      // Its own sheet, and it has to say so: the classes that carry the
      // margins and the shadow are put on lines by the page view, and this is
      // not a line.
      box.classList.add(
        "cm-yaz-sheet",
        "cm-yaz-sheet-first",
        "cm-yaz-sheet-last",
        "cm-yaz-listing-sheet",
      );
      box.style.minBlockSize = `calc(${this.paperRows} * var(--yaz-line-height, 1.6) * 1em)`;
    }

    // Only the first sheet carries the heading, the way a contents list in a
    // book says "Contents" once and then keeps going.
    if (this.sheet === 1) {
      const title = document.createElement("div");
      title.className = "cm-yaz-listing-title";
      title.textContent = t(`listing-${this.kind}`);
      box.append(title);
    } else {
      const carried = document.createElement("div");
      carried.className = "cm-yaz-listing-continued";
      carried.textContent = t("listing-continued");
      box.append(carried);
    }

    if (this.entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "cm-yaz-listing-empty";
      // Which is the true answer, and in a document split across files it is
      // also an invitation: joined, the headings are there to be listed.
      empty.textContent = t(`listing-empty-${this.kind}`);
      box.append(empty);
      return box;
    }

    const list = document.createElement("ol");
    list.className = "cm-yaz-listing-entries";
    for (const entry of this.entries) {
      const row = document.createElement("li");
      row.className = `cm-yaz-listing-entry cm-yaz-listing-level-${entry.level}`;

      const link = document.createElement("button");
      link.type = "button";
      link.className = "cm-yaz-listing-link";
      link.textContent = entry.label;
      link.addEventListener("mousedown", (event) => {
        event.preventDefault();
        // Not `posAtDOM`: the point of a contents line is to go somewhere else.
        view.dispatch({
          selection: EditorSelection.cursor(
            Math.min(entry.at, view.state.doc.length),
          ),
          scrollIntoView: true,
        });
        view.focus();
      });
      row.append(link);

      if (entry.detail) {
        const detail = document.createElement("span");
        detail.className = "cm-yaz-listing-detail";
        detail.textContent = entry.detail;
        row.append(detail);
      }
      list.append(row);
    }
    box.append(list);
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * A command that draws as a piece of text: `\ldots`, `\S`, `\today`.
 *
 * A widget rather than nothing, because these are content. The reader is meant
 * to see an ellipsis where the author wrote `\ldots`, and the caret still
 * reveals the source when it arrives, like every other replacement.
 */
class LiteralWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: LiteralWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-literal";
    node.textContent = this.text;
    return node;
  }

  /** It is text: let it be selected and copied like text. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Space the author asked for: `\vspace{2cm}`, `\quad`, `\bigskip`.
 *
 * Drawn at roughly its size rather than at exactly it. The preview is not
 * typesetting; what matters is that two centimetres reads as more room than
 * two millimetres, and that the page view counts the rows it takes.
 */
class SpaceWidget extends WidgetType implements Tall {
  constructor(
    readonly axis: "block" | "inline",
    readonly ems: number,
  ) {
    super();
  }

  /** Vertical space is rows on the paper; horizontal space is not. */
  get rows(): number {
    return this.axis === "block" ? Math.round(this.ems) : 0;
  }

  override eq(other: SpaceWidget): boolean {
    return other.axis === this.axis && other.ems === this.ems;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className =
      this.axis === "block" ? "cm-yaz-space-block" : "cm-yaz-space-inline";
    if (this.axis === "block") {
      node.style.blockSize = `${this.ems}em`;
    } else {
      node.style.inlineSize = `${this.ems}em`;
    }
    node.setAttribute("aria-hidden", "true");
    return node;
  }
}

/**
 * Where a page ends, as a rule across the measure.
 *
 * Not where LaTeX will end the page — that is typesetting, and guessing at it
 * would put two different sets of page breaks in front of the same author
 * (ADR-0004's reason for not paginating). This is only the break the author
 * asked for, drawn as the thing it is instead of as a word.
 */
class PageBreakWidget extends WidgetType {
  constructor(readonly kind: BreakKind) {
    super();
  }

  override eq(other: PageBreakWidget): boolean {
    return other.kind === this.kind;
  }

  override toDOM(view: EditorView): HTMLElement {
    const rule = document.createElement("div");
    rule.className = "cm-yaz-pagebreak";
    const label = document.createElement("span");
    label.className = "cm-yaz-pagebreak-label";
    label.textContent = t(`pagebreak-${this.kind}`);
    rule.append(label);
    rule.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(view.posAtDOM(rule)),
      });
      view.focus();
    });
    return rule;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The number in front of a heading.
 *
 * Counted from the document rather than read from a build, so it is right
 * whenever the counters have not been meddled with and is the same number
 * every `\ref` to that heading shows. Drawn in the heading's own size and
 * weight, because it is part of the heading and not an annotation on it.
 */
class NumberWidget extends WidgetType {
  constructor(readonly number: string) {
    super();
  }

  override eq(other: NumberWidget): boolean {
    return other.number === this.number;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-heading-number";
    node.textContent = `${this.number}${NO_BREAK_SPACE}${NO_BREAK_SPACE}`;
    return node;
  }
}

/** Between a heading's number and its words, so they never come apart. */
const NO_BREAK_SPACE = "\u00a0";

/**
 * The ornament that marks where the text begins and where it ends.
 *
 * A fleuron rather than a labelled button. What is folded away is not content
 * — it is the LaTeX that wraps the content — so the mark should read as
 * typography and not as a control: quiet, centred, the same weight as a page
 * ornament in a printed book. It says it is clickable when the pointer is over
 * it, which is when that is worth knowing.
 *
 * The two glyphs are a pair, U+2767 and U+2766, one the mirror of the other,
 * which is what makes them read as opening and closing rather than as two
 * decorations. Each carries U+FE0E so the platform draws the letterform and
 * not an emoji.
 */
class BoundaryWidget extends WidgetType {
  constructor(
    readonly place: "start" | "end",
    readonly collapsed: boolean,
  ) {
    super();
  }

  override eq(other: BoundaryWidget): boolean {
    return other.place === this.place && other.collapsed === this.collapsed;
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-yaz-boundary cm-yaz-boundary-${this.place}`;
    button.setAttribute("aria-expanded", String(!this.collapsed));
    button.setAttribute(
      "aria-label",
      this.place === "start" ? t("editor-text-start") : t("editor-text-end"),
    );
    // Written out rather than as one `t(condition ? a : b)`, so that the
    // message-key check can see both keys at the call site (ADR-0011).
    button.title = this.collapsed
      ? t("editor-wrapper-show")
      : t("editor-wrapper-hide");

    const glyph = document.createElement("span");
    glyph.className = "cm-yaz-boundary-glyph";
    // Decorative: the label above already says what this is.
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = this.place === "start" ? "❧︎" : "❦︎";

    button.append(glyph);
    // Without this the editor takes focus and moves the selection before the
    // click lands, scrolling the view for no reason.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setWrapperCollapsed.of(!this.collapsed) });
      view.focus();
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Build the decorations for the whole document.
 *
 * Deliberately over the whole document rather than the visible ranges. A
 * construct can begin above the viewport and end inside it, and scanning only
 * what is visible splits it — the closing brace gets hidden while the opening
 * one, off-screen, does not, so scrolling changes what the text looks like.
 *
 * This is linear in document length and runs on edits — about 2 ms for a
 * paper-sized file and 11 ms for a hundred-page manuscript, against the 16 ms
 * ADR-0015 gives the whole keystroke. `keystroke.test.ts` holds that line. The
 * buffer is one paper, and when that stops being true the Lezer grammar
 * arriving in phase 4 gives an incremental tree to hang this off instead.
 * Typesetting is cached by source (see `./math`), so a keystroke re-renders
 * the formula it is inside and no
 * others.
 *
 * Order matters: the widest constructs claim their ranges first, and a
 * replacement landing inside one already claimed is dropped.
 */
function build(state: EditorState): Rendered {
  if (!state.field(richTextEnabled, false)) {
    return { decorations: Decoration.none, layout: NO_LAYOUT };
  }

  const pass: Pass = {
    state,
    text: state.doc.toString(),
    ranges: [],
    covered: new Covered(),
    layout: emptyLayout(),
  };

  boundaries(pass);
  comments(pass);
  structure(pass);
  tables(pass);
  mathematics(pass);
  // Before the lists, which need to know when one sets its own markers, and
  // before the headings, which show the label they carry.
  const meaning = semanticMarkup(pass);
  // Last of the wide ones, and deliberately. This claims *single commands*,
  // and single commands live inside the wide things: `\hline` inside a table,
  // `\centering` inside a figure. Claiming the small one first left the table
  // and the float unable to claim themselves, so each fell back to showing its
  // source — a table that stopped being a table because of a rule inside it.
  generated(pass);
  lists(pass, meaning);
  quotes(pass);
  inlineMarkup(pass, meaning);

  // Sorting is CodeMirror's, which knows how line, mark and replace decorations
  // order against each other at the same position.
  return {
    decorations: Decoration.set(pass.ranges, true),
    layout: pass.layout,
  };
}

/** What one pass produced: what to draw, and what shape it comes out. */
export interface Rendered {
  decorations: DecorationSet;
  /** See {@link Layout}. The page view reads this; nothing else needs it. */
  layout: Layout;
}

/**
 * How far into a file `\begin{document}` is looked for.
 *
 * Bounded because this runs on the keystroke path, and searching a whole
 * hundred-page manuscript for something that is by definition near the top
 * would be work spent to find nothing. A preamble longer than this is not a
 * preamble.
 */
const PREAMBLE_LIMIT = 65536;

/** What the wrapper covers: the preamble, and the `\end{document}` line. */
interface Wrapper {
  /** Everything up to and including the `\begin{document}` line. */
  start: { from: number; to: number };
  /** The `\end{document}` line, with the line break that precedes it. */
  end: { from: number; to: number } | null;
}

/**
 * The ranges the boundary marks stand in for.
 *
 * `null` when there is no `\begin{document}` at all, which is what an
 * `\input`-ed chapter looks like: it is all text, so there is no boundary to
 * draw. A `\begin{document}` with no `\end` is a document being written, and
 * gets its opening mark without a closing one.
 */
function wrapper(doc: Text): Wrapper | null {
  const found = preamble(
    doc.sliceString(0, Math.min(doc.length, PREAMBLE_LIMIT)),
  );
  if (!found) return null;

  // Out to the end of the line, so folding does not leave the remains of the
  // `\begin{document}` line hanging above the text — and on through
  // `\maketitle`, which is machinery rather than writing: it produces the
  // title block from what the preamble already declared, and leaving it
  // stranded on its own above the first paragraph would show the seam this
  // mark exists to hide.
  const start = {
    from: found.from,
    to: titleBlockEnd(doc, doc.lineAt(found.to).number),
  };

  // Searched from the end and bounded, for the same reason the preamble is
  // searched from the start and bounded: this runs on every keystroke, and
  // `doc.toString()` on a hundred-page manuscript allocates the whole
  // manuscript to find something that is on the last line.
  const tail = Math.max(0, doc.length - CLOSING_LIMIT);
  const closingInTail = doc.sliceString(tail).lastIndexOf(END_DOCUMENT);
  const closing = closingInTail === -1 ? -1 : tail + closingInTail;
  if (closing === -1 || closing < start.to) return { start, end: null };

  const line = doc.lineAt(closing);
  // Only when it is the whole line. `text. \end{document}` on one line has the
  // author's own words on it.
  if (line.text.trim() !== END_DOCUMENT) return { start, end: null };
  // Swallow the line break before it, or an empty line is left behind.
  return {
    start,
    end: { from: Math.max(line.from - 1, start.to), to: line.to },
  };
}

/** What closes a document. */
const END_DOCUMENT = "\\end{document}";

/**
 * Commands that belong to the title block rather than to the text.
 *
 * Deliberately short. Anything absorbed here disappears behind the mark, so
 * this may only hold commands that produce no writing of their own —
 * `\tableofcontents` is not among them, because a contents page is something
 * the reader looks at.
 */
const TITLE_BLOCK = /^\\(maketitle|thispagestyle\{[^}]*\})$/;

/**
 * How far the opening fold reaches, given the `\begin{document}` line.
 *
 * Absorbs blank lines and title-block commands, but only if a title-block
 * command is actually reached — otherwise a document that simply starts with a
 * blank line would have it eaten, and the first paragraph would sit tight
 * against the mark.
 */
function titleBlockEnd(doc: Text, beginLine: number): number {
  let end = doc.line(beginLine).to;
  for (let number = beginLine + 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const text = line.text.trim();
    if (text === "") continue;
    if (!TITLE_BLOCK.test(text)) break;
    end = line.to;
  }
  return end;
}

/**
 * How far back from the end `\end{document}` is looked for.
 *
 * Small, because it is on the last line of every real document. What follows
 * it, if anything, is a stray comment.
 */
const CLOSING_LIMIT = 4096;

/** The LaTeX around the text, folded behind a mark at each end. */
function boundaries(pass: Pass): void {
  const found = wrapper(pass.state.doc);
  if (!found) return;

  if (!pass.state.field(wrapperCollapsed, false)) {
    // Expanded, the marks sit where they would be when collapsed — above the
    // preamble and below the last line — so clicking one again puts things
    // back where they were, rather than somewhere else.
    pass.ranges.push(
      Decoration.widget({
        widget: new BoundaryWidget("start", false),
        block: true,
        side: -1,
      }).range(found.start.from),
    );
    // The opened matter is banded, so the mark reads as the head of a region
    // rather than as a rule with configuration loose underneath it. One row
    // closed, a band of rows open — the same thing either way.
    band(pass, found.start.from, found.start.to, "front");
    if (found.end) {
      pass.ranges.push(
        Decoration.widget({
          widget: new BoundaryWidget("end", false),
          block: true,
          side: 1,
        }).range(pass.state.doc.length),
      );
      band(pass, found.end.from, found.end.to, "back");
    }
    return;
  }

  const doc = pass.state.doc;
  if (
    replace(
      pass,
      found.start.from,
      found.start.to,
      new BoundaryWidget("start", true),
    )
  ) {
    // Folded or open, it is the same region and gets the same short sheet.
    const line = doc.lineAt(found.start.from).number;
    pass.layout.matter.push({ from: line, to: line });
  }
  if (
    found.end &&
    replace(pass, found.end.from, found.end.to, new BoundaryWidget("end", true))
  ) {
    const line = doc.lineAt(found.end.to).number;
    pass.layout.matter.push({ from: line, to: line });
  }
}

/**
 * The document's generated parts: its lists, its page breaks, its scaffolding.
 *
 * Guarded by a cheap look first, because most documents have none of this and
 * would otherwise pay for a walk of themselves on every keystroke.
 */
function generated(pass: Pass): void {
  if (!hasGenerated(pass.text)) return;
  const found = generatedIn(pass.text, readProperties(pass.text).language);

  for (const listing of found.listings) {
    if (touched(pass.state, listing.from, listing.to)) {
      pass.covered.claim(listing.from, listing.to);
      continue;
    }
    listed(pass, listing.from, listing.to, listing.kind);
  }

  for (const pageBreak of found.breaks) {
    if (touched(pass.state, pageBreak.from, pageBreak.to)) {
      pass.covered.claim(pageBreak.from, pageBreak.to);
      continue;
    }
    replace(
      pass,
      pageBreak.from,
      pageBreak.to,
      new PageBreakWidget(pageBreak.kind),
    );
  }

  for (const literal of found.literals) {
    // Replaced rather than hidden. `\ldots` *is* an ellipsis the author wrote
    // and `\today` is a date the reader will see printed — taking them away
    // would be losing text, not hiding markup.
    if (touched(pass.state, literal.from, literal.to)) {
      pass.covered.claim(literal.from, literal.to);
      continue;
    }
    replace(pass, literal.from, literal.to, new LiteralWidget(literal.text));
  }

  for (const space of found.spaces) {
    if (touched(pass.state, space.from, space.to)) {
      pass.covered.claim(space.from, space.to);
      continue;
    }
    replace(pass, space.from, space.to, new SpaceWidget(space.axis, space.ems));
  }

  // View → Document machinery. Off means hidden, which is the default, and on
  // means shown as written — the switch exists so an author can see what their
  // preamble is doing without leaving the preview.
  if (pass.state.field(showMachinery, false) !== true) {
    for (const command of found.machinery) {
      // Hidden rather than drawn, and revealed by the caret like everything
      // else — so it is one arrow key away rather than a mode switch away.
      if (touched(pass.state, command.from, command.to)) {
        pass.covered.claim(command.from, command.to);
        continue;
      }
      replace(pass, command.from, command.to);
    }
  }
}

/**
 * Draw a generated list, divided into sheets if it runs to more than one.
 *
 * The one place in the preview where a single line of source produces pages of
 * content. `\printglossaries` is one command and a hundred and forty terms,
 * and a page view that could not divide it would draw one sheet a hundred and
 * forty rows long — which is what it did.
 *
 * A sheet break cannot be put inside a line, so the division is made here
 * instead: each sheet's worth of entries is its own block widget, and each
 * block widget is a child of the content box, which is what a sheet is.
 *
 * When the page view is off there is no sheet to fill and `perSheet` is zero,
 * so the whole list is drawn as one — which is what a continuous view wants.
 */
function listed(pass: Pass, from: number, to: number, kind: ListingKind): void {
  const entries = entriesFor(kind, pass.text);
  const perPage = pass.state.facet(linesPerPage);
  const measure = pass.state.facet(charactersPerLine);
  const sheets = intoSheets(entries, perPage - LISTING_HEADING_ROWS, measure);

  if (sheets.length <= 1) {
    replace(pass, from, to, new ListingWidget(kind, entries));
    return;
  }

  if (
    !replace(
      pass,
      from,
      to,
      new ListingWidget(kind, sheets[0]!, 1, sheets.length),
    )
  ) {
    return;
  }

  // The rest stand after it, in order. `side` keeps them in that order: two
  // block widgets at one position are otherwise drawn in an order CodeMirror
  // is free to choose.
  const at = pass.state.doc.lineAt(to).to;
  for (let sheet = 2; sheet <= sheets.length; sheet += 1) {
    pass.ranges.push(
      Decoration.widget({
        widget: new ListingWidget(
          kind,
          sheets[sheet - 1]!,
          sheet,
          sheets.length,
          perPage,
        ),
        block: true,
        side: sheet,
      }).range(at),
    );
  }
}

/**
 * Divide a listing into sheets, by how tall its entries are.
 *
 * By height and not by count, which is what it did. A glossary entry is a term
 * and a definition — "AIA Auftraggeber-Informationsanforderungen — Anforderungen
 * des Auftraggebers an die zu liefernden Informationen und Modelle im Rahmen
 * eines BIM-Projekts" — and that is three rows of paper, not one. Cutting every
 * sheet after the same *number* of them made the first sheet three times the
 * height of the page and the ones after it whatever was left, which is what a
 * glossary spread over pages of four different lengths looks like.
 *
 * The measure is an estimate, and this is the one place it has to stay one:
 * the widget is being built, so there is nothing on screen to measure yet.
 */
function intoSheets(
  entries: readonly Entry[],
  perSheet: number,
  measure: number,
): Entry[][] {
  if (perSheet <= 0) return [[...entries]];

  const sheets: Entry[][] = [];
  let current: Entry[] = [];
  let used = 0;

  for (const entry of entries) {
    const written = entry.label.length + (entry.detail?.length ?? 0) + 2;
    const rows = measure > 0 ? Math.max(1, Math.ceil(written / measure)) : 1;

    // A single entry taller than the sheet still starts one rather than none.
    if (used > 0 && used + rows > perSheet) {
      sheets.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += rows;
  }
  if (current.length > 0) sheets.push(current);
  return sheets;
}

/**
 * Mark every line of the opened front or back matter.
 *
 * A line decoration per line rather than one range: CodeMirror styles lines,
 * and a preamble is a handful of them. The band is what makes the region read
 * as one thing when it is open — in the page view it runs the full width of
 * the paper, which is where the difference between the document and the
 * machinery around it is worth drawing.
 */
function band(
  pass: Pass,
  from: number,
  to: number,
  place: "front" | "back",
): void {
  const doc = pass.state.doc;
  const last = doc.lineAt(Math.min(to, doc.length)).number;
  // The closing range starts at the line break *before* it, so that collapsing
  // takes the blank line with it. That offset still belongs to the line above,
  // which is the author's last paragraph — start below it.
  const opening = doc.lineAt(from);
  const first =
    from >= opening.to
      ? Math.min(opening.number + 1, doc.lines)
      : opening.number;
  for (let number = first; number <= last; number += 1) {
    pass.ranges.push(
      Decoration.line({
        class: `cm-yaz-matter cm-yaz-matter-${place}`,
      }).range(doc.line(number).from),
    );
  }
  // Told to the page view, which gives it a short sheet of its own. It is what
  // the file wraps the document in rather than a page of the document, and a
  // preamble occupying the first sheet of A4 would open the paper on a page
  // that is not in it.
  pass.layout.matter.push({ from: first, to: last });
}

/**
 * The author's comments, when they are not wanted on screen.
 *
 * A comment that is a whole line takes its line break with it, so switching
 * them off closes the gap rather than leaving a blank line where each one was
 * — which would be a document full of holes.
 *
 * Claimed before anything else looks at the text, so a construct that was
 * commented out is never half-drawn.
 */
function comments(pass: Pass): void {
  if (pass.state.field(showComments, false) !== false) return;

  for (const comment of commentRanges(pass.text)) {
    if (!drawable(pass, comment.from, comment.to)) continue;
    const whole = lineHide(pass.state, comment.from, comment.to);
    replace(pass, whole?.from ?? comment.from, whole?.to ?? comment.to);
  }
}

/**
 * Environments that are arrangement, with their `\begin` and `\end` hidden.
 *
 * The same treatment a list gets, for the same reason: what is inside them is
 * the document, and `\begin{titlepage}` is an instruction to the typesetter.
 */
function structure(pass: Pass): void {
  for (const found of environments(
    pass.text,
    environmentsOfKind("structural"),
  )) {
    for (const [from, to] of [
      [found.from, found.bodyFrom],
      [found.bodyTo, found.to],
    ]) {
      if (!drawable(pass, from!, to!)) continue;
      // The line break goes too, or a blank line is left where the command was.
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }
  }
}

/** Tables, drawn from their source. */
function tables(pass: Pass): void {
  // Once, not once per table. Read inside the loop this was five walks of the
  // document per table, which is quadratic in a document made largely of
  // tables — and the keystroke tripwire caught it at 29x the cost for 6x the
  // document.
  const declared = metadata(pass.text);

  for (const table of environments(pass.text, environmentsOfKind("table"))) {
    // How many `{...}` arguments come before the column specification is a
    // property of the environment — `tabularx` takes a width first — and the
    // vocabulary is where that is written down.
    const rendering = environmentRenderingOf(table.name);
    const read = columnSpec(
      pass.text,
      table.bodyFrom,
      rendering?.kind === "table" ? rendering.columnArguments : 0,
    );
    if (!read) continue;

    // Filled before it is drawn: a table is rendered from its source, so
    // `\theauthor` in a cell would otherwise reach the screen as those letters.
    // The title page of a real thesis sets the author and the reviewer this way.
    const body = fillMetadata(
      pass.text.slice(read.bodyFrom, table.bodyTo),
      declared,
    );
    // A construct this parser would draw wrongly is shown as source instead.
    // The author can see that source is source; they cannot see that a drawn
    // table has quietly lost a row.
    if (tooComplexToDraw(body)) continue;

    const html = renderTable(read.spec, body);
    if (html === null) continue;
    if (touched(pass.state, table.from, table.to)) {
      // Claimed even while revealed, so nothing else decorates the source the
      // author is currently editing.
      pass.covered.claim(table.from, table.to);
      continue;
    }

    replace(
      pass,
      table.from,
      table.to,
      new RenderedWidget(html, "cm-yaz-block cm-yaz-table-host"),
    );
  }
}

/** Mathematics, typeset by KaTeX: environments first, then `$…$` and friends. */
function mathematics(pass: Pass): void {
  const draw = (from: number, to: number, html: string, display: boolean) => {
    if (touched(pass.state, from, to)) {
      pass.covered.claim(from, to);
      return;
    }
    replace(
      pass,
      from,
      to,
      new RenderedWidget(
        html,
        display ? "cm-yaz-block cm-yaz-math-display" : "cm-yaz-math",
      ),
    );
  };

  for (const environment of environments(
    pass.text,
    environmentsOfKind("math"),
  )) {
    if (pass.covered.overlaps(environment.from, environment.to)) continue;
    const html = renderMathEnvironment(
      environment.name,
      pass.text.slice(environment.bodyFrom, environment.bodyTo),
      pass.text.slice(environment.from, environment.to),
    );
    // Mathematics KaTeX will not take is left as source, undecorated. A formula
    // is invalid for most of the keystrokes it takes to write one, and an error
    // message where the formula should be would be worse than the source that
    // is already there.
    if (html === null) continue;
    draw(environment.from, environment.to, html, true);
  }

  for (const span of mathSpans(pass.text)) {
    if (pass.covered.overlaps(span.from, span.to)) continue;
    const html = renderMath(
      pass.text.slice(span.bodyFrom, span.bodyTo),
      span.display,
    );
    if (html === null) continue;
    draw(span.from, span.to, html, span.display);
  }
}

/**
 * Lists: a bullet or number in place of `\item`, and the environment lines
 * hidden.
 *
 * Styled in place rather than drawn as a widget, because a list is prose. Its
 * text has to be typed into, and text inside a widget cannot be.
 *
 * # Nesting is worked out by sweeping, not by searching
 *
 * Every item and every line has to know which list it is innermost in. Asking
 * that by searching all the lists, for each of them, is cubic — measured at
 * 170 ms per keystroke on a hundred-page manuscript, against ADR-0015's 16 ms
 * budget for the whole keystroke. Both sequences are already in document
 * order, so one pass with a stack answers it for all of them.
 */
function lists(pass: Pass, meaning: Meaning): void {
  const found = environments(pass.text, environmentsOfKind("list"));
  if (found.length === 0) return;

  const depths = nestingDepths(found);
  const markers = itemMarkers(pass.text);
  const markerOwners = innermost(
    found,
    markers.map((marker) => marker.from),
  );

  for (const list of found) {
    for (const [from, to] of [
      [list.from, list.bodyFrom],
      [list.bodyTo, list.to],
    ]) {
      if (touched(pass.state, from!, to!)) continue;
      // Hiding the line break as well is what stops a blank line being left
      // where the environment was.
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }
  }

  indent(pass, found, depths);

  const counts = new Map<Environment, number>();
  markers.forEach((marker, index) => {
    const list = markerOwners[index];
    if (!list) return;

    const depth = depths.get(list) ?? 0;
    const position = counts.get(list) ?? 0;
    counts.set(list, position + 1);

    // A list that sets its own marker gets it: `label=lph*)` is the author
    // saying what the list should read as, and drawing a bullet instead would
    // be the editor overruling the document.
    const own = meaning.listMarkers.get(list.from);
    const label =
      marker.labelFrom !== null && marker.labelTo !== null
        ? inlineHtml(pass.text.slice(marker.labelFrom, marker.labelTo))
        : escapeHtml(
            (own && labelledMarker(own.label, own.start + position)) ??
              itemLabel(list.name, depth, position),
          );

    if (touched(pass.state, marker.from, marker.to)) {
      pass.covered.claim(marker.from, marker.to);
      return;
    }
    replace(
      pass,
      marker.from,
      marker.to,
      new RenderedWidget(label, "cm-yaz-item-marker"),
    );
  });
}

/** How many lists enclose each one, which sets both its marker and its indent. */
function nestingDepths(found: Environment[]): Map<Environment, number> {
  const depths = new Map<Environment, number>();
  const open: Environment[] = [];
  for (const list of found) {
    while (open.length > 0 && open[open.length - 1]!.to <= list.from)
      open.pop();
    depths.set(list, open.length);
    open.push(list);
  }
  return depths;
}

/**
 * The innermost environment containing each offset.
 *
 * Both arguments must be in document order, which they are: environments come
 * back sorted, and the scanners walk the text forwards. Environments nest
 * properly — they are paired by a stack in the first place — so a stack is
 * enough to answer for every offset in one pass.
 */
function innermost(
  found: Environment[],
  offsets: number[],
): (Environment | null)[] {
  const owners: (Environment | null)[] = [];
  const open: Environment[] = [];
  let next = 0;

  for (const offset of offsets) {
    while (next < found.length && found[next]!.from <= offset) {
      open.push(found[next]!);
      next += 1;
    }
    while (open.length > 0 && open[open.length - 1]!.to <= offset) open.pop();

    const top = open[open.length - 1];
    owners.push(
      top && offset >= top.bodyFrom && offset < top.bodyTo ? top : null,
    );
  }

  return owners;
}

/** Indent the lines each list owns, so nesting is visible as nesting. */
function indent(
  pass: Pass,
  found: Environment[],
  depths: Map<Environment, number>,
): void {
  const numbers = new Set<number>();
  for (const list of found) {
    const first = pass.state.doc.lineAt(list.bodyFrom).number + 1;
    const last = pass.state.doc.lineAt(list.bodyTo).number - 1;
    for (let number = first; number <= last; number += 1) numbers.add(number);
  }

  const lines = [...numbers]
    .sort((a, b) => a - b)
    .map((number) => pass.state.doc.line(number));
  const owners = innermost(
    found,
    lines.map((line) => line.from),
  );

  lines.forEach((line, index) => {
    const list = owners[index];
    if (!list) return;
    if (pass.covered.overlaps(line.from, line.to)) return;
    const depth = Math.min((depths.get(list) ?? 0) + 1, 4);
    pass.ranges.push(
      Decoration.line({ class: `cm-yaz-list cm-yaz-list-${depth}` }).range(
        line.from,
      ),
    );
  });
}

/**
 * Quotations: the environment lines hidden, the words set apart.
 *
 * Indented and in the prose face rather than drawn as a widget, because the
 * text inside is the author's and has to stay editable — the same reason lists
 * are styled in place.
 */
function quotes(pass: Pass): void {
  for (const quote of environments(pass.text, environmentsOfKind("quote"))) {
    for (const [from, to] of [
      [quote.from, quote.bodyFrom],
      [quote.bodyTo, quote.to],
    ]) {
      if (touched(pass.state, from!, to!)) continue;
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }

    const first = pass.state.doc.lineAt(quote.bodyFrom).number + 1;
    const last = pass.state.doc.lineAt(quote.bodyTo).number - 1;
    for (let number = first; number <= last; number += 1) {
      const line = pass.state.doc.line(number);
      if (pass.covered.overlaps(line.from, line.to)) continue;
      pass.ranges.push(
        Decoration.line({ class: "cm-yaz-quote" }).range(line.from),
      );
    }
  }
}

/**
 * Headings and inline commands.
 *
 * The styling mark is applied whatever else is happening — a mark over replaced
 * text simply does not show, and refusing to style a heading because it
 * contains a formula would be worse than either. Only the ranges that *hide*
 * markup have to respect what is already claimed.
 */
function inlineMarkup(pass: Pass, meaning: Meaning): void {
  for (const heading of headings(pass.text)) {
    const level = Math.min(heading.level, 6);
    const label = meaning.labelled.get(heading.from);
    const number = meaning.numbers.get(heading.from);

    if (heading.titleTo > heading.titleFrom) {
      pass.ranges.push(
        Decoration.mark({
          class: `cm-yaz-heading cm-yaz-h${level}`,
          // The label is folded into the heading rather than shown beside it,
          // so this is the only place it is still legible — which is what a
          // hover is for, and what someone writing a `\ref` needs.
          ...(label
            ? { attributes: { title: t("heading-label", { label }) } }
            : {}),
        }).range(heading.titleFrom, heading.titleTo),
      );
    }
    if (!touched(pass.state, heading.from, heading.to)) {
      // Hide `\section{` and the closing brace, leaving the words — and put the
      // number LaTeX would print in front of it, which is what a reader of the
      // finished document sees and what every `\ref` to it will say.
      replace(
        pass,
        heading.from,
        heading.titleFrom,
        number ? new NumberWidget(number) : undefined,
      );
      replace(pass, heading.titleTo, heading.to);
    }
  }

  const classes = inlineClasses();
  for (const command of braceCommands(pass.text, [...classes.keys()])) {
    const className = classes.get(command.command);
    // `undefined` rather than falsy: `	extnormal` draws as *no* class, and
    // that is still drawing it — the markup around it has to go.
    if (className === undefined) continue;
    // Zero-length arguments would produce an empty mark, which CodeMirror
    // rejects, and `\emph{}` in a draft is not unusual.
    if (command.argTo > command.argFrom) {
      pass.ranges.push(
        Decoration.mark({ class: className }).range(
          command.argFrom,
          command.argTo,
        ),
      );
    }
    if (!touched(pass.state, command.from, command.to)) {
      replace(pass, command.from, command.argFrom);
      replace(pass, command.argTo, command.to);
    }
  }
}

/** Where a construct is the whole line, the range that hides the line with it. */
function lineHide(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(from);
  if (line.number !== state.doc.lineAt(to).number) return null;
  // Only when the command is the whole line. `\begin{itemize} \item a` on one
  // line has text on it to keep.
  if (line.text.trim() !== state.doc.sliceString(from, to).trim()) return null;

  // Swallow a line break with it, or an empty line is left behind. The one
  // before is preferred: taking the one after would pull the first item up.
  if (line.from > 0) return { from: line.from - 1, to: line.to };
  if (line.to < state.doc.length) return { from: line.from, to: line.to + 1 };
  return { from: line.from, to: line.to };
}

/** The marker for an item, given its list's kind, depth and position. */
function itemLabel(kind: string, depth: number, index: number): string {
  if (kind === "enumerate") {
    if (depth === 1) return `(${String.fromCharCode(97 + (index % 26))})`;
    if (depth >= 2) return `${roman(index + 1)}.`;
    return `${index + 1}.`;
  }
  return BULLETS[Math.min(depth, BULLETS.length - 1)]!;
}

/** Lower-case roman numerals, for the third level of a nested enumeration. */
function roman(value: number): string {
  const digits: [number, string][] = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let left = value;
  let out = "";
  for (const [amount, numeral] of digits) {
    while (left >= amount) {
      out += numeral;
      left -= amount;
    }
  }
  return out;
}

/** Read a table's column specification, starting just past `\begin{tabular}`. */
function columnSpec(
  text: string,
  at: number,
  widthArguments: number,
): { spec: string; bodyFrom: number } | null {
  let cursor = at;
  const group = (): string | null => {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "{") return null;
    const end = matchBrace(text, cursor);
    if (end === null) return null;
    const inner = text.slice(cursor + 1, end - 1);
    cursor = end;
    return inner;
  };

  for (let taken = 0; taken < widthArguments; taken += 1) {
    if (group() === null) return null;
  }
  // The optional vertical-position argument, `[t]` or `[b]`.
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] === "[") {
    const close = text.indexOf("]", cursor);
    if (close === -1) return null;
    cursor = close + 1;
  }
  const spec = group();
  if (spec === null) return null;
  return { spec, bodyFrom: cursor };
}

/**
 * The decorations, as editor state.
 *
 * A state field rather than a view plugin because only a state field may supply
 * block decorations and replacements that cover a line break — see the note at
 * the top of this file.
 */
const rendered = StateField.define<Rendered>({
  create: (state) => build(state),
  update(value, transaction) {
    // Selection changes matter as much as edits: moving the caret into a
    // construct is what reveals its markup.
    const toggled = transaction.effects.some(
      (effect) =>
        effect.is(setRichText) ||
        effect.is(setWrapperCollapsed) ||
        effect.is(setShowComments) ||
        effect.is(setShowLineBreaks),
    );
    if (
      transaction.docChanged ||
      toggled ||
      !transaction.state.selection.eq(transaction.startState.selection)
    ) {
      return build(transaction.state);
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * What the pass drew, for the page view to count.
 *
 * Read with a default, because the page view also runs over a plain text file
 * that has no rich text at all — and a file with no rich text has nothing
 * folded and nothing standing taller than its own line, which is exactly what
 * an empty layout says.
 */
export function layoutOf(state: EditorState): Layout {
  return state.field(rendered, false)?.layout ?? NO_LAYOUT;
}

/** A field's value after a transaction, without building the new state. */
function after<T>(
  transaction: Transaction,
  field: StateField<T>,
  effect: StateEffectType<T>,
  fallback: T,
): T {
  let value = transaction.startState.field(field, false) ?? fallback;
  for (const candidate of transaction.effects) {
    if (candidate.is(effect)) value = candidate.value;
  }
  return value;
}

/**
 * Keep the cursor out of the folded LaTeX.
 *
 * A cursor inside a replacement is invisible, and typing at it edits text the
 * author cannot see — `\usepackage` lines, or `\end{document}`. It is
 * reachable in ordinary use: opening a file puts the cursor at offset zero,
 * which is inside the opening fold.
 *
 * So an empty selection landing in a fold is moved to the nearest position
 * outside it. A non-empty one is left alone: selecting everything and typing
 * means replacing everything, and that includes the wrapper.
 */
const cursorStaysOutOfTheFold = EditorState.transactionFilter.of(
  (transaction) => {
    if (!after(transaction, richTextEnabled, setRichText, false))
      return transaction;
    if (!after(transaction, wrapperCollapsed, setWrapperCollapsed, true)) {
      return transaction;
    }

    const selection = transaction.newSelection;
    if (!selection.ranges.some((range) => range.empty)) return transaction;

    const found = wrapper(transaction.newDoc);
    if (!found) return transaction;

    // Each fold names where a cursor caught inside it should go. The target is
    // always outside the range that catches, or the moved cursor would be
    // caught again and the filter would never settle.
    const traps: { from: number; to: number; target: number }[] = [];
    if (found.start.to + 1 <= transaction.newDoc.length) {
      traps.push({
        from: found.start.from,
        to: found.start.to,
        target: found.start.to + 1,
      });
    }
    if (found.end) {
      traps.push({
        from: found.end.from + 1,
        to: found.end.to,
        target: found.end.from,
      });
    }

    const trapping = (position: number) =>
      traps.find((trap) => position >= trap.from && position <= trap.to);

    if (
      !selection.ranges.some((range) => range.empty && trapping(range.from))
    ) {
      return transaction;
    }

    const moved = selection.ranges.map((range) => {
      const trap = range.empty ? trapping(range.from) : undefined;
      return trap ? EditorSelection.cursor(trap.target) : range;
    });
    return [
      transaction,
      {
        selection: EditorSelection.create(moved, selection.mainIndex),
      },
    ];
  },
);

/** The rich-text extension: state, decorations and their styling. */
export function richText(): Extension {
  // Order matters: `decorations` reads the two flags as it is created.
  return [
    richTextEnabled,
    wrapperCollapsed,
    showComments,
    showLineBreaks,
    showMachinery,
    rendered,
    cursorStaysOutOfTheFold,
    theme,
    semanticTheme,
  ];
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
  // A generated list, set as the reference it is: quiet rules, no page numbers,
  // and every line a way of getting there.
  ".cm-yaz-listing": {
    display: "block",
    inlineSize: "100%",
    textAlign: "start",
    border: "1px solid var(--yaz-border)",
    borderRadius: "var(--yaz-radius-md)",
    background: "var(--yaz-bg-secondary)",
    padding: "var(--yaz-space-3) var(--yaz-space-4)",
    margin: "var(--yaz-space-3) 0",
    fontFamily: "var(--yaz-font-sans)",
  },
  // A list carried onto the next sheet says so, quietly, where the heading
  // would have been. Without it a reader meets a page of entries with no
  // indication of what they are a list of.
  // A command that stands for a character, set as the character. Nothing
  // distinguishes it from the text around it, because it *is* the text.
  // Boxes, shifts and notes: the inline treatment with a different look.
  ".cm-yaz-framed": {
    border: "1px solid var(--yaz-border)",
    padding: "0 0.25em",
    borderRadius: "2px",
  },
  ".cm-yaz-nowrap": {
    whiteSpace: "nowrap",
  },
  ".cm-yaz-superscript": {
    verticalAlign: "super",
    fontSize: "0.75em",
  },
  ".cm-yaz-subscript": {
    verticalAlign: "sub",
    fontSize: "0.75em",
  },
  ".cm-yaz-footnote": {
    fontSize: "0.85em",
    color: "var(--yaz-text-muted)",
  },
  ".cm-yaz-literal": {
    whiteSpace: "pre-wrap",
  },
  ".cm-yaz-space-inline": {
    display: "inline-block",
  },
  ".cm-yaz-space-block": {
    display: "block",
    inlineSize: "100%",
  },
  /*
   * A sheet of a divided listing has no filler after it, because it is not
   * lines — it is one widget standing where a page would be. So it carries its
   * own foot: the bottom margin of the paper, the shadow, and the gap that
   * separates it from the sheet below.
   */
  ".cm-yaz-listing-sheet": {
    paddingBlockEnd: "var(--yaz-page-margin, 25mm)",
    marginBlockEnd: "var(--yaz-space-6)",
    borderEndStartRadius: "2px",
    borderEndEndRadius: "2px",
    boxShadow:
      "0 -1px 6px var(--yaz-pdf-page-shadow), 0 2px 8px var(--yaz-pdf-page-shadow)",
  },
  ".cm-yaz-listing-continued": {
    display: "block",
    marginBlockEnd: "var(--yaz-space-3)",
    fontSize: "0.85em",
    fontStyle: "italic",
    color: "var(--yaz-text-muted)",
    textAlign: "end",
  },
  ".cm-yaz-listing-title": {
    fontSize: "0.8em",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--yaz-text-muted)",
    marginBlockEnd: "var(--yaz-space-2)",
  },
  ".cm-yaz-listing-empty": {
    margin: "0",
    fontSize: "0.9em",
    color: "var(--yaz-text-muted)",
    fontStyle: "italic",
  },
  ".cm-yaz-listing-entries": {
    listStyle: "none",
    margin: "0",
    padding: "0",
  },
  ".cm-yaz-listing-entry": {
    lineHeight: "1.5",
    paddingBlock: "0.05em",
  },
  ".cm-yaz-listing-level-1": { paddingInlineStart: "1.2em" },
  ".cm-yaz-listing-level-2": { paddingInlineStart: "2.4em" },
  ".cm-yaz-listing-level-3": { paddingInlineStart: "3.6em" },
  ".cm-yaz-listing-link": {
    font: "inherit",
    color: "var(--yaz-text-primary)",
    background: "none",
    border: "none",
    padding: "0",
    cursor: "pointer",
    textAlign: "start",
  },
  ".cm-yaz-listing-link:hover": {
    color: "var(--yaz-accent)",
    textDecoration: "underline",
  },
  ".cm-yaz-listing-detail": {
    color: "var(--yaz-text-muted)",
    fontSize: "0.9em",
    marginInlineStart: "0.5em",
  },
  // The break the author asked for, drawn as a break.
  ".cm-yaz-pagebreak": {
    display: "flex",
    inlineSize: "100%",
    alignItems: "center",
    gap: "var(--yaz-space-2)",
    margin: "var(--yaz-space-3) 0",
    color: "var(--yaz-text-muted)",
    fontFamily: "var(--yaz-font-sans)",
    fontSize: "0.72em",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-yaz-pagebreak::before, .cm-yaz-pagebreak::after": {
    content: '""',
    flex: "1",
    borderTop: "1px dashed var(--yaz-border)",
  },
  ".cm-yaz-heading": {
    fontWeight: "700",
  },
  // Part of the heading, so it inherits the heading's size and colour rather
  // than being set apart as an annotation.
  ".cm-yaz-heading-number": {
    fontWeight: "inherit",
    color: "inherit",
  },
  // One colour token per level, each defaulting to the body colour — so a
  // theme that says nothing gets headings that are merely larger, and one that
  // wants to colour the document's structure can.
  //
  // `\part` and `\chapter` are rare in a paper but enormous when used.
  ".cm-yaz-h0": {
    fontSize: "1.9em",
    lineHeight: "1.3",
    color: "var(--yaz-heading-0)",
  },
  ".cm-yaz-h1": {
    fontSize: "1.65em",
    lineHeight: "1.3",
    color: "var(--yaz-heading-1)",
  },
  ".cm-yaz-h2": {
    fontSize: "1.4em",
    lineHeight: "1.35",
    color: "var(--yaz-heading-2)",
  },
  ".cm-yaz-h3": {
    fontSize: "1.2em",
    lineHeight: "1.4",
    color: "var(--yaz-heading-3)",
  },
  ".cm-yaz-h4": { fontSize: "1.08em", color: "var(--yaz-heading-4)" },
  ".cm-yaz-h5": {
    fontSize: "1em",
    fontStyle: "italic",
    color: "var(--yaz-heading-5)",
  },
  ".cm-yaz-h6": {
    fontSize: "1em",
    fontStyle: "italic",
    color: "var(--yaz-heading-6)",
  },
  ".cm-yaz-strong": { fontWeight: "700", color: "var(--yaz-text-primary)" },
  ".cm-yaz-emphasis": { fontStyle: "italic" },
  ".cm-yaz-mono": { fontFamily: "var(--yaz-font-mono)" },
  ".cm-yaz-underline": { textDecoration: "underline" },
  ".cm-yaz-smallcaps": { fontVariant: "small-caps" },

  // Anything set on its own line rather than inside a sentence.
  ".cm-yaz-block": {
    display: "block",
    inlineSize: "100%",
    textAlign: "center",
    paddingBlock: "var(--yaz-space-2)",
  },
  ".cm-yaz-math": { cursor: "pointer" },
  ".cm-yaz-math-display": { cursor: "pointer" },
  ".cm-yaz-table-host": { cursor: "pointer", overflowX: "auto" },

  ".cm-yaz-table": {
    display: "inline-table",
    borderCollapse: "collapse",
    fontFamily: "var(--yaz-font-prose)",
    textAlign: "start",
  },
  ".cm-yaz-td": {
    padding: "var(--yaz-space-1) var(--yaz-space-3)",
    verticalAlign: "top",
  },
  ".cm-yaz-align-left": { textAlign: "start" },
  ".cm-yaz-align-center": { textAlign: "center" },
  ".cm-yaz-align-right": { textAlign: "end" },
  ".cm-yaz-td-rule-start": { borderInlineStart: "1px solid var(--yaz-border)" },
  ".cm-yaz-td-rule-end": { borderInlineEnd: "1px solid var(--yaz-border)" },
  ".cm-yaz-tr-rule-above > *": {
    borderBlockStart: "1px solid var(--yaz-border-strong)",
  },
  ".cm-yaz-tr-rule-below > *": {
    borderBlockEnd: "1px solid var(--yaz-border-strong)",
  },
  ".cm-yaz-table th": { fontWeight: "700", color: "var(--yaz-text-primary)" },

  ".cm-yaz-item-marker": {
    color: "var(--yaz-text-muted)",
    // A fixed box keeps every item's text starting in the same column, which is
    // what makes a list read as a list.
    display: "inline-block",
    minInlineSize: "1.6em",
  },
  // A quotation is set in from both edges and marked down the side, which is
  // how print does it and what makes it read as someone else's words.
  ".cm-yaz-quote": {
    paddingInlineStart: "1.5rem",
    paddingInlineEnd: "1.5rem",
    borderInlineStart: "2px solid var(--yaz-border)",
    color: "var(--yaz-text-secondary)",
    fontStyle: "italic",
  },

  ".cm-yaz-list": { paddingInlineStart: "1.5rem" },
  ".cm-yaz-list-2": { paddingInlineStart: "3rem" },
  ".cm-yaz-list-3": { paddingInlineStart: "4.5rem" },
  ".cm-yaz-list-4": { paddingInlineStart: "6rem" },

  // A page ornament, not a control: centred, quiet, and the same width as the
  // text it bounds. The rules either side are what make one glyph read as a
  // boundary rather than as a stray character in the document.
  ".cm-yaz-boundary": {
    display: "flex",
    alignItems: "center",
    gap: "var(--yaz-space-4)",
    inlineSize: "100%",
    font: "inherit",
    color: "var(--yaz-text-muted)",
    background: "none",
    border: "none",
    padding: "var(--yaz-space-2) 0",
    cursor: "pointer",
    opacity: "0.45",
    transition: "opacity 120ms ease, color 120ms ease",
  },
  ".cm-yaz-boundary::before, .cm-yaz-boundary::after": {
    content: '""',
    flex: "1",
    blockSize: "1px",
    background: "currentColor",
  },
  ".cm-yaz-boundary:hover, .cm-yaz-boundary:focus-visible": {
    opacity: "1",
    color: "var(--yaz-text-secondary)",
  },
  // The band itself. Quiet by default and unmistakable in the page view,
  // where it runs the full width of the paper.
  ".cm-yaz-matter": {
    background: "var(--yaz-bg-secondary)",
  },
  ".cm-yaz-boundary-glyph": {
    fontSize: "1.15em",
    lineHeight: "1",
    // Some platforms would otherwise draw these as emoji.
    fontVariantEmoji: "text",
  },
});
