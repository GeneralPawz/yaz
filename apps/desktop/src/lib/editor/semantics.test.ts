/**
 * What the commands in a document mean.
 *
 * The fixtures are lifted from the thesis this was built against, because the
 * interesting cases are the ones a made-up example does not have: a `\label`
 * inside a figure rather than after a heading, a `\ref` to a section that has
 * been renumbered by a starred chapter above it, and `z.\,B.` — which is one
 * abbreviation and four characters of markup.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { headings, environments } from "./structure";
import {
  labelledMarker,
  listOptions,
  quotationMarks,
  sectionNumbers,
  semantics,
  silentCommands,
  spacings,
  targets,
  includedGraphics,
} from "./semantics";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

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

describe("semantics", () => {
  const text = [
    `${B}chapter{Vorbemerkungen}${B}label{ch:vor}`,
    `Wie ${B}gls{BIM} in ${B}ref{ch:vor} beschrieben ${B}parencite{meister2021}.`,
    `${B}enquote{Ein Zitat}`,
  ].join("\n");
  // Computed per test, not once for the block: the vocabulary is installed by
  // `beforeEach`, and a value built at describe time would be built against an
  // empty one.
  const sorted = () => semantics(text);

  it("sorts each command into what it is", () => {
    expect(sorted().labels.map((o) => o.key)).toEqual(["ch:vor"]);
    expect(sorted().references.map((o) => o.key)).toEqual(["ch:vor"]);
    expect(sorted().citations.map((o) => o.key)).toEqual(["meister2021"]);
    expect(sorted().glossary.map((o) => o.key)).toEqual(["BIM"]);
    expect(sorted().quotations.map((o) => o.key)).toEqual(["Ein Zitat"]);
  });

  it("keeps the whole command's range, for hiding it", () => {
    const [reference] = sorted().references;
    expect(text.slice(reference!.from, reference!.to)).toBe(`${B}ref{ch:vor}`);
  });

  it("keeps the argument's range, for showing it", () => {
    const [quotation] = sorted().quotations;
    expect(text.slice(quotation!.argFrom, quotation!.argTo)).toBe("Ein Zitat");
  });

  it("ignores a commented-out command", () => {
    expect(semantics(`% ${B}gls{BIM}`).glossary).toEqual([]);
  });

  it("does not read a longer command as a shorter one", () => {
    // `\glspl` is the plural, not `\gls` followed by `pl`.
    const plural = semantics(`${B}glspl{BIM}`);
    expect(plural.glossary.map((o) => o.command)).toEqual(["glspl"]);
  });
});

describe("sectionNumbers", () => {
  const document = [
    `${B}chapter{Eins}`,
    `${B}section{Eins Eins}`,
    `${B}subsection{Eins Eins Eins}`,
    `${B}section{Eins Zwei}`,
    `${B}chapter{Zwei}`,
    `${B}section{Zwei Eins}`,
  ].join("\n");

  it("counts the way LaTeX counts", () => {
    const found = headings(document);
    const numbers = sectionNumbers(found);
    expect(found.map((heading) => numbers.get(heading.from))).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
      "2",
      "2.1",
    ]);
  });

  it("gives a starred heading no number, and does not count it", () => {
    // Which is what the star means, and getting it wrong shifts every number
    // below it by one.
    const starred = headings(
      [
        `${B}chapter{Eins}`,
        `${B}chapter*{Ohne Nummer}`,
        `${B}chapter{Zwei}`,
      ].join("\n"),
    );
    const numbers = sectionNumbers(starred);
    expect(starred.map((heading) => numbers.get(heading.from))).toEqual([
      "1",
      undefined,
      "2",
    ]);
  });

  it("leaves \\paragraph unnumbered, as the standard classes do", () => {
    const deep = headings(`${B}chapter{Eins}\n${B}paragraph{Ein Absatz}`);
    expect(sectionNumbers(deep).get(deep[1]!.from)).toBeUndefined();
  });
});

describe("targets", () => {
  const text = [
    `${B}chapter{Grundlagen}`,
    `${B}label{ch:grund}`,
    `${B}section{Methodik}${B}label{sec:meth}`,
    `${B}begin{figure}`,
    `  ${B}includegraphics{ablauf}`,
    `  ${B}caption{Flussdiagramm des Gesamtablaufs}`,
    `  ${B}label{fig:ablauf}`,
    `${B}end{figure}`,
  ].join("\n");

  const found = semantics(text);
  const map = targets(
    text,
    headings(text),
    found.labels,
    environments(text, ["figure", "table", "longtable"]),
    found.captions,
  );

  it("gives a section label the section's number and title", () => {
    expect(map.get("sec:meth")).toMatchObject({
      number: "1.1",
      title: "Methodik",
      kind: "heading",
    });
  });

  it("gives a figure label the figure's number and caption", () => {
    // Numbered within the chapter, which is what `report` does — and the
    // caption is what a reader wants to see, not the label's key.
    expect(map.get("fig:ablauf")).toMatchObject({
      number: "1.1",
      title: "Flussdiagramm des Gesamtablaufs",
      kind: "figure",
    });
  });

  it("points a section label at its heading", () => {
    const target = map.get("ch:grund");
    expect(text.slice(target!.at, target!.at + 10)).toBe("Grundlagen");
  });

  it("points a figure label at its caption", () => {
    const target = map.get("fig:ablauf");
    expect(text.slice(target!.at, target!.at + 13)).toBe("Flussdiagramm");
  });
});

describe("spacings", () => {
  it("draws a thin space where the markup is", () => {
    // `z.\,B.` is one abbreviation and four characters of markup.
    const text = `z.${B},B.`;
    const [space] = spacings(text);
    expect(text.slice(space!.from, space!.to)).toBe(`${B},`);
    expect(space!.character).toBe(" ");
  });

  it("draws a tie as a space that will not break", () => {
    const [tie] = spacings("Abschnitt~3.5");
    expect(tie?.character).toBe(" ");
  });

  it("leaves an escaped character alone", () => {
    // `\%` is a per cent sign and `\&` an ampersand; neither is a space.
    expect(spacings(`50${B}% davon`)).toEqual([]);
    expect(spacings(`Soll ${B}& Haben`)).toEqual([]);
  });

  it("is not fooled by a line break into reading the next character", () => {
    // `\\` is a break; the `,` after it is a comma, not a thin space.
    expect(spacings(`Zeile${B}${B},`)).toEqual([]);
  });

  it("skips a comment", () => {
    expect(spacings(`% z.${B},B.`)).toEqual([]);
  });
});

describe("listOptions", () => {
  const at = (source: string) => listOptions(source, source.indexOf("}") + 1);

  it("finds the option a real document sets", () => {
    // `[nosep]` appears 36 times in the thesis, and every one of them is a
    // layout instruction rather than something to read.
    const source = `${B}begin{itemize}[nosep]`;
    const options = at(source);
    expect(source.slice(options!.from, options!.to)).toBe("[nosep]");
    expect(options?.label).toBeNull();
  });

  it("reads a marker the list sets for itself", () => {
    const options = at(
      `${B}begin{enumerate}[label=${B}alph*), nosep, start=5]`,
    );
    expect(options?.label).toBe(`${B}alph*)`);
    expect(options?.start).toBe(5);
  });

  it("is absent when the list takes no options", () => {
    expect(at(`${B}begin{itemize}`)).toBeNull();
  });
});

describe("labelledMarker", () => {
  it("puts the counter where the star is, and keeps the rest", () => {
    expect(labelledMarker(`${B}alph*)`, 1)).toBe("a)");
    expect(labelledMarker(`${B}alph*)`, 3)).toBe("c)");
  });

  it("counts from where the list says it starts", () => {
    expect(labelledMarker(`${B}alph*)`, 5)).toBe("e)");
  });

  it("handles the other counters", () => {
    expect(labelledMarker(`(${B}roman*)`, 4)).toBe("(iv)");
    expect(labelledMarker(`${B}Alph*.`, 2)).toBe("B.");
  });

  it("has nothing to say about a literal marker", () => {
    expect(labelledMarker("--", 1)).toBeNull();
  });
});

describe("quotationMarks", () => {
  it("takes the language from the document", () => {
    // A German document quotes „like this“ and an English one “like this”, and
    // csquotes gets that from babel — so the editor should too.
    expect(quotationMarks(`${B}usepackage[ngerman]{babel}`)).toEqual({
      open: "„",
      close: "“",
    });
  });

  it("falls back to English", () => {
    expect(quotationMarks(`${B}documentclass{article}`).open).toBe("“");
  });
});

describe("silentCommands", () => {
  it("finds what changes the setting rather than the text", () => {
    const text = `${B}noindent Ein Absatz. ${B}FloatBarrier`;
    expect(silentCommands(text).map((s) => s.command)).toEqual([
      "noindent",
      "FloatBarrier",
    ]);
  });

  it("covers the command and not what follows it", () => {
    const text = `${B}noindent Text`;
    const [found] = silentCommands(text);
    expect(text.slice(found!.from, found!.to)).toBe(`${B}noindent`);
  });

  it("leaves a command that says something", () => {
    expect(silentCommands(`${B}section{Eins}`)).toEqual([]);
  });
});

describe("includedGraphics", () => {
  it("finds the file, past the width the typesetter needs", () => {
    const text = `${B}includegraphics[width=0.9${B}linewidth]{images/ablauf}`;
    const [found] = includedGraphics(text);
    expect(found?.path).toBe("images/ablauf");
    expect(text.slice(found!.from, found!.to)).toBe(text);
  });

  it("copes without an option", () => {
    expect(includedGraphics(`${B}includegraphics{logo.png}`)[0]?.path).toBe(
      "logo.png",
    );
  });
});
