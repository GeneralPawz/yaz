/**
 * The parts of a document LaTeX generates.
 *
 * The fixtures are the shapes a real thesis uses — `\newglossaryentry` with
 * fields across several lines, captions with and without a short form,
 * `\addcontentsline` before every list — because those are what a regex written
 * against a one-line example gets wrong.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captionEntries,
  contentsEntries,
  entriesFor,
  generatedIn,
  glossaryEntries,
  hasGenerated,
  listings,
  machinery,
  pageBreaks,
} from "./generated";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

/** The body of the real project's main.tex, in miniature. */
const body = [
  `${B}begin{document}`,
  `${B}tableofcontents`,
  `${B}cleardoublepage`,
  `${B}addcontentsline{toc}{chapter}{Glossar}`,
  `${B}printglossaries`,
  `${B}cleardoublepage`,
  `${B}chapter{Vorbemerkungen}`,
  `${B}section{Anlass}`,
  `${B}printbibliography`,
  `${B}listoffigures`,
  `${B}listoftables`,
  `${B}glsaddall`,
  `${B}end{document}`,
].join("\n");

/**
 * Install the packages, the way a running yaz gets them.
 *
 * The real plugin's table rather than a fixture, so what these exercise is
 * what a user has — and so a command moving between core and plugin is caught
 * here rather than in the application.
 */
function withPackages(): void {
  setContributions([
    {
      pluginId: "com.yaz.latex-packages",
      commands: PACKAGE_COMMANDS,
      environments: PACKAGE_ENVIRONMENTS,
    },
  ]);
}

beforeEach(withPackages);
afterEach(() => setContributions([]));

describe("listings", () => {
  it("finds each generated list, and says which it is", () => {
    expect(listings(body).map((listing) => listing.kind)).toEqual([
      "contents",
      "glossary",
      "bibliography",
      "figures",
      "tables",
    ]);
  });

  it("covers the command and nothing else", () => {
    const [contents] = listings(body);
    expect(body.slice(contents!.from, contents!.to)).toBe(
      `${B}tableofcontents`,
    );
  });

  it("takes an option with it", () => {
    // `\printbibliography[heading=bibintoc]` is one construct, and leaving the
    // option behind would draw the list and then show `[heading=bibintoc]`.
    const source = `${B}printbibliography[heading=bibintoc]`;
    const [found] = listings(source);
    expect(source.slice(found!.from, found!.to)).toBe(source);
  });

  it("takes the file name of the old bibliography command", () => {
    const source = `${B}bibliography{refs}`;
    const [found] = listings(source);
    expect(source.slice(found!.from, found!.to)).toBe(source);
  });

  it("is not fooled by a longer command that starts the same way", () => {
    // `\printglossaries` must not be read as `\printglossary` plus stray text.
    expect(listings(`${B}printglossaries`)).toHaveLength(1);
    expect(listings(`${B}tableofcontentsly`)).toEqual([]);
  });

  it("ignores a commented-out one", () => {
    expect(listings(`% ${B}tableofcontents`)).toEqual([]);
  });
});

describe("pageBreaks", () => {
  it("finds each kind", () => {
    const source = [
      `${B}clearpage`,
      `${B}cleardoublepage`,
      `${B}newpage`,
      `${B}pagebreak`,
    ].join("\n");
    expect(pageBreaks(source).map((found) => found.kind)).toEqual([
      "clearpage",
      "cleardoublepage",
      "newpage",
      "pagebreak",
    ]);
  });

  it("does not read cleardoublepage as clearpage", () => {
    // Which would leave `doublepage` sitting in the text as a word.
    const [found] = pageBreaks(`${B}cleardoublepage`);
    expect(found?.kind).toBe("cleardoublepage");
    expect(found?.to).toBe(`${B}cleardoublepage`.length);
  });
});

describe("machinery", () => {
  it("covers a whole addcontentsline, arguments and all", () => {
    const source = `${B}addcontentsline{toc}{chapter}{Glossar}`;
    const [found] = machinery(source);
    expect(source.slice(found!.from, found!.to)).toBe(source);
  });

  it("finds the commands that only arrange for something", () => {
    expect(machinery(`${B}makeglossaries ${B}glsaddall`)).toHaveLength(2);
  });

  it("leaves alone a command that says something", () => {
    expect(machinery(`${B}chapter{Vorbemerkungen}`)).toEqual([]);
  });
});

describe("generatedIn", () => {
  it("finds all three in one walk", () => {
    const found = generatedIn(body);
    expect(found.listings).toHaveLength(5);
    expect(found.breaks).toHaveLength(2);
    expect(found.machinery).toHaveLength(2);
  });
});

describe("contentsEntries", () => {
  it("lists the headings, with their depth", () => {
    expect(
      contentsEntries(body).map(({ label, level }) => ({ label, level })),
    ).toEqual([
      { label: "Vorbemerkungen", level: 1 },
      { label: "Anlass", level: 2 },
    ]);
  });

  it("points at the heading, so the line can be clicked", () => {
    const [chapter] = contentsEntries(body);
    expect(body.slice(chapter!.at, chapter!.at + 14)).toBe("Vorbemerkungen");
  });

  it("stops where a contents list stops", () => {
    // Down to `\section`, as `report` does. Deeper turns one page into six.
    const deep = `${B}subsubsection{Zu tief}`;
    expect(contentsEntries(deep)).toEqual([]);
  });

  it("shows the words rather than the markup", () => {
    expect(
      contentsEntries(`${B}section{Der ${B}emph{gute} Teil}`)[0]?.label,
    ).toBe("Der gute Teil");
  });

  it("has nothing to list in a file that is only includes", () => {
    // Which is exactly what a `main.tex` is, and the reason the joined mode
    // makes a difference here rather than merely being tidier.
    expect(contentsEntries(body.split("chapter")[0]!)).toEqual([]);
  });
});

describe("captionEntries", () => {
  const figure = [
    `${B}begin{figure}[H]`,
    `  ${B}includegraphics{diagram}`,
    `  ${B}caption{Interaktion der Arbeitspakete}`,
    `${B}end{figure}`,
  ].join("\n");

  it("lists a figure by its caption", () => {
    expect(captionEntries(figure, "figures").map((e) => e.label)).toEqual([
      "Interaktion der Arbeitspakete",
    ]);
  });

  it("prefers the short form, which is what LaTeX lists", () => {
    const source = [
      `${B}begin{figure}`,
      `${B}caption[Kurz]{Sehr viel längere Bildunterschrift}`,
      `${B}end{figure}`,
    ].join("\n");
    expect(captionEntries(source, "figures")[0]?.label).toBe("Kurz");
  });

  it("keeps figures and tables apart", () => {
    expect(captionEntries(figure, "tables")).toEqual([]);
  });

  it("points at the caption, so the line can be clicked", () => {
    const [entry] = captionEntries(figure, "figures");
    expect(figure.slice(entry!.at, entry!.at + 11)).toBe("Interaktion");
  });

  it("skips a figure with no caption", () => {
    expect(
      captionEntries(
        `${B}begin{figure}${B}includegraphics{x}${B}end{figure}`,
        "figures",
      ),
    ).toEqual([]);
  });
});

describe("glossaryEntries", () => {
  const glossary = [
    `${B}newglossaryentry{BIM}{`,
    `  name={BIM},`,
    `  description={${B}textit{Building Information Modeling} – eine Methode},`,
    `  plural={BIM-Modelle}`,
    `}`,
    ``,
    `${B}newacronym{LOI}{LOI}{Level of Information}`,
  ].join("\n");

  it("reads a name and description spread over lines", () => {
    const [entry] = glossaryEntries(glossary);
    expect(entry?.label).toBe("BIM");
    expect(entry?.detail).toBe("Building Information Modeling – eine Methode");
  });

  it("reads the acronym shorthand as the same kind of entry", () => {
    const acronym = glossaryEntries(glossary)[1];
    expect(acronym?.label).toBe("LOI");
    expect(acronym?.detail).toBe("Level of Information");
  });

  it("falls back to the key when there is no name", () => {
    // An entry with no `name` still appears in the glossary, under its key.
    expect(
      glossaryEntries(`${B}newglossaryentry{IDS}{description={Ein Format}}`)[0]
        ?.label,
    ).toBe("IDS");
  });

  it("does not mistake another field for the name", () => {
    const source = `${B}newglossaryentry{X}{firstplural={Nein}, name={Ja}}`;
    expect(glossaryEntries(source)[0]?.label).toBe("Ja");
  });
});

describe("entriesFor", () => {
  it("has nothing to draw for a bibliography, which is not in the buffer", () => {
    // Said rather than guessed: the entries live in a `.bib` and the numbering
    // comes from biber, neither of which the buffer knows.
    expect(entriesFor("bibliography", body)).toEqual([]);
    expect(entriesFor("index", body)).toEqual([]);
  });

  it("routes each kind to what it is built from", () => {
    expect(entriesFor("contents", body)).toHaveLength(2);
    expect(entriesFor("glossary", body)).toEqual([]);
  });
});

describe("hasGenerated", () => {
  it("is asked of any text with a command in it", () => {
    // It used to be a list of substrings, on the reasoning that most
    // documents have no generated lists and should not pay for a scan. That
    // stopped being true when this walk grew to cover the everyday commands
    // — ellipses, dates, definitions, notes — which nearly every document
    // has.
    //
    // The old shape had a worse failure than a wasted scan: a command the
    // list had not been updated for was never drawn, silently, and only in
    // documents that had nothing else from the list.
    expect(hasGenerated("Just prose, and a \\emph{little} markup.")).toBe(true);
    expect(hasGenerated("Prose with no commands at all.")).toBe(false);
    expect(hasGenerated(body)).toBe(true);
  });
});
