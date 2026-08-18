/**
 * What Enter and Tab do inside a list.
 *
 * # Why this is here rather than in the editor
 *
 * These are text transformations — given the document and where the cursor is,
 * produce an edit — so they are written as functions of exactly that and tested
 * as such. The editor command is then three lines that apply the result, and
 * the interesting cases (an empty bullet, a nested list, an item in the middle
 * of one) get tested without a browser.
 *
 * # What they do, and why that is not what the keys say
 *
 * Enter inside a list starts the next item rather than a bare line, and Tab
 * makes the item a sub-item. Both are keys doing something other than their
 * name, which is exactly the sort of surprise a user has to be able to find and
 * switch off — so both are registered shortcuts in a suite of their own, not
 * behaviour baked into the editor.
 *
 * There is one document and it is the `.tex` (ADR-0004), so "a sub-item" means
 * a nested `itemize`, written into the source, and not a property held beside
 * it.
 */

import { environments, itemMarkers } from "./structure";
import type { Environment, ItemMarker } from "./structure";

/** The environments these commands understand. */
const LISTS = ["itemize", "enumerate", "description"];

/** An edit to apply, in CodeMirror's terms. */
export interface Edit {
  changes: { from: number; to: number; insert: string }[];
  /** Where the cursor ends up. */
  cursor: number;
}

/** Where the cursor is, in terms of the list around it. */
interface Context {
  list: Environment;
  /** How many lists enclose this one. */
  depth: number;
  /** The item the cursor is in, if any. */
  item: ItemMarker | null;
  /** Every item of this list, in order. */
  items: ItemMarker[];
  /** The whitespace the list's items start their lines with. */
  indent: string;
}

/** Read the list around an offset, or `null` if there is none. */
function contextAt(text: string, at: number): Context | null {
  const all = environments(text, LISTS);
  const containing = all.filter(
    (list) => list.bodyFrom <= at && at <= list.bodyTo,
  );
  const list = containing.at(-1);
  if (!list) return null;

  const markers = itemMarkers(text);
  const items = markers.filter(
    (marker) =>
      marker.from >= list.bodyFrom &&
      marker.from < list.bodyTo &&
      // An item inside a nested list belongs to that list, not this one.
      !all.some(
        (inner) =>
          inner !== list &&
          inner.from >= list.bodyFrom &&
          inner.to <= list.bodyTo &&
          marker.from >= inner.bodyFrom &&
          marker.from < inner.bodyTo,
      ),
  );

  // The item the cursor is in: the last one that starts before it.
  const item = items.filter((marker) => marker.from <= at).at(-1) ?? null;

  return {
    list,
    depth: all.filter((other) => other.from < list.from && other.to > list.to)
      .length,
    item,
    items,
    indent: indentOf(text, items[0]?.from ?? list.bodyFrom),
  };
}

/** The whitespace at the start of the line an offset is on. */
function indentOf(text: string, at: number): string {
  const start = text.lastIndexOf("\n", Math.max(at - 1, 0)) + 1;
  return /^[ \t]*/.exec(text.slice(start, at))?.[0] ?? "";
}

/** The end of the line an offset is on. */
function lineEnd(text: string, at: number): number {
  const found = text.indexOf("\n", at);
  return found === -1 ? text.length : found;
}

/** The start of the line an offset is on. */
function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", Math.max(at - 1, 0)) + 1;
}

/**
 * Enter: start the next item.
 *
 * On an item with nothing in it, the list ends instead — pressing Enter twice
 * to stop being in a list is how every word processor works, and without it
 * leaving a list means reaching for the mouse.
 *
 * Returns `null` when the cursor is not in a list, so the caller lets Enter be
 * Enter.
 */
export function continueList(text: string, at: number): Edit | null {
  const context = contextAt(text, at);
  if (!context || !context.item) return null;

  // Only when the cursor is on the item's own line: Enter in the middle of a
  // wrapped item should split it, which is what Enter already does.
  const end = lineEnd(text, at);
  const body = text.slice(context.item.to, end).trim();

  if (body === "") {
    return endList(text, context);
  }

  const marker = context.list.name === "description" ? "\\item[] " : "\\item ";
  return {
    changes: [{ from: at, to: at, insert: `\n${context.indent}${marker}` }],
    cursor: at + 1 + context.indent.length + marker.length,
  };
}

/**
 * Enter on an empty item: leave the list.
 *
 * The empty item goes, and the cursor lands after the environment. Nested, it
 * lands in the list outside instead, which is what pressing Enter at the end of
 * a sub-list means.
 */
function endList(text: string, context: Context): Edit {
  const item = context.item!;
  const from = lineStart(text, item.from);
  // Take the line break with it, or an empty line is left where the item was.
  const to = Math.min(lineEnd(text, item.from) + 1, text.length);

  return {
    changes: [{ from, to, insert: "" }],
    // Just past `\end{...}`, which has moved up by however much was removed.
    cursor: context.list.to - (to - from),
  };
}

/**
 * Tab: make this item a sub-item.
 *
 * Joins the sub-list above when there is one, and starts a new one when there
 * is not — so pressing Tab on three items in a row produces one nested list of
 * three rather than three nested lists of one.
 *
 * Returns `null` for the first item of a list, which has nothing to be nested
 * under. LaTeX would accept it; a reader would not, and neither does Word.
 */
export function indentItem(text: string, at: number): Edit | null {
  const context = contextAt(text, at);
  if (!context?.item) return null;

  const index = context.items.indexOf(context.item);
  if (index <= 0) return null;

  const item = context.item;
  const from = lineStart(text, item.from);
  const to = lineEnd(text, item.from);
  const line = text.slice(from, to);
  const inner = `${context.indent}  `;
  // The cursor's position within the line survives the move.
  const offset = at - from;

  const previous = existingSublist(text, context, index);
  if (previous) {
    // Slide the line inside the sub-list that is already there, just before
    // its `\end`.
    const target = lineStart(text, previous.bodyTo);
    const moved = `${inner}  ${line.trim()}\n`;
    const shift = target > from ? -(to - from + 1) : 0;
    return {
      changes: [
        { from, to: Math.min(to + 1, text.length), insert: "" },
        { from: target, to: target, insert: moved },
      ],
      cursor:
        target +
        shift +
        inner.length +
        2 +
        Math.max(offset - context.indent.length, 0),
    };
  }

  const marker = context.list.name;
  const wrapped =
    `${inner}\\begin{${marker}}\n` +
    `${inner}  ${line.trim()}\n` +
    `${inner}\\end{${marker}}`;
  return {
    changes: [{ from, to, insert: wrapped }],
    cursor:
      from +
      inner.length +
      `\\begin{${marker}}`.length +
      1 +
      inner.length +
      2 +
      Math.max(offset - context.indent.length, 0),
  };
}

/** The sub-list immediately above this item, if the previous sibling has one. */
function existingSublist(
  text: string,
  context: Context,
  index: number,
): Environment | null {
  const previous = context.items[index - 1];
  if (!previous) return null;
  const between = environments(text, LISTS).filter(
    (list) =>
      list.from > previous.from &&
      list.to <= context.item!.from &&
      list.name === context.list.name,
  );
  return between.at(-1) ?? null;
}

/**
 * Shift+Tab: lift this item out of its sub-list.
 *
 * When it is the only item, the sub-list goes with it. When it is the last, it
 * moves out below. When it is in the middle, the list splits around it —
 * anything else would silently reorder the author's items.
 *
 * Returns `null` at the outermost level, where there is nothing to lift out of.
 */
export function outdentItem(text: string, at: number): Edit | null {
  const context = contextAt(text, at);
  if (!context?.item || context.depth === 0) return null;

  const { list, item, items } = context;
  const index = items.indexOf(item);
  const from = lineStart(text, item.from);
  const to = lineEnd(text, item.from);
  const line = text.slice(from, to).trim();
  const offset = at - from;

  // The indentation to land on is the enclosing list's own, read from it
  // rather than subtracted from this one. How far a level indents is the
  // author's choice — two spaces, four, a tab — and arithmetic on this list's
  // indentation would impose ours on a document written to a house style.
  const outer = outerIndent(text, context);

  if (items.length === 1) {
    // The whole sub-list is this item. Replace it with the item.
    const start = lineStart(text, list.from);
    const finish = Math.min(lineEnd(text, list.bodyTo) + 1, text.length);
    return {
      changes: [{ from: start, to: finish, insert: `${outer}${line}\n` }],
      cursor:
        start + outer.length + Math.max(offset - context.indent.length, 0),
    };
  }

  if (index === items.length - 1) {
    // The last item: move it out below the sub-list.
    const finish = Math.min(lineEnd(text, list.bodyTo) + 1, text.length);
    const closing = text.slice(lineStart(text, list.bodyTo), finish);
    return {
      changes: [
        {
          from,
          to: finish,
          insert: `${closing}${outer}${line}\n`,
        },
      ],
      cursor:
        from +
        closing.length +
        outer.length +
        Math.max(offset - context.indent.length, 0),
    };
  }

  // In the middle: close the list, emit the item, open it again.
  const marker = list.name;
  const wrapper = indentOf(text, list.from);
  const closing = `${wrapper}\\end{${marker}}\n`;
  const split = `${closing}${outer}${line}\n${wrapper}\\begin{${marker}}\n`;
  return {
    changes: [{ from, to: Math.min(to + 1, text.length), insert: split }],
    cursor:
      from +
      closing.length +
      outer.length +
      Math.max(offset - context.indent.length, 0),
  };
}

/**
 * The indentation of the list one level out.
 *
 * Read from that list's own items where it has any, so an item lifted out
 * lines up with its new siblings. Falling back to the `\begin` line's
 * indentation covers the case where it has none yet.
 */
function outerIndent(text: string, context: Context): string {
  const enclosing = environments(text, LISTS)
    .filter(
      (other) => other.from < context.list.from && other.to > context.list.to,
    )
    .at(-1);
  if (!enclosing) return "";

  const sibling = itemMarkers(text)
    .filter(
      (marker) =>
        marker.from >= enclosing.bodyFrom && marker.from < context.list.from,
    )
    .at(-1);
  return indentOf(text, sibling?.from ?? enclosing.bodyFrom);
}

/** Whether an offset is inside a list at all, for deciding whether to act. */
export function inList(text: string, at: number): boolean {
  return contextAt(text, at) !== null;
}
