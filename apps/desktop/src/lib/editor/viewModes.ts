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
