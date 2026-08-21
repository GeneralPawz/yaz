/**
 * The order the ribbon's tabs appear in.
 *
 * Ordering by hand went wrong twice in conversation before it was written
 * down, in both directions, which is reason enough to be able to ask the code
 * what it does rather than run the application and look.
 */

import { describe, expect, it } from "vitest";

import { orderTabs } from "./ribbonOrder";

/** Tabs in the order the shell happens to build them. */
const built = [
  { id: "ribbon-start" },
  { id: "menu-view" },
  { id: "menu-help" },
  { id: "ribbon-connections" },
  { id: "layout" },
  { id: "document" },
  { id: "work" },
];

const ids = (tabs: { id: string }[]) => tabs.map((tab) => tab.id);

describe("orderTabs", () => {
  it("puts Start first and Help last, with View beside it", () => {
    expect(ids(orderTabs(built))).toEqual([
      "ribbon-start",
      "ribbon-connections",
      "layout",
      "document",
      "work",
      "menu-view",
      "menu-help",
    ]);
  });

  it("keeps the unnamed tabs in the order they were built", () => {
    // Which is what lets a tab be added without naming it here, and still
    // appear somewhere sensible.
    const shuffled = [
      { id: "work" },
      { id: "menu-help" },
      { id: "document" },
      { id: "ribbon-start" },
      { id: "layout" },
    ];
    expect(ids(orderTabs(shuffled))).toEqual([
      "ribbon-start",
      "work",
      "document",
      "layout",
      "menu-help",
    ]);
  });

  it("keeps View before Help however they arrive", () => {
    expect(ids(orderTabs([{ id: "menu-help" }, { id: "menu-view" }]))).toEqual([
      "menu-view",
      "menu-help",
    ]);
  });

  it("does not need every named tab to be present", () => {
    // Tabs come and go — Edit and Tools were removed — and an order that only
    // worked for the full set would break the moment one was dropped.
    expect(ids(orderTabs([{ id: "work" }, { id: "menu-help" }]))).toEqual([
      "work",
      "menu-help",
    ]);
  });

  it("leaves the input alone", () => {
    // The shell hands this a derived array; sorting it in place would reorder
    // the thing it was derived from.
    const original = [{ id: "menu-help" }, { id: "ribbon-start" }];
    orderTabs(original);
    expect(ids(original)).toEqual(["menu-help", "ribbon-start"]);
  });

  it("copes with nothing at all", () => {
    expect(orderTabs([])).toEqual([]);
  });
});
