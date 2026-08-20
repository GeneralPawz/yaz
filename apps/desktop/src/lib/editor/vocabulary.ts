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
  /**
   * Put space there: `space`, `\quad`, `igskip`.
   *
   * `axis` says which way it goes and `ems` how much, for the ones that fix
   * their own size. A `space{2cm}` takes its size from its argument, so it
   * carries none here and is measured when it is drawn.
   */
  | { kind: "space"; axis: "block" | "inline"; ems?: number; braces?: number }
  /**
   * Stand for a character the keyboard does not have: `\ldots`, `\S`.
   *
   * The text is the character itself. These are not markup around a word, they
   * *are* the word — so hiding them would delete content rather than reveal it.
   */
  | { kind: "symbol"; text: string }
  /** Draw the date the document is compiled: `	oday`. */
  | { kind: "date" }

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
  | { kind: "quote" }
  /**
   * Set exactly as written, markup and all.
   *
   * The one environment where *not* rendering is the rendering: inside
   * `verbatim` a backslash is a backslash, and a preview that drew `	extbf`
   * as bold there would be showing something the compiler will not print.
   */
  | { kind: "verbatim" };

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
  textnormal: { kind: "inline", className: "" },
  textup: { kind: "inline", className: "" },
  textmd: { kind: "inline", className: "" },
  textsl: { kind: "inline", className: "cm-yaz-emphasis" },
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

  // Words the keyboard has no key for. Content, not markup.
  ldots: { kind: "symbol", text: "…" },
  dots: { kind: "symbol", text: "…" },
  textellipsis: { kind: "symbol", text: "…" },
  textendash: { kind: "symbol", text: "–" },
  textemdash: { kind: "symbol", text: "—" },
  textbackslash: { kind: "symbol", text: "\\" },
  textasciitilde: { kind: "symbol", text: "~" },
  textasciicircum: { kind: "symbol", text: "^" },
  textbar: { kind: "symbol", text: "|" },
  textless: { kind: "symbol", text: "<" },
  textgreater: { kind: "symbol", text: ">" },
  textbullet: { kind: "symbol", text: "•" },
  textperiodcentered: { kind: "symbol", text: "·" },
  textregistered: { kind: "symbol", text: "®" },
  texttrademark: { kind: "symbol", text: "™" },
  copyright: { kind: "symbol", text: "©" },
  pounds: { kind: "symbol", text: "£" },
  dag: { kind: "symbol", text: "†" },
  ddag: { kind: "symbol", text: "‡" },
  S: { kind: "symbol", text: "§" },
  P: { kind: "symbol", text: "¶" },
  LaTeX: { kind: "symbol", text: "LaTeX" },
  LaTeXe: { kind: "symbol", text: "LaTeX2ε" },
  TeX: { kind: "symbol", text: "TeX" },

  // The date the document is compiled.
  today: { kind: "date" },

  // Space, which is content in the sense that it takes room on the paper.
  // `space` and `fill` are *not* here: `semanticView.ts` has drawn
  // vertical space since the title page needed it, and two owners for one
  // command is one more than a command can have. Horizontal space is new.
  hspace: { kind: "space", axis: "inline", braces: 1 },
  // `\smallskip`, `\medskip` and `igskip` are not here either, for the same
  // reason `space` is not: `typography.ts` has drawn vertical space since the
  // title page needed it. Everything below is horizontal, which was missing.
  quad: { kind: "space", axis: "inline", ems: 1 },
  qquad: { kind: "space", axis: "inline", ems: 2 },
  enspace: { kind: "space", axis: "inline", ems: 0.5 },
  thinspace: { kind: "space", axis: "inline", ems: 0.17 },
  hfill: { kind: "space", axis: "inline", ems: 2 },
  dotfill: { kind: "space", axis: "inline", ems: 2 },
  hrulefill: { kind: "space", axis: "inline", ems: 2 },

  // Boxes. A box is its contents with something drawn around them, which is
  // the inline treatment with a different class — there is no third thing a
  // box does that would need a kind of its own.
  fbox: { kind: "inline", className: "cm-yaz-framed" },
  framebox: { kind: "inline", className: "cm-yaz-framed" },
  mbox: { kind: "inline", className: "cm-yaz-nowrap" },
  makebox: { kind: "inline", className: "cm-yaz-nowrap" },

  // Raised and lowered.
  textsuperscript: { kind: "inline", className: "cm-yaz-superscript" },
  textsubscript: { kind: "inline", className: "cm-yaz-subscript" },

  // A note. Set small and apart, where it was written rather than at the foot
  // of the page: this view has no page foot to put it in, and moving the words
  // somewhere the source does not have them would be the preview inventing a
  // layout rather than showing one.
  footnote: { kind: "inline", className: "cm-yaz-footnote" },
  footnotetext: { kind: "inline", className: "cm-yaz-footnote" },
  thanks: { kind: "inline", className: "cm-yaz-footnote" },

  // Instructions that produce no words.
  noindent: { kind: "silent" },
  indent: { kind: "silent" },
  par: { kind: "silent" },
  vfill: { kind: "silent" },
  hfil: { kind: "silent" },
  // `\centering` and its two relatives are *not* here. They are alignment
  // declarations: they apply to the rest of their group, and `typography.ts`
  // both hides the command and aligns what follows it. Calling them silent
  // here would hide the command and lose the alignment — which is what a
  // centred title page looked like until this was noticed.
  hline: { kind: "silent" },
  hrule: { kind: "silent" },
  makeindex: { kind: "silent" },
  maketitle: { kind: "silent" },
  makeatletter: { kind: "silent" },
  makeatother: { kind: "silent" },
  protect: { kind: "silent" },
  relax: { kind: "silent" },
  sloppy: { kind: "silent" },
  fussy: { kind: "silent" },
  unskip: { kind: "silent" },
  allowbreak: { kind: "silent" },
  linebreak: { kind: "silent" },
  nolinebreak: { kind: "silent" },
  nopagebreak: { kind: "silent" },
  samepage: { kind: "silent" },
  appendix: { kind: "silent" },
  frontmatter: { kind: "silent" },
  mainmatter: { kind: "silent" },
  backmatter: { kind: "silent" },
  footnotemark: { kind: "silent" },
  noalign: { kind: "silent" },

  // Settings, with the arguments they swallow.
  newcommand: { kind: "setting", braces: 2 },
  providecommand: { kind: "setting", braces: 2 },
  newenvironment: { kind: "setting", braces: 3 },
  renewenvironment: { kind: "setting", braces: 3 },
  newtheorem: { kind: "setting", braces: 2 },
  newcounter: { kind: "setting", braces: 1 },
  stepcounter: { kind: "setting", braces: 1 },
  refstepcounter: { kind: "setting", braces: 1 },
  newlength: { kind: "setting", braces: 1 },
  addtolength: { kind: "setting", braces: 2 },
  settowidth: { kind: "setting", braces: 2 },
  bibliographystyle: { kind: "setting", braces: 1 },
  nocite: { kind: "setting", braces: 1 },
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

  // Set as written, character for character.
  verbatim: { kind: "verbatim" },
  "verbatim*": { kind: "verbatim" },

  // Arrangement the standard classes define.
  minipage: { kind: "structural" },
  list: { kind: "list" },
  trivlist: { kind: "list" },
  thebibliography: { kind: "list" },
  theindex: { kind: "structural" },
  sloppypar: { kind: "structural" },

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
