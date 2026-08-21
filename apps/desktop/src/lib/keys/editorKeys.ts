/**
 * The registry's shortcuts, as CodeMirror bindings.
 *
 * Only the ones marked `editor`. Those need the document — what is selected,
 * what list the cursor is in — and CodeMirror's keymap is where a binding can
 * see it and stop the default from happening.
 *
 * The rest are handled at the window, because they have to work when the caret
 * is not in the editor at all.
 */

import { startCompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Command, KeyBinding } from "@codemirror/view";

import {
  clearFormatting,
  toggleEnvironment,
  toggleHeading,
  toggleInline,
} from "../editor/formatting";
import type { InlineFormat } from "../editor/formatting";
import { continueList, indentItem, outdentItem } from "../editor/listEdit";
import type { CommandId, ResolvedShortcut } from "./registry";

/** What the editor cannot do for itself. */
export interface EditorHandlers {
  save: () => void;
}

/** Apply a text transformation to the main selection. */
function transform(
  produce: (
    text: string,
    from: number,
    to: number,
  ) => {
    changes: { from: number; to: number; insert: string }[];
    from: number;
    to: number;
  },
): Command {
  return (view) => {
    const range = view.state.selection.main;
    const result = produce(view.state.doc.toString(), range.from, range.to);
    if (result.changes.length === 0) return false;
    view.dispatch({
      changes: result.changes,
      selection: { anchor: result.from, head: result.to },
      // Formatting is an edit the author made, so it is one undo step.
      userEvent: "input.format",
    });
    return true;
  };
}

/** Wrap or unwrap the selection in an inline command. */
function inline(command: InlineFormat): Command {
  return transform((text, from, to) => toggleInline(text, from, to, command));
}

/** Apply one of the list edits, or let the key do its usual job. */
function listCommand(
  produce: (
    text: string,
    at: number,
  ) => {
    changes: { from: number; to: number; insert: string }[];
    cursor: number;
  } | null,
): Command {
  return (view) => {
    const range = view.state.selection.main;
    // Only with a plain cursor. With a selection, Enter replaces it and Tab
    // indents it, and taking those over would be a surprise with no way back.
    if (!range.empty) return false;

    const result = produce(view.state.doc.toString(), range.from);
    if (!result) return false;
    view.dispatch({
      changes: result.changes,
      selection: { anchor: result.cursor },
      userEvent: "input.list",
    });
    return true;
  };
}

/** Every editor-scoped command, by the id the registry knows it as. */
function commands(
  handlers: EditorHandlers,
): Partial<Record<CommandId, Command>> {
  return {
    "document.save": () => {
      handlers.save();
      return true;
    },

    "format.bold": inline("textbf"),
    "format.italic": inline("textit"),
    "format.underline": inline("underline"),
    "format.monospace": inline("texttt"),
    "format.smallCaps": inline("textsc"),
    "format.quote": transform((text, from, to) =>
      toggleEnvironment(text, from, to, "quote"),
    ),
    "format.heading1": transform((text, from) => toggleHeading(text, from, 1)),
    "format.heading2": transform((text, from) => toggleHeading(text, from, 2)),
    "format.heading3": transform((text, from) => toggleHeading(text, from, 3)),
    "format.clear": transform(clearFormatting),

    "list.continue": listCommand(continueList),
    "list.indent": listCommand(indentItem),
    "list.outdent": listCommand(outdentItem),

    "edit.complete": startCompletion,
  };
}

/**
 * The keymap for the shortcuts that run inside the editor.
 *
 * At high precedence, so a registered binding wins over the default keymap it
 * shares a key with — `Tab` is the case that matters, where indenting a list
 * item has to beat inserting a tab, and only inside a list.
 *
 * A command that declines — `Tab` outside a list, `Ctrl+B` with nothing to
 * embolden — returns `false`, and CodeMirror moves on to the next binding.
 * That is what lets these sit on top of the defaults without replacing them.
 */
export function editorKeymap(
  shortcuts: ResolvedShortcut[],
  handlers: EditorHandlers,
): Extension {
  const implemented = commands(handlers);
  const bindings: KeyBinding[] = [];

  for (const shortcut of shortcuts) {
    if (!shortcut.editor || !shortcut.active || shortcut.binding === "")
      continue;
    const run = implemented[shortcut.id];
    if (!run) continue;
    bindings.push({ key: shortcut.binding, run, preventDefault: true });
  }

  return Prec.high(keymap.of(bindings));
}
