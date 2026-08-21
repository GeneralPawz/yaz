/**
 * The switches that change what rich text shows.
 *
 * Their own module because both `richText.ts` and `semanticView.ts` need them:
 * one puts them in the extension list and rebuilds when they move, the other
 * reads them while drawing. Defining them in either would make the two import
 * each other, and a flag is not worth a cycle.
 *
 * Each is a `StateField` rather than a prop because the decorations are built
 * from editor state, and a switch the builder cannot see is a switch that
 * takes a frame to arrive.
 */

import { StateEffect, StateField } from "@codemirror/state";

/** Show or hide the markup of an explicit line break. */
export const setShowLineBreaks = StateEffect.define<boolean>();

/**
 * Whether `\\` is shown as itself rather than as the break it makes.
 *
 * Off, because a line break is something the reader can see happening and the
 * two characters asking for it are not. On is for the times when what matters
 * is that the break is *explicit* — checking a title block, or working out why
 * a line ended early.
 */
export const showLineBreaks = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShowLineBreaks)) return effect.value;
    }
    return value;
  },
});

/** Show or hide the commands that arrange rather than say. */
export const setShowMachinery = StateEffect.define<boolean>();

/**
 * Whether the document's machinery is on screen.
 *
 * `\begin{titlepage}`, `\renewcommand{\arraystretch}{1.2}`, `\makeglossaries`,
 * `\addcontentsline` — instructions to the typesetter that produce no words.
 * Off, because rich text is a view of the document rather than of the
 * instructions for making it; on when the author is working on the machinery
 * itself and would rather not switch the whole view back to source.
 */
export const showMachinery = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShowMachinery)) return effect.value;
    }
    return value;
  },
});

/** Keep a table drawn even while the caret is inside it. */
export const setLockTables = StateEffect.define<boolean>();

/**
 * Whether a table stays drawn when you click into one of its cells.
 *
 * The rule everywhere else in the view is "what you are editing, you can see":
 * put the caret in a construct and its source comes back, because editing what
 * you cannot read is worse than reading markup. For a table that rule works
 * against itself — the thing you clicked into *is* the table, and revealing the
 * source takes it away at exactly the moment you wanted it.
 *
 * So this is opt-in and off by default. Nothing about the document changes:
 * there is still one buffer holding the raw `.tex` and this is still
 * decorations over it (ADR-0004). What changes is which decorations are drawn
 * while the caret is where it is, and an author who has not asked for it gets
 * the behaviour they had.
 *
 * The cell the caret is in is marked while this is on, because a caret inside
 * a widget is not drawn by the browser — and a table you can edit without
 * being able to see where you are would be worse than one that showed its
 * source.
 */
export const lockTables = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLockTables)) return effect.value;
    }
    return value;
  },
});
