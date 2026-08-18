/**
 * The shortcut registry, and the chord dispatcher.
 *
 * Two things are checked here that nothing else can check: that the shortcuts
 * yaz ships with do not fight each other, and that a chord is a chord — the
 * prefix alone does nothing, and the second key decides.
 */

import { describe, expect, it, vi } from "vitest";

import { KeyDispatcher, eventToBinding } from "./dispatcher";
import {
  DEFAULT_PREFERENCES,
  SHORTCUTS,
  conflicts,
  describe as describeBinding,
  normalise,
  resolve,
} from "./registry";

/** A keyboard event, as the browser would give one. */
function press(
  key: string,
  modifiers: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe("what yaz ships with", () => {
  it("binds nothing twice", () => {
    // Two features cannot have one key, and neither can discover that from
    // inside itself. This is the check that makes the registry worth having.
    expect([...conflicts(resolve(DEFAULT_PREFERENCES)).keys()]).toEqual([]);
  });

  it("gives every shortcut a suite", () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.suites.length, shortcut.id).toBeGreaterThan(0);
    }
  });

  it("keeps editor shortcuts clear of the window's chord prefixes", () => {
    // The window takes a chord prefix in the capture phase, before CodeMirror
    // is asked. An editor binding hiding behind one could never fire, and
    // nothing else would ever say so.
    const prefixes = new Set(
      SHORTCUTS.filter((s) => !s.editor && s.keys.includes(" ")).map(
        (s) => s.keys.split(" ")[0],
      ),
    );
    for (const shortcut of SHORTCUTS) {
      if (!shortcut.editor) continue;
      expect(prefixes.has(shortcut.keys.split(" ")[0]), shortcut.id).toBe(
        false,
      );
    }
  });

  it("puts the keys a beginner presses by accident behind a suite", () => {
    // Enter and Tab doing something other than their name is exactly the sort
    // of surprise that has to be switchable.
    for (const id of ["list.continue", "list.indent", "list.outdent"]) {
      const shortcut = SHORTCUTS.find((candidate) => candidate.id === id);
      expect(shortcut?.suites).not.toContain("core");
    }
  });
});

describe("resolve", () => {
  it("switches a suite off", () => {
    const resolved = resolve({
      ...DEFAULT_PREFERENCES,
      disabledSuites: ["word"],
    });
    expect(resolved.find((s) => s.id === "format.bold")?.active).toBe(false);
    expect(resolved.find((s) => s.id === "document.save")?.active).toBe(true);
  });

  it("will not switch off the core", () => {
    // Without these there is no keyboard, and a settings file that says
    // otherwise should not produce an application nobody can save from.
    const resolved = resolve({
      ...DEFAULT_PREFERENCES,
      disabledSuites: ["core"],
    });
    expect(resolved.find((s) => s.id === "document.save")?.active).toBe(true);
  });

  it("takes a rebinding", () => {
    const resolved = resolve({
      ...DEFAULT_PREFERENCES,
      overrides: { "format.bold": "Mod-Alt-b" },
    });
    const bold = resolved.find((s) => s.id === "format.bold");
    expect(bold?.binding).toBe("Mod-Alt-b");
    expect(bold?.changed).toBe(true);
  });

  it("reports a clash rather than refusing it", () => {
    // Someone rebinding one shortcut onto another's key has usually not
    // finished; refusing the first half of a swap makes swapping impossible.
    const resolved = resolve({
      ...DEFAULT_PREFERENCES,
      overrides: { "format.italic": "Mod-b" },
    });
    expect([...conflicts(resolved).values()].flat()).toContain("format.bold");
  });
});

describe("normalise", () => {
  it("reads the same shortcut written two ways as one", () => {
    // Otherwise the conflict check reports no conflict for two bindings that
    // do fight.
    expect(normalise("Mod-Shift-b")).toBe(normalise("Shift-Mod-B"));
  });

  it("keeps the steps of a chord apart", () => {
    expect(normalise("Mod-Space r")).not.toBe(normalise("Mod-Space-r"));
  });
});

describe("describe", () => {
  it("writes a chord as a sequence", () => {
    // "Ctrl+Space+R" says something else entirely.
    expect(describeBinding("Mod-Space r", "Win32")).toBe("Ctrl+Space, R");
  });

  it("uses the key that is on the keyboard", () => {
    expect(describeBinding("Mod-b", "Win32")).toBe("Ctrl+B");
    expect(describeBinding("Mod-b", "MacIntel")).toBe("⌘B");
  });
});

describe("KeyDispatcher", () => {
  function dispatcher() {
    const run = vi.fn();
    const keys = new KeyDispatcher(run);
    keys.update(resolve(DEFAULT_PREFERENCES));
    return { keys, run };
  }

  it("does nothing on the prefix alone", () => {
    const { keys, run } = dispatcher();
    expect(keys.handle(press(" ", { ctrlKey: true }))).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(keys.prefix).toBe("Mod-Space");
  });

  it("runs the command on the second key", () => {
    const { keys, run } = dispatcher();
    keys.handle(press(" ", { ctrlKey: true }));
    keys.handle(press("r"));
    expect(run).toHaveBeenCalledWith("view.toggleRichText");
    expect(keys.prefix).toBeNull();
  });

  it("swallows a second key that completes nothing", () => {
    // The tail of an abandoned chord is not something the document should
    // receive as typing.
    const { keys, run } = dispatcher();
    keys.handle(press(" ", { ctrlKey: true }));
    expect(keys.handle(press("z"))).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("is not cancelled by holding a modifier", () => {
    const { keys, run } = dispatcher();
    keys.handle(press(" ", { ctrlKey: true }));
    expect(keys.handle(press("Control", { ctrlKey: true }))).toBe(false);
    keys.handle(press("r"));
    expect(run).toHaveBeenCalledWith("view.toggleRichText");
  });

  it("leaves editor shortcuts to the editor", () => {
    // `Ctrl+B` needs the document, so it must reach CodeMirror rather than
    // being taken at the window.
    const { keys, run } = dispatcher();
    expect(keys.handle(press("b", { ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a suite that is switched off", () => {
    const run = vi.fn();
    const keys = new KeyDispatcher(run);
    keys.update(resolve({ ...DEFAULT_PREFERENCES, disabledSuites: ["yaz"] }));
    expect(keys.handle(press(" ", { ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("eventToBinding", () => {
  it("writes a letter unshifted", () => {
    expect(eventToBinding(press("K", { ctrlKey: true, shiftKey: true }))).toBe(
      "Mod-Shift-k",
    );
  });

  it("names the space bar", () => {
    expect(eventToBinding(press(" ", { ctrlKey: true }))).toBe("Mod-Space");
  });
});
