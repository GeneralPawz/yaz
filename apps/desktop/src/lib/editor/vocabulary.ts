/**
 * What the preview knows how to draw, and where that knowledge came from.
 *
 * # The line this draws
 *
 * **LaTeX itself — the kernel and the standard classes — is yaz's.** A
 * `\section`, an `itemize`, `$x^2$`, `\textbf`: those are not extensions, they
 * are what a `.tex` file *is*, and an editor for LaTeX that needed a plugin to
 * show a heading would be an editor that does not do its job.
 *
 * **Everything a package adds is a plugin's.** `\gls` is glossaries.
 * `\parencite` is biblatex. `\enquote` is csquotes. Each is somebody's package,
 * each could be replaced by a different package doing the same job, and there
 * is no end to the list — which is exactly the shape of thing that should live
 * outside the application rather than accumulate inside it.
 *
 * The test is not "does a real thesis use it" — a real thesis uses `\gls` 561
 * times. It is "does `\documentclass{article}` alone define it".
 *
 * # yaz keeps the walk; a plugin says what a command means
 *
 * A plugin does **not** get to scan the document. The whole document is walked
 * once per keystroke ([`tokens.ts`](./tokens.ts)), because measured against a
 * joined thesis a second walk costs more than everything else in the pass put
 * together — and a dozen plugins each walking it would be a dozen times that.
 *
 * So a contribution is a *declaration*: this command name, drawn this way. The
 * pass stays here and stays one pass, and the plugin never sees an offset.
 */

/** How a command is drawn. */
export type Rendering =
  /** Draw as the number or title of what it names: `\ref`, `\autoref`. */
  | { kind: "reference" }
  /** Draw as the bibliography's short form: `\cite`, `\parencite`. */
  | { kind: "citation" }
  /**
   * Draw as the glossary entry it names: `\gls`, `\acrlong`.
   *
   * `plural` and `capital` say what the command does to the word, which is the
   * only difference between the eight of them.
   */
  | { kind: "glossary"; plural?: boolean; capital?: boolean; long?: boolean }
  /** Wrap the argument in the document language's quotation marks. */
  | { kind: "quotation" }
  /** Space the letters out, by thousandths of an em: `\textls`. */
  | { kind: "tracking" }
  /** Style the argument and hide the markup: `\textbf`, `\emph`. */
  | { kind: "inline"; className: string }
  /** Hide it; it produces no words. `\noindent`, `\makeglossaries`. */
  | { kind: "silent" }
  /** Hide it and the arguments it takes: `\renewcommand{\x}{y}`. */
  | { kind: "setting"; braces: number }
  /** Stand in for a generated list: `\tableofcontents`, `\printbibliography`. */
  | { kind: "listing"; listing: ListingKind; braces?: number }
  /** End the page: `\clearpage`. */
  | { kind: "pagebreak" }
  /** A label attached to whatever it follows. */
  | { kind: "label" }
  /** A caption, which names its float. */
  | { kind: "caption" };

/** Which generated list a command stands for. */
export type ListingKind =
  "contents" | "figures" | "tables" | "glossary" | "bibliography" | "index";

/** How an environment is drawn. */
export type EnvironmentRendering =
  /** Arrangement only: its `\begin` and `\end` lines are hidden. */
  | { kind: "structural" }
  /** A list, whose items get markers. */
  | { kind: "list" }
  /** A table, drawn from its source. */
  | { kind: "table"; columnArguments: number }
  /** Mathematics, typeset whole. */
  | { kind: "math" }
  /** A float, which carries a number and a caption. */
  | { kind: "float"; counts: "figure" | "table" }
  /** Turns the paper it sits on. */
  | { kind: "turned" }
  /** Sets its contents apart as quoted. */
  | { kind: "quote" };

/** One entry, and who provided it. */
export interface Entry<T> {
  rendering: T;
  /** The plugin that contributed it, or `null` for LaTeX itself. */
  provider: string | null;
}

/**
 * LaTeX's own commands.
 *
 * Everything here is defined by the kernel or by `article`, `report` and
 * `book`. Nothing here needs a `\usepackage`, which is the whole test.
 */
const CORE_COMMANDS: Record<string, Rendering> = {
  // Cross-references. `\ref` and `\pageref` are the kernel's; `\autoref` and
  // `\nameref` are hyperref's and `\cref` is cleveref's, so those are not here.
  ref: { kind: "reference" },
  pageref: { kind: "reference" },
  label: { kind: "label" },

  // The kernel's own citation, and the bibliography it goes with.
  cite: { kind: "citation" },

  // Font selection.
  textbf: { kind: "inline", className: "cm-yaz-strong" },
  textit: { kind: "inline", className: "cm-yaz-emphasis" },
  emph: { kind: "inline", className: "cm-yaz-emphasis" },
  texttt: { kind: "inline", className: "cm-yaz-mono" },
  textsc: { kind: "inline", className: "cm-yaz-smallcaps" },
  textrm: { kind: "inline", className: "" },
  textsf: { kind: "inline", className: "cm-yaz-sans" },
  underline: { kind: "inline", className: "cm-yaz-underline" },

  // Captions name their float.
  caption: { kind: "caption" },

  // Generated lists the standard classes produce.
  tableofcontents: { kind: "listing", listing: "contents" },
  listoffigures: { kind: "listing", listing: "figures" },
  listoftables: { kind: "listing", listing: "tables" },
  bibliography: { kind: "listing", listing: "bibliography", braces: 1 },

  // Ending a page.
  clearpage: { kind: "pagebreak" },
  cleardoublepage: { kind: "pagebreak" },
  newpage: { kind: "pagebreak" },
  pagebreak: { kind: "pagebreak" },

  // Instructions that produce no words.
  noindent: { kind: "silent" },
  par: { kind: "silent" },
  vfill: { kind: "silent" },
  centering: { kind: "silent" },
  raggedright: { kind: "silent" },
  raggedleft: { kind: "silent" },
  hline: { kind: "silent" },
  makeindex: { kind: "silent" },

  // Settings, with the arguments they swallow.
  renewcommand: { kind: "setting", braces: 2 },
  setlength: { kind: "setting", braces: 2 },
  setcounter: { kind: "setting", braces: 2 },
  thispagestyle: { kind: "setting", braces: 1 },
  pagestyle: { kind: "setting", braces: 1 },
  pagenumbering: { kind: "setting", braces: 1 },
  addcontentsline: { kind: "setting", braces: 3 },
};

/** LaTeX's own environments. */
const CORE_ENVIRONMENTS: Record<string, EnvironmentRendering> = {
  titlepage: { kind: "structural" },
  center: { kind: "structural" },
  flushleft: { kind: "structural" },
  flushright: { kind: "structural" },
  abstract: { kind: "structural" },

  itemize: { kind: "list" },
  enumerate: { kind: "list" },
  description: { kind: "list" },

  quote: { kind: "quote" },
  quotation: { kind: "quote" },
  verse: { kind: "quote" },

  tabular: { kind: "table", columnArguments: 0 },
  "tabular*": { kind: "table", columnArguments: 1 },

  figure: { kind: "float", counts: "figure" },
  "figure*": { kind: "float", counts: "figure" },
  table: { kind: "float", counts: "table" },
  "table*": { kind: "float", counts: "table" },

  // The kernel's mathematics. `align` and friends are amsmath's.
  equation: { kind: "math" },
  "equation*": { kind: "math" },
  displaymath: { kind: "math" },
  eqnarray: { kind: "math" },
  "eqnarray*": { kind: "math" },
};

/** What a plugin adds. */
export interface Contribution {
  /** The plugin's id, so its entries can be withdrawn together. */
  pluginId: string;
  commands?: Record<string, Rendering>;
  environments?: Record<string, EnvironmentRendering>;
}

let commands = new Map<string, Entry<Rendering>>();
let environments = new Map<string, Entry<EnvironmentRendering>>();

/** Put the core vocabulary back, discarding every contribution. */
function reset(): void {
  commands = new Map(
    Object.entries(CORE_COMMANDS).map(([name, rendering]) => [
      name,
      { rendering, provider: null },
    ]),
  );
  environments = new Map(
    Object.entries(CORE_ENVIRONMENTS).map(([name, rendering]) => [
      name,
      { rendering, provider: null },
    ]),
  );
}

reset();

/**
 * Replace every contribution with these.
 *
 * Replace rather than add, so reloading a plugin during development does not
 * leave the previous load's commands behind.
 *
 * A contribution may not take a name LaTeX itself defines. `\section` means
 * what LaTeX says it means, and a plugin that could redefine it would make the
 * preview depend on which plugins happen to be installed — which is the one
 * thing an editor showing a document must never do.
 */
export function setContributions(contributions: readonly Contribution[]): void {
  reset();

  for (const contribution of contributions) {
    for (const [name, rendering] of Object.entries(
      contribution.commands ?? {},
    )) {
      if (commands.get(name)?.provider === null) continue;
      commands.set(name, { rendering, provider: contribution.pluginId });
    }
    for (const [name, rendering] of Object.entries(
      contribution.environments ?? {},
    )) {
      if (environments.get(name)?.provider === null) continue;
      environments.set(name, { rendering, provider: contribution.pluginId });
    }
  }
}

/** How a command is drawn, or nothing if the preview does not know it. */
export function renderingOf(name: string): Rendering | null {
  return commands.get(name)?.rendering ?? null;
}

/** How an environment is drawn. */
export function environmentRenderingOf(
  name: string,
): EnvironmentRendering | null {
  return environments.get(name)?.rendering ?? null;
}

/** Every command name with a given rendering kind. */
export function commandsOfKind(kind: Rendering["kind"]): string[] {
  return [...commands.entries()]
    .filter(([, entry]) => entry.rendering.kind === kind)
    .map(([name]) => name);
}

/** Every environment name with a given rendering kind. */
export function environmentsOfKind(
  kind: EnvironmentRendering["kind"],
): string[] {
  return [...environments.entries()]
    .filter(([, entry]) => entry.rendering.kind === kind)
    .map(([name]) => name);
}

/** Every command the preview understands, for the settings list and the docs. */
export function knownCommands(): { name: string; provider: string | null }[] {
  return [...commands.entries()]
    .map(([name, entry]) => ({ name, provider: entry.provider }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether LaTeX itself defines this, as opposed to a package. */
export function isCore(name: string): boolean {
  return commands.get(name)?.provider === null;
}
