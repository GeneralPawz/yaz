/**
 * What order the ribbon's tabs appear in.
 *
 * Start, then the tabs about the document, then View and Help. That is Word's
 * own order and it is not arbitrary: the first tab is where a session begins,
 * the last two are about the application rather than the paper, and people
 * find both without reading the strip.
 *
 * # Why this is sorted rather than arranged
 *
 * The tabs come from several places — the menus, and the ones the ribbon
 * declares itself — and they are concatenated. Arranging them by hand means
 * the order depends on where each source happens to be spliced in, so a tab
 * added later lands wherever its source sits rather than where it belongs.
 *
 * # Why it is its own file
 *
 * Because it is arithmetic, and arithmetic about positions is where an
 * off-by-one lives. Inside a component it could only be checked by looking at
 * the window; here it can be asked directly.
 */

/** Anything with an identifier can be ordered. */
export interface Orderable {
  id: string;
}

/** Pinned to the front, in this order. */
export const FIRST_TABS = ["ribbon-start"];

/** Pinned to the back, in this order. */
export const LAST_TABS = ["menu-view", "menu-help"];

/**
 * Sort tabs into the strip's order.
 *
 * Anything named in neither list keeps the order it was built in, between the
 * two ends — a new tab appears in a sensible place without having to be added
 * here, and only a tab that wants a specific end needs naming.
 */
export function orderTabs<T extends Orderable>(tabs: readonly T[]): T[] {
  // Ranks are spaced so that the unnamed band cannot collide with either end,
  // whatever the two lists contain.
  const middle = FIRST_TABS.length;
  const end = middle + 1;

  const rank = (tab: T) => {
    const first = FIRST_TABS.indexOf(tab.id);
    if (first !== -1) return first;
    const last = LAST_TABS.indexOf(tab.id);
    if (last !== -1) return end + last;
    return middle;
  };

  // `Array.prototype.sort` is stable, which is what keeps the unnamed tabs in
  // the order they were built in rather than reversing them or worse.
  return [...tabs].sort((a, b) => rank(a) - rank(b));
}
