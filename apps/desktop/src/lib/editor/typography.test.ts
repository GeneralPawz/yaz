/**
 * Declarations, space, and the metadata a title page is made of.
 *
 * The fixtures come from a real title page, because that is where declarations
 * are dense enough for the rules to matter: six of its nine lines are `{\Large
 * ...}` or `\vspace{1cm}`, and getting the group wrong there styles a whole
 * page rather than a phrase.
 */

import { describe, expect, it } from "vitest";

import {
  declarations,
  lengthInEm,
  metadata,
  verticalSpaces,
} from "./typography";

const B = String.fromCharCode(92);

describe("declarations", () => {
  it("styles the group it opens", () => {
    const text = `{${B}Large Fakultät}`;
    const [found] = declarations(text);
    expect(found?.command).toBe("Large");
    expect(text.slice(found!.bodyFrom, found!.bodyTo)).toBe(
      `${B}Large Fakultät`,
    );
  });

  it("gives two declarations on one group the same group", () => {
    // `{\huge\bfseries \thetitle \par}` is how a title is set, and reading the
    // second as applying to nothing would leave the title unbold.
    const text = `{${B}huge${B}bfseries Titel}`;
    const found = declarations(text);
    expect(found.map((one) => one.command)).toEqual(["huge", "bfseries"]);
    expect(found[0]!.bodyFrom).toBe(found[1]!.bodyFrom);
    expect(found[0]!.bodyTo).toBe(found[1]!.bodyTo);
  });

  it("allows a space between the brace and the declaration", () => {
    expect(declarations(`{ ${B}Large Text}`)).toHaveLength(1);
  });

  it("styles nothing when it does not open a group", () => {
    // The deliberate failure: a declaration loose in the text would otherwise
    // have to be guessed at, and guessing styles half a chapter.
    expect(declarations(`Ein Satz ${B}Large und weiter`)).toEqual([]);
  });

  it("finds an alignment as well as a size", () => {
    const found = declarations(`{${B}centering Mitte}`);
    expect(found.map((one) => one.command)).toEqual(["centering"]);
  });

  it("ignores a commented-out declaration", () => {
    expect(declarations(`% {${B}Large Text}`)).toEqual([]);
  });

  it("does not read a longer command as a declaration", () => {
    // `\Largesse` is not `\Large`.
    expect(declarations(`{${B}Largesse Text}`)).toEqual([]);
  });
});

describe("lengthInEm", () => {
  it("reads the units a document uses", () => {
    expect(lengthInEm("1cm")).toBeCloseTo(2.4);
    expect(lengthInEm("0.5cm")).toBeCloseTo(1.2);
    expect(lengthInEm("12pt")).toBeCloseTo(1);
    expect(lengthInEm("2em")).toBeCloseTo(2);
  });

  it("treats a bare number as em, which is what TeX does not", () => {
    // A bare number is an error in LaTeX. Drawing it as em is the least
    // surprising reading of a mistake, and it never silently draws nothing.
    expect(lengthInEm("2")).toBeCloseTo(2);
  });

  it("has nothing to say about a length it cannot read", () => {
    expect(lengthInEm(`${B}textheight`)).toBeNull();
  });
});

describe("verticalSpaces", () => {
  it("measures a vspace", () => {
    const text = `${B}vspace{1.5cm}`;
    const [found] = verticalSpaces(text);
    expect(text.slice(found!.from, found!.to)).toBe(text);
    expect(found!.em).toBeCloseTo(3.6);
  });

  it("takes the starred form too", () => {
    expect(verticalSpaces(`${B}vspace*{1cm}`)).toHaveLength(1);
  });

  it("knows the fixed skips", () => {
    expect(verticalSpaces(`${B}bigskip`)[0]?.em).toBe(1);
    expect(verticalSpaces(`${B}smallskip`)[0]?.em).toBe(0.25);
  });

  it("leaves vfill open-ended, because that is what it is", () => {
    expect(verticalSpaces(`${B}vfill`)[0]?.em).toBeNull();
  });
});

describe("metadata", () => {
  const preamble = [
    `${B}title{Building Information Modeling}`,
    `${B}subtitle{Endbericht}`,
    `${B}author{Friedrich Schrödter}`,
    `${B}reviewer{Prof. Dr. Melzner}`,
    `${B}date{${B}today}`,
  ].join("\n");

  it("resolves what a title page actually writes", () => {
    // A title page writes `\thetitle`, never the title.
    const found = metadata(preamble);
    expect(found.get("thetitle")).toBe("Building Information Modeling");
    expect(found.get("thesubtitle")).toBe("Endbericht");
    expect(found.get("theauthor")).toBe("Friedrich Schrödter");
    expect(found.get("thereviewer")).toBe("Prof. Dr. Melzner");
  });

  it("has nothing for a command the document never defines", () => {
    expect(metadata(`${B}title{Nur ein Titel}`).has("thesubtitle")).toBe(false);
  });

  it("takes the last definition, which is the one in force", () => {
    expect(metadata(`${B}title{Erst}\n${B}title{Dann}`).get("thetitle")).toBe(
      "Dann",
    );
  });
});
