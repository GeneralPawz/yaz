/**
 * Counting the words that will be printed.
 *
 * Every case here is a way the naive count — split the file on whitespace — is
 * wrong, and wrong in the flattering direction, which is the worst kind for
 * someone writing to a limit.
 */

import { describe, expect, it } from "vitest";

import { countWords, prose } from "./wordCount";

describe("countWords", () => {
  it("counts the words in the body", () => {
    expect(
      countWords("\\begin{document}\nOne two three.\n\\end{document}"),
    ).toBe(3);
  });

  it("does not count the preamble", () => {
    // `\usepackage[utf8]{inputenc}` is configuration, and counting it makes a
    // paper look longer than the part anyone reads.
    const text = [
      "\\documentclass{article}",
      "\\usepackage[utf8]{inputenc}",
      "\\title{A Rather Long Title Nobody Counts}",
      "\\begin{document}",
      "One two three.",
      "\\end{document}",
    ].join("\n");
    expect(countWords(text)).toBe(3);
  });

  it("does not count comments", () => {
    expect(
      countWords(
        "\\begin{document}\nOne two % three four five\n\\end{document}",
      ),
    ).toBe(2);
  });

  it("counts the words a formatting command wraps", () => {
    // `\textbf{loud}` is one word, not none and not two.
    expect(
      countWords(
        "\\begin{document}\n\\textbf{loud} and clear\n\\end{document}",
      ),
    ).toBe(3);
  });

  it("does not count a label or a citation key", () => {
    // A key is a name nobody reads, and how long a citation prints cannot be
    // known from the source.
    expect(
      countWords(
        "\\begin{document}\nA claim \\cite{smith2020}\\label{c:1}\n\\end{document}",
      ),
    ).toBe(2);
  });

  it("does not count mathematics", () => {
    const text = [
      "\\begin{document}",
      "Before $x^2 + y^2 = z^2$ after.",
      "\\begin{equation}",
      "  \\int_0^\\infty e^{-x} dx = 1",
      "\\end{equation}",
      "\\end{document}",
    ].join("\n");
    expect(countWords(text)).toBe(2);
  });

  it("does not count a table's contents", () => {
    const text = [
      "\\begin{document}",
      "Results follow.",
      "\\begin{tabular}{ll}",
      "Alpha & Beta \\\\",
      "\\end{tabular}",
      "\\end{document}",
    ].join("\n");
    expect(countWords(text)).toBe(2);
  });

  it("counts a fragment with no preamble as all body", () => {
    // An `\input`-ed chapter is the file people most often have open, and
    // counting nothing for it would be the wrong answer to the question asked.
    expect(countWords("Just three words")).toBe(3);
  });

  it("keeps an escaped character inside its word", () => {
    // `50\% faster` is two words.
    expect(countWords("\\begin{document}\n50\\% faster\n\\end{document}")).toBe(
      2,
    );
  });

  it("separates words a command stood between", () => {
    // Without this, `one\emph{two}` counts as one word.
    expect(
      prose("\\begin{document}\none\\emph{two}\n\\end{document}")
        .split(/\s+/)
        .filter(Boolean),
    ).toHaveLength(2);
  });
});
