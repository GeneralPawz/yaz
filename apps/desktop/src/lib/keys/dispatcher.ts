/**
 * Chords, at the window.
 *
 * The shortcuts that are not editor-scoped run here, because they have to work
 * when the caret is not in the editor — with no file open, or with focus in the
 * PDF pane.
 *
 * # Why the chord state lives here and not in CodeMirror
 *
 * CodeMirror handles multi-stroke bindings itself, but it refuses to let one
 * key be both a binding and the start of a chord. `Ctrl+Space` is exactly that
 * conflict: it is the editor's completion key and the prefix the whole yaz
 * family hangs off. Taking the prefix at the window, in the capture phase,
 * settles it before CodeMirror is asked — and completion moves to
 * `Ctrl+Shift+Space`, which is a registered, listed, rebindable shortcut rather
 * than something silently taken away.
 *
 * # What a pending chord means
 *
 * After the prefix, the next key either completes a chord or cancels it.
 * Nothing else happens in between — no timeout, because a timeout means a
 * shortcut works or not depending on how fast someone types, and Escape is
 * already the key everyone reaches for.
 */

import { normalise } from "./registry";
import type { CommandId, ResolvedShortcut } from "./registry";

/** What the dispatcher tells the application. */
export type Run = (command: CommandId) => void;

/** Turn a keyboard event into the registry's notation. */
export function eventToBinding(event: KeyboardEvent): string {
  const parts: string[] = [];
  // `Mod` is Ctrl everywhere but macOS, where it is Cmd — the same
  // abbreviation the bindings are written with.
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = event.key === " " ? "Space" : event.key;
  // A single letter is written unshifted: `Mod-Shift-k`, never `Mod-Shift-K`.
  parts.push(key.length === 1 ? key.toLowerCase() : key);
  return parts.join("-");
}

/**
 * Runs window-scoped shortcuts, holding the state of a part-typed chord.
 *
 * Not a component and not reactive: a keystroke is not state, and making the
 * pending prefix reactive would redraw the window between the two halves of a
 * chord.
 */
export class KeyDispatcher {
  private shortcuts: ResolvedShortcut[] = [];
  private pending: string | null = null;

  constructor(private readonly run: Run) {}

  /** Replace the bindings, e.g. after a settings change. */
  update(shortcuts: ResolvedShortcut[]): void {
    this.shortcuts = shortcuts.filter(
      (shortcut) =>
        !shortcut.editor && shortcut.active && shortcut.binding !== "",
    );
    this.pending = null;
  }

  /** Whether a chord is part-typed, for showing it in the status bar. */
  get prefix(): string | null {
    return this.pending;
  }

  /**
   * Handle a key. Returns whether it was taken.
   *
   * Bare modifiers are ignored rather than cancelling: holding Ctrl to press
   * the second half of a chord must not abandon the first.
   */
  handle(event: KeyboardEvent): boolean {
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return false;

    const step = eventToBinding(event);

    if (this.pending) {
      const whole = `${this.pending} ${step}`;
      this.pending = null;
      const match = this.find(whole);
      if (match) {
        this.run(match.id);
        return true;
      }
      // Cancelled. The key is swallowed either way: the second half of an
      // abandoned chord is not something the document should receive.
      return true;
    }

    if (this.startsChord(step)) {
      this.pending = step;
      return true;
    }

    const match = this.find(step);
    if (!match) return false;
    this.run(match.id);
    return true;
  }

  /** Forget a part-typed chord, e.g. on Escape or a click. */
  cancel(): void {
    this.pending = null;
  }

  private find(binding: string): ResolvedShortcut | undefined {
    const wanted = normalise(binding);
    return this.shortcuts.find(
      (shortcut) => normalise(shortcut.binding) === wanted,
    );
  }

  private startsChord(step: string): boolean {
    const wanted = normalise(step);
    return this.shortcuts.some((shortcut) => {
      const [first, ...rest] = shortcut.binding.split(" ");
      return (
        rest.length > 0 && first !== undefined && normalise(first) === wanted
      );
    });
  }
}
