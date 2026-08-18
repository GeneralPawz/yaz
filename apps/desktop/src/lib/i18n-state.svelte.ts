/**
 * The active locale, as reactive state.
 *
 * A rune has to be declared in a `.svelte.ts` file, and `t()` lives in a plain
 * one — reading this from there is what makes changing the language redraw the
 * interface. Without it, `t()` would be a pure function of a module variable:
 * every string in the window would keep the language it was first rendered in
 * until something else happened to re-render it, which is worse than not
 * offering the setting.
 */
export const active = $state({ locale: "en-US" });
