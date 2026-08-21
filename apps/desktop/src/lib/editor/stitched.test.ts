/**
 * Stitched mode inside CodeMirror.
 *
 * These drive `EditorState` rather than a view: the field and the filter are
 * where an edit is judged, and both work on state alone. What is asserted is
 * the thing that would corrupt a chapter if it were wrong — that the map still
 * describes the buffer after arbitrary typing, and that an edit with no single
 * destination never applies at all.
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { locate, stitch } from "./stitch";
import type { Segment } from "./stitch";
import { refuseAcrossSeams, segments, setSegments } from "./stitched";
import { linksIn } from "./includeLinks";

const B = String.fromCharCode(92);

const thesis: Record<string, string> = {
  "main.tex": `${B}documentclass{report}\n${B}begin{document}\n${B}include{sections/eins}\n${B}include{sections/zwei}\n${B}end{document}\n`,
  "sections/eins.tex": "Erstens.\n",
  "sections/zwei.tex": "Zweitens.\n",
};

/** An editor holding the stitched document, with the map installed. */
function editor(onRefused: () => void = () => {}) {
  const { text, segments: map } = stitch(
    "main.tex",
    (path) => thesis[path] ?? null,
  );
  const state = EditorState.create({
    doc: text,
    extensions: [segments, refuseAcrossSeams(onRefused)],
  });
  return {
    state: state.update({ effects: setSegments.of(map) }).state,
    text,
  };
}

/** Where a needle is in the buffer. */
const at = (text: string, needle: string) => text.indexOf(needle);

describe("the segment field", () => {
  it("takes the map it is handed", () => {
    const { state } = editor();
    expect(state.field(segments).length).toBeGreaterThan(0);
  });

  it("is empty until then, which is what single-file mode is", () => {
    const plain = EditorState.create({
      doc: "no map here",
      extensions: [segments],
    });
    expect(plain.field(segments)).toEqual([]);
  });

  it("moves the map through an edit", () => {
    const { state, text } = editor();
    const where = at(text, "Zweitens");
    const after = state.update({
      changes: { from: where, to: where, insert: "Und " },
    }).state;

    // The chapter still holds its own text, at the offset it has in its file.
    const found = locate(after.field(segments), where + 4);
    expect(found).toEqual({ file: "sections/zwei.tex", offset: 4 });
  });

  it("keeps the map total however much is typed", () => {
    // Typing is not one edit; it is hundreds, each moving the map again. The
    // invariant has to survive all of them and not merely the first.
    let { state, text } = editor();
    const where = at(text, "Erstens");

    for (let i = 0; i < 200; i += 1) {
      state = state.update({
        changes: { from: where + i, to: where + i, insert: "x" },
      }).state;
    }

    let cursor = 0;
    for (const segment of state.field(segments) as Segment[]) {
      expect(segment.from).toBe(cursor);
      cursor = segment.to;
    }
    expect(cursor).toBe(state.doc.length);
  });

  it("still points into the right file after an edit above it", () => {
    // The failure this exists to catch: text added to the preamble shifts every
    // chapter in the buffer but nothing at all inside those chapters' files.
    const { state, text } = editor();
    const preamble = at(text, `${B}begin{document}`);
    const insert = `${B}usepackage{amsmath}\n`;
    const after = state.update({
      changes: { from: preamble, to: preamble, insert },
    }).state;

    const zwei = at(text, "Zweitens") + insert.length;
    expect(locate(after.field(segments), zwei)).toEqual({
      file: "sections/zwei.tex",
      offset: 0,
    });
  });
});

describe("refusing an edit that spans a seam", () => {
  it("lets an ordinary edit through", () => {
    const { state, text } = editor();
    const where = at(text, "Erstens");
    const after = state.update({
      changes: { from: where, to: where, insert: "Zu " },
    }).state;
    expect(after.doc.toString()).toContain("Zu Erstens");
  });

  it("drops one that crosses from one chapter into the next", () => {
    let refusals = 0;
    const { state, text } = editor(() => {
      refusals += 1;
    });

    const after = state.update({
      changes: {
        from: at(text, "Erstens") + 2,
        to: at(text, "Zweitens") + 2,
        insert: "x",
      },
    }).state;

    // Nothing happened, which is the point: no half-written chapter to undo.
    expect(after.doc.toString()).toBe(text);
    expect(refusals).toBe(1);
  });

  it("lets the map itself be replaced", () => {
    // The transaction that installs a map replaces the whole document and so
    // spans every seam there is. It is the map, not an edit against it.
    const { state } = editor();
    const after = state.update({
      changes: { from: 0, to: state.doc.length, insert: "something else" },
      effects: setSegments.of([]),
    }).state;
    expect(after.doc.toString()).toBe("something else");
  });

  it("refuses nothing when there is no map", () => {
    const plain = EditorState.create({
      doc: "one file, as always",
      extensions: [segments, refuseAcrossSeams(() => expect.fail("refused"))],
    });
    expect(
      plain
        .update({ changes: { from: 0, to: 3, insert: "two" } })
        .state.doc.toString(),
    ).toBe("two file, as always");
  });
});

describe("include links", () => {
  it("finds the path and not the command", () => {
    const [link] = linksIn(`${B}include{sections/eins}`);
    expect(link).toEqual({ from: 9, to: 22, argument: "sections/eins" });
  });

  it("finds input and subfiles too", () => {
    expect(linksIn(`${B}input{macros}`)[0]?.argument).toBe("macros");
    expect(linksIn(`${B}subfile{chapters/one}`)[0]?.argument).toBe(
      "chapters/one",
    );
  });

  it("leaves a commented-out include alone", () => {
    // A commented include is switched off, and offering to open it invites the
    // click that puts a chapter back in.
    expect(linksIn(`% ${B}include{sections/eins}`)).toEqual([]);
  });

  it("is not fooled by an escaped percent", () => {
    expect(linksIn(`50${B}% ${B}include{sections/eins}`)).toHaveLength(1);
  });

  it("offsets against the stretch it was given", () => {
    // The scan runs over the visible ranges, so what it returns has to be in
    // the document's coordinates and not the slice's.
    const [link] = linksIn(`${B}include{one}`, 500);
    expect(link?.from).toBe(509);
  });

  it("ignores an empty argument", () => {
    expect(linksIn(`${B}include{}`)).toEqual([]);
  });

  it("finds one on each line", () => {
    const text = `${B}include{one}\nprose\n${B}include{two}\n`;
    expect(linksIn(text).map((link) => link.argument)).toEqual(["one", "two"]);
  });
});
