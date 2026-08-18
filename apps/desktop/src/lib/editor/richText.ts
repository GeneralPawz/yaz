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
  Range,
  StateEffectType,
  Text,
  Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { t } from "../i18n";
import { escapeHtml, inlineHtml } from "./inline";
import { renderMath, renderMathEnvironment } from "./math";
import { renderTable, tooComplexToDraw } from "./tabular";
import {
  braceCommands,
  environments,
  headings,
  itemMarkers,
  mathSpans,
  matchBrace,
  preamble,
} from "./structure";
import type { Environment } from "./structure";

/** Inline commands that render as styled text, mapped to their CSS class. */
const INLINE: Record<string, string> = {
  textbf: "cm-yaz-strong",
  textit: "cm-yaz-emphasis",
  emph: "cm-yaz-emphasis",
  texttt: "cm-yaz-mono",
  underline: "cm-yaz-underline",
  textsc: "cm-yaz-smallcaps",
};

/** Environments that are mathematics, handed to KaTeX whole. */
const MATH_ENVIRONMENTS = [
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "displaymath",
  "eqnarray",
  "eqnarray*",
];

/**
 * Table environments, and how many `{...}` arguments precede the column
 * specification.
 *
 * `tabular*` and `tabularx` take a target width first. Reading that as the
 * column specification would give a table of no columns.
 */
const TABLE_ENVIRONMENTS: Record<string, number> = {
  tabular: 0,
  "tabular*": 1,
  tabularx: 1,
  longtable: 0,
};

/** Lists whose items get a marker. */
const LIST_ENVIRONMENTS = ["itemize", "enumerate", "description"];

/** Bullets by nesting depth, as LaTeX itself sets them. */
const BULLETS = ["•", "◦", "▪", "·"];

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

/** Show or hide the preamble. */
export const setFrontmatterCollapsed = StateEffect.define<boolean>();

/**
 * Whether the preamble is folded away.
 *
 * Collapsed to begin with. The preamble is machinery — `\usepackage` lines,
 * margins, macro definitions — and a view whose purpose is to show the document
 * as it will read should not open on half a page of configuration.
 */
export const frontmatterCollapsed = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFrontmatterCollapsed)) return effect.value;
    }
    return value;
  },
});

/** Nothing at all, used to hide markup. */
const hidden = Decoration.replace({});

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

/** The clickable line that stands in for — or sits above — the preamble. */
class FrontmatterWidget extends WidgetType {
  constructor(readonly collapsed: boolean) {
    super();
  }

  override eq(other: FrontmatterWidget): boolean {
    return other.collapsed === this.collapsed;
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-yaz-frontmatter";
    button.setAttribute("aria-expanded", String(!this.collapsed));
    // Written out rather than as one `t(condition ? a : b)`, so that the
    // message-key check can see both keys at the call site (ADR-0011).
    button.title = this.collapsed
      ? t("editor-frontmatter-expand")
      : t("editor-frontmatter-collapse");

    const marker = document.createElement("span");
    marker.className = "cm-yaz-frontmatter-marker";
    // Decorative: the label says what this is and the button says whether it is
    // open, so a screen reader gains nothing from the triangle.
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.collapsed ? "▸" : "▾";

    const label = document.createElement("span");
    label.textContent = t("editor-frontmatter");

    button.append(marker, label);
    // Without this the editor takes focus and moves the selection before the
    // click lands, scrolling the view for no reason.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setFrontmatterCollapsed.of(!this.collapsed) });
      view.focus();
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Ranges already stood in for by a widget.
 *
 * Two replacements may not overlap, and a formula inside a table cell has
 * already been drawn by the table. Anything replacing source inside one of
 * these is dropped; marks are not, because a mark over replaced text simply
 * does not show.
 */
class Covered {
  private readonly spans: { from: number; to: number }[] = [];

  add(from: number, to: number): void {
    this.spans.push({ from, to });
  }

  overlaps(from: number, to: number): boolean {
    return this.spans.some((span) => from < span.to && to > span.from);
  }
}

/** Everything a build pass needs to hand around. */
interface Pass {
  state: EditorState;
  text: string;
  ranges: Range<Decoration>[];
  covered: Covered;
}

/** Whether the selection touches a range, in which case its markup is shown. */
function touched(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

/** Replace a range with nothing or a widget, unless something already has. */
function replace(
  pass: Pass,
  from: number,
  to: number,
  widget?: WidgetType,
): boolean {
  if (from >= to) return false;
  if (pass.covered.overlaps(from, to)) return false;
  pass.covered.add(from, to);
  pass.ranges.push(
    (widget ? Decoration.replace({ widget }) : hidden).range(from, to),
  );
  return true;
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
 * paper-sized file and 12 ms for a hundred-page manuscript, against the 16 ms
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
function build(state: EditorState): DecorationSet {
  if (!state.field(richTextEnabled, false)) return Decoration.none;

  const pass: Pass = {
    state,
    text: state.doc.toString(),
    ranges: [],
    covered: new Covered(),
  };

  frontmatter(pass);
  tables(pass);
  mathematics(pass);
  lists(pass);
  inlineMarkup(pass);

  // Sorting is CodeMirror's, which knows how line, mark and replace decorations
  // order against each other at the same position.
  return Decoration.set(pass.ranges, true);
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

/** The range the fold covers: the preamble, out to the end of its last line. */
function foldRange(doc: Text): { from: number; to: number } | null {
  const found = preamble(
    doc.sliceString(0, Math.min(doc.length, PREAMBLE_LIMIT)),
  );
  if (!found) return null;
  // Out to the end of the line, so folding does not leave the remains of the
  // `\begin{document}` line hanging above the document.
  return { from: found.from, to: doc.lineAt(found.to).to };
}

/** The preamble, folded behind a line that expands it. */
function frontmatter(pass: Pass): void {
  const found = foldRange(pass.state.doc);
  if (!found) return;

  const to = found.to;

  if (!pass.state.field(frontmatterCollapsed, false)) {
    pass.ranges.push(
      Decoration.widget({
        widget: new FrontmatterWidget(false),
        block: true,
        side: -1,
      }).range(0),
    );
    return;
  }

  replace(pass, found.from, to, new FrontmatterWidget(true));
}

/** Tables, drawn from their source. */
function tables(pass: Pass): void {
  for (const table of environments(
    pass.text,
    Object.keys(TABLE_ENVIRONMENTS),
  )) {
    const read = columnSpec(
      pass.text,
      table.bodyFrom,
      TABLE_ENVIRONMENTS[table.name] ?? 0,
    );
    if (!read) continue;

    const body = pass.text.slice(read.bodyFrom, table.bodyTo);
    // A construct this parser would draw wrongly is shown as source instead.
    // The author can see that source is source; they cannot see that a drawn
    // table has quietly lost a row.
    if (tooComplexToDraw(body)) continue;

    const html = renderTable(read.spec, body);
    if (html === null) continue;
    if (touched(pass.state, table.from, table.to)) {
      // Claimed even while revealed, so nothing else decorates the source the
      // author is currently editing.
      pass.covered.add(table.from, table.to);
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
      pass.covered.add(from, to);
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

  for (const environment of environments(pass.text, MATH_ENVIRONMENTS)) {
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
function lists(pass: Pass): void {
  const found = environments(pass.text, LIST_ENVIRONMENTS);
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

    const label =
      marker.labelFrom !== null && marker.labelTo !== null
        ? inlineHtml(pass.text.slice(marker.labelFrom, marker.labelTo))
        : escapeHtml(itemLabel(list.name, depth, position));

    if (touched(pass.state, marker.from, marker.to)) {
      pass.covered.add(marker.from, marker.to);
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
 * Headings and inline commands.
 *
 * The styling mark is applied whatever else is happening — a mark over replaced
 * text simply does not show, and refusing to style a heading because it
 * contains a formula would be worse than either. Only the ranges that *hide*
 * markup have to respect what is already claimed.
 */
function inlineMarkup(pass: Pass): void {
  for (const heading of headings(pass.text)) {
    const level = Math.min(heading.level, 6);
    if (heading.titleTo > heading.titleFrom) {
      pass.ranges.push(
        Decoration.mark({ class: `cm-yaz-heading cm-yaz-h${level}` }).range(
          heading.titleFrom,
          heading.titleTo,
        ),
      );
    }
    if (!touched(pass.state, heading.from, heading.to)) {
      // Hide `\section{` and the closing brace, leaving the words.
      replace(pass, heading.from, heading.titleFrom);
      replace(pass, heading.titleTo, heading.to);
    }
  }

  for (const command of braceCommands(pass.text, Object.keys(INLINE))) {
    const className = INLINE[command.command];
    if (!className) continue;
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
const decorations = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update(value, transaction) {
    // Selection changes matter as much as edits: moving the caret into a
    // construct is what reveals its markup.
    const toggled = transaction.effects.some(
      (effect) => effect.is(setRichText) || effect.is(setFrontmatterCollapsed),
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
  provide: (field) => EditorView.decorations.from(field),
});

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
 * Keep the cursor out of the folded preamble.
 *
 * A cursor inside a replacement is invisible, and typing at it edits text the
 * author cannot see — `\usepackage` lines, in this case. It is reachable in
 * ordinary use: opening a file puts the cursor at offset zero, which is inside
 * the fold.
 *
 * So an empty selection landing in the fold is moved to just after it. A
 * non-empty one is left alone: selecting everything and typing means replacing
 * everything, and that includes the preamble.
 */
const cursorStaysOutOfTheFold = EditorState.transactionFilter.of(
  (transaction) => {
    if (!after(transaction, richTextEnabled, setRichText, false))
      return transaction;
    if (
      !after(transaction, frontmatterCollapsed, setFrontmatterCollapsed, true)
    ) {
      return transaction;
    }

    const selection = transaction.newSelection;
    if (!selection.ranges.some((range) => range.empty)) return transaction;

    const fold = foldRange(transaction.newDoc);
    if (!fold) return transaction;
    // Nowhere to move to: the file ends at `\begin{document}`.
    const target = fold.to + 1;
    if (target > transaction.newDoc.length) return transaction;
    if (
      !selection.ranges.some(
        (range) =>
          range.empty && range.to >= fold.from && range.from <= fold.to,
      )
    ) {
      return transaction;
    }

    const moved = selection.ranges.map((range) =>
      range.empty && range.to >= fold.from && range.from <= fold.to
        ? EditorSelection.cursor(target)
        : range,
    );
    return [
      transaction,
      { selection: EditorSelection.create(moved, selection.mainIndex) },
    ];
  },
);

/** The rich-text extension: state, decorations and their styling. */
export function richText(): Extension {
  // Order matters: `decorations` reads the two flags as it is created.
  return [
    richTextEnabled,
    frontmatterCollapsed,
    decorations,
    cursorStaysOutOfTheFold,
    theme,
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
  ".cm-yaz-list": { paddingInlineStart: "1.5rem" },
  ".cm-yaz-list-2": { paddingInlineStart: "3rem" },
  ".cm-yaz-list-3": { paddingInlineStart: "4.5rem" },
  ".cm-yaz-list-4": { paddingInlineStart: "6rem" },

  ".cm-yaz-frontmatter": {
    font: "inherit",
    fontFamily: "var(--yaz-font-ui)",
    fontSize: "var(--yaz-font-size-sm)",
    color: "var(--yaz-text-muted)",
    background: "var(--yaz-bg-secondary)",
    border: "1px solid var(--yaz-border)",
    borderRadius: "var(--yaz-radius-sm)",
    padding: "0 var(--yaz-space-2)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--yaz-space-2)",
  },
  ".cm-yaz-frontmatter:hover": {
    color: "var(--yaz-text-primary)",
    background: "var(--yaz-bg-hover)",
  },
  ".cm-yaz-frontmatter-marker": { color: "var(--yaz-text-muted)" },
});
