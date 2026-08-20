/**
 * Editing a document that lives in several files.
 *
 * The arithmetic is the whole risk. A segment map wrong by one puts a character
 * in the wrong chapter and nothing says so until the compile, so these check
 * the map itself rather than what it looks like on screen — including the
 * invariant every mapping relies on, that the map covers the buffer exactly
 * once with no gaps.
 *
 * The shapes come from a real thesis: a root that includes a title page, three
 * chapters one directory down, and a glossary pulled in from the preamble.
 */

import { describe, expect, it } from "vitest";

import {
  applyToFiles,
  filesIn,
  isWritable,
  locate,
  mapChanges,
  mapSegments,
  resolveInclude,
  stitch,
} from "./stitch";
import type { Change, Segment } from "./stitch";

/** A project, as a reader over a map. */
function project(files: Record<string, string>) {
  return (path: string) => files[path] ?? null;
}

const thesis = {
  "main.tex": [
    "\\documentclass{report}",
    "\\begin{document}",
    "\\include{sections/Vorbemerkungen}",
    "\\include{sections/Schluss}",
    "\\end{document}",
  ].join("\n"),
  "sections/Vorbemerkungen.tex": "Erstens.\n",
  "sections/Schluss.tex": "Zuletzt.\n",
};

describe("resolveInclude", () => {
  it("adds the extension LaTeX lets you leave off", () => {
    expect(resolveInclude("sections/Vorbemerkungen", "main.tex")).toBe(
      "sections/Vorbemerkungen.tex",
    );
  });

  it("keeps one that is already there", () => {
    expect(resolveInclude("sections/Basis/glossary.tex", "main.tex")).toBe(
      "sections/Basis/glossary.tex",
    );
  });

  it("resolves against the including file's folder", () => {
    // Which is what a chapter that includes a figure file relies on.
    expect(
      resolveInclude("figures/one", "sections/Kapitel/Arbeitspakete.tex"),
    ).toBe("sections/Kapitel/figures/one.tex");
  });

  it("collapses the dots a real project uses", () => {
    expect(resolveInclude("../shared/macros", "sections/Kapitel/ap.tex")).toBe(
      "sections/shared/macros.tex",
    );
  });
});

describe("stitch", () => {
  const stitched = stitch("main.tex", project(thesis));

  it("puts the included text where the command was", () => {
    expect(stitched.text).toBe(
      [
        "\\documentclass{report}",
        "\\begin{document}",
        "Erstens.",
        "",
        "Zuletzt.",
        "",
        "\\end{document}",
      ].join("\n"),
    );
  });

  it("leaves the plumbing out of the text", () => {
    // What is on screen is the document, not the document plus its commands.
    expect(stitched.text).not.toContain("\\include");
  });

  it("covers the buffer exactly once, with no gaps", () => {
    // The invariant every mapping below relies on. Asserted rather than
    // assumed, because a gap is a character that belongs to no file.
    let at = 0;
    for (const segment of stitched.segments) {
      expect(segment.from).toBe(at);
      at = segment.to;
    }
    expect(at).toBe(stitched.text.length);
  });

  it("names every file it drew from", () => {
    expect(filesIn(stitched.segments)).toEqual([
      "main.tex",
      "sections/Vorbemerkungen.tex",
      "sections/Schluss.tex",
    ]);
  });

  it("records where each seam sits", () => {
    const seam = stitched.seams.find((s) => s.file === "sections/Schluss.tex");
    expect(stitched.text.slice(seam!.from, seam!.to)).toBe("Zuletzt.\n");
  });

  it("follows an include inside an include", () => {
    const nested = stitch(
      "main.tex",
      project({
        "main.tex": "A\\include{one}Z",
        "one.tex": "B\\include{two}Y",
        "two.tex": "C",
      }),
    );
    expect(nested.text).toBe("ABCYZ");
    expect(filesIn(nested.segments)).toEqual([
      "main.tex",
      "one.tex",
      "two.tex",
    ]);
  });

  it("leaves a file it cannot read as its own line", () => {
    // A document that silently loses a chapter because a path was wrong is
    // worse than one that shows a line the author can see is wrong.
    const broken = stitch(
      "main.tex",
      project({ "main.tex": "before\n\\include{gone}\nafter" }),
    );
    expect(broken.text).toContain("\\include{gone}");
    expect(broken.missing).toEqual(["gone.tex"]);
  });

  it("does not expand a commented-out include", () => {
    // Commenting a chapter out is exactly how a chapter gets switched off.
    const commented = stitch(
      "main.tex",
      project({ "main.tex": "% \\include{one}\nrest", "one.tex": "PULLED" }),
    );
    expect(commented.text).not.toContain("PULLED");
  });

  it("breaks a cycle rather than hanging", () => {
    const looped = stitch(
      "main.tex",
      project({ "main.tex": "A\\include{one}", "one.tex": "B\\include{main}" }),
    );
    expect(looped.text).toBe("AB\\include{main}");
  });

  it("expands a file once, however often it is included", () => {
    // Two copies in the buffer would be two places to edit one file, and an
    // edit to either would leave the other stale with nothing saying so.
    const twice = stitch(
      "main.tex",
      project({
        "main.tex": "\\include{one}\n\\include{one}\n",
        "one.tex": "CHAPTER\n",
      }),
    );
    expect(twice.text.match(/CHAPTER/g)).toHaveLength(1);
    // And the second command stays visible, which is what it is.
    expect(twice.text).toContain("\\include{one}");
    expect(twice.missing).toEqual([]);
  });

  it("copes with a root that does not exist", () => {
    const nothing = stitch("gone.tex", project({}));
    expect(nothing.text).toBe("");
    expect(nothing.segments).toEqual([]);
  });
});

describe("locate", () => {
  const { text, segments } = stitch("main.tex", project(thesis));

  it("finds the file an offset belongs to", () => {
    const at = text.indexOf("Erstens");
    expect(locate(segments, at)).toEqual({
      file: "sections/Vorbemerkungen.tex",
      offset: 0,
    });
  });

  it("keeps the offset within that file", () => {
    const at = text.indexOf("Zuletzt") + 3;
    expect(locate(segments, at)).toEqual({
      file: "sections/Schluss.tex",
      offset: 3,
    });
  });

  it("gives a seam to the chapter that ends there", () => {
    // Typing at the end of a chapter continues that chapter, which is what the
    // caret's position means to the person who put it there.
    const endOfFirst = text.indexOf("Erstens") + "Erstens.\n".length;
    expect(locate(segments, endOfFirst)?.file).toBe(
      "sections/Vorbemerkungen.tex",
    );
  });

  it("has nothing to say about an offset past the end", () => {
    expect(locate(segments, text.length + 5)).toBeNull();
  });
});

describe("mapChanges", () => {
  const { text, segments } = stitch("main.tex", project(thesis));

  /** A change at the position of some text in the buffer. */
  const at = (needle: string, insert: string, length = 0): Change => ({
    from: text.indexOf(needle),
    to: text.indexOf(needle) + length,
    insert,
  });

  it("sends an edit to the file it belongs to", () => {
    const mapped = mapChanges(segments, [at("Erstens", "Zu ")]);
    expect("byFile" in mapped).toBe(true);
    if (!("byFile" in mapped)) return;
    expect([...mapped.byFile.keys()]).toEqual(["sections/Vorbemerkungen.tex"]);
    expect(mapped.byFile.get("sections/Vorbemerkungen.tex")).toEqual([
      { from: 0, to: 0, insert: "Zu " },
    ]);
  });

  it("edits the root when the edit is in the root", () => {
    const mapped = mapChanges(segments, [at("\\documentclass", "% ")]);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");
    expect([...mapped.byFile.keys()]).toEqual(["main.tex"]);
  });

  it("refuses an edit that spans a seam", () => {
    // The replacement belongs to one file or the other and nothing says which.
    // Refusing is a message; guessing is a corrupted chapter.
    const across: Change = {
      from: text.indexOf("Erstens") + 2,
      to: text.indexOf("Zuletzt") + 2,
      insert: "x",
    };
    const mapped = mapChanges(segments, [across]);
    expect("refused" in mapped).toBe(true);
    if (!("refused" in mapped)) return;
    expect(mapped.refused[0]?.reason).toBe("spans-a-seam");
  });

  it("groups several edits by file", () => {
    const mapped = mapChanges(segments, [
      at("Erstens", "A"),
      at("Zuletzt", "B"),
      at("\\documentclass", "C"),
    ]);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");
    expect([...mapped.byFile.keys()].sort()).toEqual([
      "main.tex",
      "sections/Schluss.tex",
      "sections/Vorbemerkungen.tex",
    ]);
  });
});

describe("applyToFiles", () => {
  it("writes each edit into its own file", () => {
    const { text, segments } = stitch("main.tex", project(thesis));
    const mapped = mapChanges(segments, [
      {
        from: text.indexOf("Erstens"),
        to: text.indexOf("Erstens"),
        insert: "Zu ",
      },
    ]);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");

    const after = applyToFiles(new Map(Object.entries(thesis)), mapped);
    expect(after.get("sections/Vorbemerkungen.tex")).toBe("Zu Erstens.\n");
    // And leaves the others exactly as they were.
    expect(after.get("main.tex")).toBe(thesis["main.tex"]);
    expect(after.get("sections/Schluss.tex")).toBe(
      thesis["sections/Schluss.tex"],
    );
  });

  it("applies several edits to one file without moving each other", () => {
    const files = new Map([["a.tex", "one two three"]]);
    const mapped = {
      byFile: new Map([
        [
          "a.tex",
          [
            { from: 0, to: 3, insert: "ONE" },
            { from: 8, to: 13, insert: "THREE" },
          ],
        ],
      ]),
    };
    expect(applyToFiles(files, mapped).get("a.tex")).toBe("ONE two THREE");
  });
});

describe("mapSegments", () => {
  const { text, segments } = stitch("main.tex", project(thesis));

  /** Where a needle sits in the stitched buffer. */
  const at = (needle: string) => text.indexOf(needle);

  /** Re-derive the map by stitching the edited files, which is the truth. */
  function byRestitching(changes: Change[]) {
    const mapped = mapChanges(segments, changes);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");
    const written = applyToFiles(new Map(Object.entries(thesis)), mapped);
    return stitch("main.tex", (path) => written.get(path) ?? null);
  }

  /** What the map is for: which file each offset belongs to, and where. */
  const asLocations = (map: readonly Segment[] | null) =>
    (map ?? [])
      .filter((segment) => segment.to > segment.from)
      .map(
        (segment) =>
          `${segment.file}:${segment.from}-${segment.to}@${segment.fileFrom}`,
      );

  it("agrees with re-stitching after an edit in a chapter", () => {
    // The property that makes moving the map cheaper than rebuilding it safe.
    const changes: Change[] = [
      { from: at("Erstens"), to: at("Erstens"), insert: "Zuerst und " },
    ];
    expect(asLocations(mapSegments(segments, changes))).toEqual(
      asLocations(byRestitching(changes).segments),
    );
  });

  it("agrees with re-stitching after an edit in the root", () => {
    // The case the two shifts exist for: text added to main.tex before the
    // includes moves the root's later segment within main.tex, and moves the
    // chapters only in the buffer.
    const changes: Change[] = [
      {
        from: at("\\begin{document}"),
        to: at("\\begin{document}"),
        insert: "\\usepackage{amsmath}\n",
      },
    ];
    expect(asLocations(mapSegments(segments, changes))).toEqual(
      asLocations(byRestitching(changes).segments),
    );
  });

  it("agrees with re-stitching after edits in several files at once", () => {
    const changes: Change[] = [
      { from: at("\\documentclass"), to: at("\\documentclass"), insert: "% " },
      { from: at("Erstens"), to: at("Erstens") + 7, insert: "Als Erstes" },
      { from: at("Zuletzt"), to: at("Zuletzt"), insert: "Und " },
    ];
    expect(asLocations(mapSegments(segments, changes))).toEqual(
      asLocations(byRestitching(changes).segments),
    );
  });

  it("keeps the map total", () => {
    const moved = mapSegments(segments, [
      { from: at("Zuletzt"), to: at("Zuletzt") + 8, insert: "" },
    ]);
    let cursor = 0;
    for (const segment of moved ?? []) {
      expect(segment.from).toBe(cursor);
      cursor = segment.to;
    }
    expect(cursor).toBe(text.length - 8);
  });

  it("keeps an emptied chapter as somewhere to type", () => {
    // Deleting a chapter's text does not delete the chapter, and the author who
    // just cleared it is very likely about to write it again.
    const length = "Erstens.\n".length;
    const moved = mapSegments(segments, [
      { from: at("Erstens"), to: at("Erstens") + length, insert: "" },
    ]);
    const emptied = moved?.find(
      (s) => s.file === "sections/Vorbemerkungen.tex",
    );
    expect(emptied).toBeDefined();
    expect(emptied?.to).toBe(emptied?.from);
  });

  it("refuses to move a map through an edit that spans a seam", () => {
    expect(
      mapSegments(segments, [
        { from: at("Erstens") + 2, to: at("Zuletzt") + 2, insert: "x" },
      ]),
    ).toBeNull();
  });
});

describe("isWritable", () => {
  const { text, segments } = stitch("main.tex", project(thesis));

  it("is what the editor asks before letting an edit through", () => {
    const inside = text.indexOf("Erstens");
    expect(
      isWritable(segments, { from: inside, to: inside, insert: "x" }),
    ).toBe(true);
    expect(
      isWritable(segments, {
        from: inside + 2,
        to: text.indexOf("Zuletzt") + 2,
        insert: "x",
      }),
    ).toBe(false);
  });
});

describe("the round trip", () => {
  it("re-stitches to what the buffer already said", () => {
    // The property that makes the whole thing trustworthy: editing the buffer,
    // writing the files, and stitching them again gives the buffer back.
    const files = { ...thesis };
    const first = stitch("main.tex", project(files));

    const insertAt = first.text.indexOf("Zuletzt");
    const change: Change = { from: insertAt, to: insertAt, insert: "Und " };
    const mapped = mapChanges(first.segments, [change]);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");

    const written = applyToFiles(new Map(Object.entries(files)), mapped);
    const again = stitch("main.tex", (path) => written.get(path) ?? null);

    const expected =
      first.text.slice(0, insertAt) + "Und " + first.text.slice(insertAt);
    expect(again.text).toBe(expected);
  });

  it("keeps the segment map total after an edit", () => {
    const files = { ...thesis };
    const first = stitch("main.tex", project(files));
    const insertAt = first.text.indexOf("Erstens");
    const mapped = mapChanges(first.segments, [
      { from: insertAt, to: insertAt, insert: "Sehr viel mehr Text\n" },
    ]);
    if (!("byFile" in mapped)) throw new Error("expected a mapping");

    const written = applyToFiles(new Map(Object.entries(files)), mapped);
    const again = stitch("main.tex", (path) => written.get(path) ?? null);

    let at = 0;
    for (const segment of again.segments as Segment[]) {
      expect(segment.from).toBe(at);
      at = segment.to;
    }
    expect(at).toBe(again.text.length);
  });
});
