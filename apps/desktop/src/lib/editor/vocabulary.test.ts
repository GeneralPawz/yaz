/**
 * Where LaTeX stops and a package begins.
 *
 * The classification is the point of this module, so these check the line
 * rather than the plumbing: that the kernel's commands are yaz's, that a
 * package's are not, and that a plugin cannot take one of LaTeX's own names.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  commandsOfKind,
  environmentRenderingOf,
  environmentsOfKind,
  isCore,
  knownCommands,
  renderingOf,
  setContributions,
} from "./vocabulary";

afterEach(() => setContributions([]));

describe("what LaTeX itself defines", () => {
  it("knows the kernel's own commands without any plugin", () => {
    // `\documentclass{article}` alone defines all of these, which is the test.
    expect(renderingOf("section" as string)).toBeNull(); // headings have their own scanner
    expect(renderingOf("textbf")).toEqual({
      kind: "inline",
      className: "cm-yaz-strong",
    });
    expect(renderingOf("ref")).toEqual({ kind: "reference" });
    expect(renderingOf("cite")).toEqual({ kind: "citation" });
    expect(renderingOf("tableofcontents")).toEqual({
      kind: "listing",
      listing: "contents",
    });
    expect(renderingOf("clearpage")).toEqual({ kind: "pagebreak" });
  });

  it("knows the standard classes' environments", () => {
    expect(environmentRenderingOf("itemize")).toEqual({ kind: "list" });
    expect(environmentRenderingOf("titlepage")).toEqual({ kind: "structural" });
    expect(environmentRenderingOf("figure")).toEqual({
      kind: "float",
      counts: "figure",
    });
  });

  it("does not know a package's commands", () => {
    // Each of these needs a \usepackage, so each belongs to a plugin. A real
    // thesis uses \gls 561 times, and that is still not the test.
    for (const name of [
      "gls",
      "parencite",
      "enquote",
      "textls",
      "printglossaries",
      "autoref",
      "cref",
    ]) {
      expect(renderingOf(name)).toBeNull();
    }
  });

  it("does not know a package's environments", () => {
    for (const name of ["landscape", "longtable", "align", "sidewaystable"]) {
      expect(environmentRenderingOf(name)).toBeNull();
    }
  });
});

describe("what a plugin adds", () => {
  const glossaries = {
    pluginId: "com.yaz.latex-packages",
    commands: {
      gls: { kind: "glossary" as const },
      printglossaries: {
        kind: "listing" as const,
        listing: "glossary" as const,
      },
    },
    environments: { landscape: { kind: "turned" as const } },
  };

  it("is known once contributed", () => {
    setContributions([glossaries]);
    expect(renderingOf("gls")).toEqual({ kind: "glossary" });
    expect(environmentRenderingOf("landscape")).toEqual({ kind: "turned" });
  });

  it("is forgotten when the plugin goes", () => {
    setContributions([glossaries]);
    setContributions([]);
    expect(renderingOf("gls")).toBeNull();
  });

  it("replaces rather than accumulates", () => {
    // A reload during development must not leave the previous load behind.
    setContributions([glossaries]);
    setContributions([
      {
        pluginId: "com.yaz.latex-packages",
        commands: { enquote: { kind: "quotation" } },
      },
    ]);
    expect(renderingOf("gls")).toBeNull();
    expect(renderingOf("enquote")).toEqual({ kind: "quotation" });
  });

  it("cannot take a name LaTeX itself defines", () => {
    // The preview must not depend on which plugins happen to be installed. A
    // plugin that could redefine `\textbf` would make it depend on exactly
    // that.
    setContributions([
      {
        pluginId: "com.example.mischief",
        commands: { textbf: { kind: "silent" } },
        environments: { itemize: { kind: "structural" } },
      },
    ]);
    expect(renderingOf("textbf")).toEqual({
      kind: "inline",
      className: "cm-yaz-strong",
    });
    expect(environmentRenderingOf("itemize")).toEqual({ kind: "list" });
  });
});

describe("asking the vocabulary what it holds", () => {
  it("groups commands by how they are drawn", () => {
    expect(commandsOfKind("pagebreak").sort()).toEqual([
      "cleardoublepage",
      "clearpage",
      "newpage",
      "pagebreak",
    ]);
  });

  it("groups environments the same way", () => {
    // `list` and `trivlist` are the kernel's own general-purpose lists, which
    // everything else is built on, and `thebibliography` is one of them — a
    // list of entries with hanging indents, which is why it is here and not
    // in the plugin with biblatex.
    expect(environmentsOfKind("list").sort()).toEqual([
      "description",
      "enumerate",
      "itemize",
      "list",
      "thebibliography",
      "trivlist",
    ]);
  });

  it("says which came from where", () => {
    setContributions([
      {
        pluginId: "com.yaz.latex-packages",
        commands: { gls: { kind: "glossary" } },
      },
    ]);
    const known = knownCommands();
    expect(known.find((entry) => entry.name === "textbf")?.provider).toBeNull();
    expect(known.find((entry) => entry.name === "gls")?.provider).toBe(
      "com.yaz.latex-packages",
    );
  });

  it("reports whether a command is LaTeX's own", () => {
    setContributions([
      {
        pluginId: "com.yaz.latex-packages",
        commands: { gls: { kind: "glossary" } },
      },
    ]);
    expect(isCore("ref")).toBe(true);
    expect(isCore("gls")).toBe(false);
    expect(isCore("nonsense")).toBe(false);
  });
});
