/**
 * Which format a file is, and whether its support is on.
 *
 * The loaders are not exercised here — they are dynamic imports, and what
 * matters about them is that they *are* dynamic, which a test cannot assert
 * without asserting how the bundler works. What is checked is the part that
 * decides: the extension, and the two formats that can never be switched off.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  FORMATS,
  optionalFormats,
  format,
  formatOf,
  isEnabled,
  setContributedFormats,
} from "./registry";

/** A format as a plugin would contribute it. */
const contribution = (id: string, extensions: string[]) => ({
  id,
  extensions,
  labelKey: `format-${id}`,
  load: async () => ({}) as never,
});

afterEach(() => setContributedFormats([]));

describe("formatOf", () => {
  it("knows the two the application itself has", () => {
    // Two, and only two: LaTeX is what the application is for, and plain text
    // is the floor that makes every file openable. Everything else arrives
    // from a plugin (ADR-0021).
    expect(formatOf("main.tex")).toBe("latex");
    expect(formatOf("LICENSE")).toBe("text");
  });

  it("knows a format a plugin contributed", () => {
    setContributedFormats([contribution("markdown", ["md"])]);
    expect(formatOf("README.md")).toBe("markdown");
  });

  it("forgets it again when the plugin is gone", () => {
    setContributedFormats([contribution("markdown", ["md"])]);
    setContributedFormats([]);
    // Plain text rather than an error: a file whose plugin was switched off
    // still opens, which is the floor the whole design rests on.
    expect(formatOf("README.md")).toBe("text");
  });

  it("does not let a plugin take an extension the application owns", () => {
    // A plugin claiming `.tex` would take LaTeX away from a LaTeX editor, and
    // whether it succeeded would depend on load order.
    setContributedFormats([contribution("mine", ["tex"])]);
    expect(formatOf("main.tex")).toBe("latex");
  });

  it("does not care about case", () => {
    expect(formatOf("Main.TEX")).toBe("latex");
  });

  it("reads the last extension", () => {
    // `main.tex.bak` is a backup, not a LaTeX file, and highlighting it as one
    // would be a guess about what someone meant by renaming it.
    expect(formatOf("main.tex.bak")).toBe("text");
  });

  it("falls back to plain text, never to nothing", () => {
    // The floor: every text file opens, whatever it is.
    expect(formatOf("LICENSE")).toBe("text");
    expect(formatOf("notes.xyz")).toBe("text");
    expect(formatOf("")).toBe("text");
  });

  it("takes a path, not just a name", () => {
    expect(formatOf("sections/Kapitel/Arbeitspakete.tex")).toBe("latex");
  });
});

describe("isEnabled", () => {
  it("is on for a format nobody has said anything about", () => {
    // Absent means on, so a format added in a later version arrives on for
    // someone who has already been here.
    expect(isEnabled("markdown", {})).toBe(true);
  });

  it("is off when it has been switched off", () => {
    expect(isEnabled("yaml", { yaml: false })).toBe(false);
  });

  it("is always on for LaTeX and plain text", () => {
    // One is what the application is for; the other is the floor that makes
    // every file openable. A setting for either would be a setting nobody
    // should touch.
    expect(isEnabled("latex", { latex: false })).toBe(true);
    expect(isEnabled("text", { text: false })).toBe(true);
  });
});

describe("the registry", () => {
  it("offers nothing to switch off until a plugin contributes one", () => {
    expect(optionalFormats()).toEqual([]);
  });

  it("offers a contributed format, and never the two built-in ones", () => {
    setContributedFormats([contribution("markdown", ["md"])]);
    expect(optionalFormats().map((entry) => entry.id)).toEqual(["markdown"]);
  });

  it("gives plain text no language to load", () => {
    expect(format("text").load).toBeNull();
  });

  it("claims no extension twice", () => {
    // Two formats claiming `.md` would make which one wins depend on the order
    // of a list, which is not a thing anyone should have to know.
    const seen = FORMATS.flatMap((entry) => entry.extensions);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
