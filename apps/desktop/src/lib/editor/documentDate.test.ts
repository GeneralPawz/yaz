/**
 * The document's date.
 *
 * `\date{}` takes three different things behind one syntax, and the cases here
 * are the ones a text field cannot tell apart: no date at all, today whenever
 * that turns out to be, and a day someone chose.
 */

import { describe, expect, it } from "vitest";

import { formatDate, readDate, writeDate } from "./documentDate";

describe("readDate", () => {
  it("reads an absent \\date as today", () => {
    // LaTeX's own behaviour: leaving the command out prints today's date.
    expect(readDate(null)).toEqual({ kind: "today" });
  });

  it("tells no date apart from not set", () => {
    // `\date{}` deliberately prints nothing, which is not the same as leaving
    // the command out — and a text field shows both as empty.
    expect(readDate("")).toEqual({ kind: "none" });
  });

  it("reads \\today", () => {
    expect(readDate("\\today")).toEqual({ kind: "today" });
    expect(readDate("  \\today  ")).toEqual({ kind: "today" });
  });

  it("reads a chosen day", () => {
    expect(readDate("2026-08-19")).toEqual({ kind: "on", iso: "2026-08-19" });
  });

  it("keeps something it does not model", () => {
    // "Michaelmas Term 2026" is deliberate, and offering to reduce it to a
    // calendar date would quietly throw it away.
    expect(readDate("Michaelmas Term 2026")).toEqual({
      kind: "literal",
      text: "Michaelmas Term 2026",
    });
    expect(readDate("\\DTMdate{2026-08-19}")).toEqual({
      kind: "literal",
      text: "\\DTMdate{2026-08-19}",
    });
  });
});

describe("writeDate", () => {
  it("round-trips every choice", () => {
    for (const argument of [
      "\\today",
      "",
      "2026-08-19",
      "Michaelmas Term 2026",
    ]) {
      expect(writeDate(readDate(argument))).toBe(argument);
    }
  });

  it("writes today as the command rather than a date", () => {
    // Writing out today's date would freeze it: the document would say the day
    // it was edited rather than the day it was compiled.
    expect(writeDate({ kind: "today" })).toBe("\\today");
  });
});

describe("formatDate", () => {
  it("writes the date the way the document's language does", () => {
    // A fixed date is printed verbatim by LaTeX, so the author has to be able
    // to see what their reader will see.
    expect(formatDate("2026-08-19", "english")).toContain("2026");
    expect(formatDate("2026-08-19", "ngerman")).toContain("2026");
    expect(formatDate("2026-08-19", "english")).not.toBe(
      formatDate("2026-08-19", "ngerman"),
    );
  });

  it("falls back to the plain form for a language it does not know", () => {
    expect(formatDate("2026-08-19", "esperanto")).toBe("2026-08-19");
    expect(formatDate("2026-08-19", "")).toBe("2026-08-19");
  });

  it("does not shift the day for where the author is sitting", () => {
    // Built as UTC. Parsed as local time, a date near midnight lands on the
    // day before in half the world.
    expect(formatDate("2026-01-01", "english")).toContain("2026");
    expect(formatDate("2026-01-01", "english")).toContain("1");
  });

  it("leaves something that is not a date alone", () => {
    expect(formatDate("Michaelmas", "english")).toBe("Michaelmas");
  });
});
