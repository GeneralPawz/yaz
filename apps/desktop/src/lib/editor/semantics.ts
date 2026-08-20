/**
 * What a command *means*, as opposed to what it looks like.
 *
 * `\ref{fig:ablauf}` is five words of markup standing for one number, and
 * `\gls{BIM}` — which the thesis this was built against uses 561 times — is a
 * key standing for a word. Rendering them as themselves is what makes rich
 * text a view of the document rather than a prettier view of the source.
 *
 * # Read from the buffer, and honest about it
 *
 * A section number here is counted the way LaTeX counts, not read from a build.
 * That is right often enough to be useful and wrong in exactly the cases the
 * author has changed the counters by hand, so the number is shown as the
 * editor's own reading and a reference whose target is not in the buffer says
 * so instead of guessing.
 *
 * # One walk
 *
 * Everything below takes an already-gathered list of brace commands rather than
 * scanning for itself. A decoration pass runs over the whole document on every
 * keystroke (ADR-0015), and eight scanners each walking a joined manuscript
 * would be eight times the budget for constructs that are a few characters
 * each.
 */

import { braceCommands, matchBrace, plainText } from "./structure";
import { Kind, commentRanges, tokensIn } from "./tokens";
import type { BraceCommand, Heading } from "./structure";

/** Commands that name a target the document defines elsewhere. */
export const REFERENCE_COMMANDS = [
  "ref",
  "eqref",
  "autoref",
  "cref",
  "Cref",
  "pageref",
  "nameref",
] as const;

/** Commands that cite the bibliography. */
export const CITATION_COMMANDS = [
  "cite",
  "parencite",
  "textcite",
  "footcite",
  "autocite",
  "citep",
  "citet",
  "supercite",
] as const;

/** Commands that print a glossary entry. */
export const GLOSSARY_COMMANDS = [
  "gls",
  "Gls",
  "glspl",
  "Glspl",
  "acrshort",
  "acrlong",
  "acrfull",
  "glsdesc",
] as const;

/** Commands whose argument is a label, not text. */
export const LABEL_COMMANDS = ["label"] as const;

/** Every one-argument command this module understands. */
export const SEMANTIC_COMMANDS: readonly string[] = [
  ...REFERENCE_COMMANDS,
  ...CITATION_COMMANDS,
  ...GLOSSARY_COMMANDS,
  ...LABEL_COMMANDS,
  "enquote",
  "caption",
];

/** One occurrence, sorted into what it is. */
export interface Occurrence {
  /** The command, without the backslash. */
  command: string;
  /** What is in the braces, trimmed. */
  key: string;
  from: number;
  to: number;
  argFrom: number;
  argTo: number;
}

/** Everything the pass needs, from one walk of the commands. */
export interface Semantics {
  labels: Occurrence[];
  references: Occurrence[];
  citations: Occurrence[];
  glossary: Occurrence[];
  quotations: Occurrence[];
  captions: Occurrence[];
}

const REFERENCES = new Set<string>(REFERENCE_COMMANDS);
const CITATIONS = new Set<string>(CITATION_COMMANDS);
const GLOSSARY = new Set<string>(GLOSSARY_COMMANDS);

/** Sort every semantic command in the text into its kind. */
export function semantics(
  text: string,
  commands: BraceCommand[] = braceCommands(text, SEMANTIC_COMMANDS),
): Semantics {
  const found: Semantics = {
    labels: [],
    references: [],
    citations: [],
    glossary: [],
    quotations: [],
    captions: [],
  };

  for (const command of commands) {
    const occurrence: Occurrence = {
      command: command.command,
      key: text.slice(command.argFrom, command.argTo).trim(),
      from: command.from,
      to: command.to,
      argFrom: command.argFrom,
      argTo: command.argTo,
    };

    if (command.command === "label") found.labels.push(occurrence);
    else if (REFERENCES.has(command.command)) found.references.push(occurrence);
    else if (CITATIONS.has(command.command)) found.citations.push(occurrence);
    else if (GLOSSARY.has(command.command)) found.glossary.push(occurrence);
    else if (command.command === "enquote") found.quotations.push(occurrence);
    else if (command.command === "caption") found.captions.push(occurrence);
  }

  return found;
}

/**
 * The number LaTeX would print for each heading, e.g. `3.5.2`.
 *
 * Counted from the headings themselves. A starred heading takes no number and
 * does not advance the counter, which is what the star means. `\part` is
 * numbered separately in every class that has it and is therefore left out of
 * the dotted number rather than being made its first component.
 *
 * `\paragraph` and below are unnumbered in the standard classes, so they get
 * nothing — which is also why a `\ref` to one shows its title instead.
 */
export function sectionNumbers(
  headings: readonly Heading[],
): Map<number, string> {
  const numbers = new Map<number, string>();
  // One counter per level, indexed as `Heading.level`.
  const counters = [0, 0, 0, 0, 0, 0, 0];
  /** Levels that carry a number in the standard classes. */
  const DEEPEST_NUMBERED = 4;

  for (const heading of headings) {
    if (heading.starred || heading.level === 0) continue;
    if (heading.level > DEEPEST_NUMBERED) continue;

    counters[heading.level] = (counters[heading.level] ?? 0) + 1;
    for (
      let deeper = heading.level + 1;
      deeper < counters.length;
      deeper += 1
    ) {
      counters[deeper] = 0;
    }
    numbers.set(heading.from, counters.slice(1, heading.level + 1).join("."));
  }

  return numbers;
}

/** What a label names, and how to describe it. */
export interface Target {
  /** The label's key. */
  key: string;
  /** What LaTeX would print for a `\ref` to it — a number, where there is one. */
  number: string | null;
  /** The heading, caption or environment it belongs to. */
  title: string;
  /** What kind of thing it is, as a message-key suffix. */
  kind: "heading" | "figure" | "table" | "equation" | "unknown";
  /** Where to go when the reference is clicked. */
  at: number;
}

/** Environments whose captions are numbered separately from the sections. */
const FLOATS: Record<string, "figure" | "table"> = {
  figure: "figure",
  "figure*": "figure",
  wrapfigure: "figure",
  table: "table",
  "table*": "table",
  longtable: "table",
  sidewaystable: "table",
};

/**
 * Everything the document labels, by key.
 *
 * A label belongs to whatever encloses or precedes it: inside a figure it
 * names the figure, and after a heading it names the section. That is not a
 * convention this imposes — it is how LaTeX's `\label` works, since the label
 * takes whichever counter was last stepped.
 */
export function targets(
  text: string,
  headings: readonly Heading[],
  labels: readonly Occurrence[],
  floats: readonly {
    name: string;
    from: number;
    to: number;
    bodyFrom: number;
    bodyTo: number;
  }[],
  captions: readonly Occurrence[],
): Map<string, Target> {
  const numbers = sectionNumbers(headings);
  const found = new Map<string, Target>();

  // Float counters run separately from the section counters, and in the
  // standard classes they are prefixed by the chapter — which is why this
  // counts chapters as it goes rather than numbering the floats afterwards.
  const counted = new Map<string, number>();
  const floatNumber = (kind: "figure" | "table", at: number): string => {
    const chapter = chapterBefore(headings, numbers, at);
    const key = `${kind}:${chapter}`;
    const next = (counted.get(key) ?? 0) + 1;
    counted.set(key, next);
    return chapter ? `${chapter}.${next}` : String(next);
  };

  const numberedFloats = new Map<
    (typeof floats)[number],
    { kind: "figure" | "table"; number: string }
  >();
  for (const float of floats) {
    const kind = FLOATS[float.name];
    if (!kind) continue;
    numberedFloats.set(float, { kind, number: floatNumber(kind, float.from) });
  }

  for (const label of labels) {
    const float = floats.find(
      (candidate) =>
        label.from >= candidate.bodyFrom && label.to <= candidate.bodyTo,
    );
    const numbered = float ? numberedFloats.get(float) : undefined;

    if (float && numbered) {
      const caption = captions.find(
        (candidate) =>
          candidate.from >= float.bodyFrom && candidate.to <= float.bodyTo,
      );
      found.set(label.key, {
        key: label.key,
        number: numbered.number,
        title: caption
          ? plainText(text.slice(caption.argFrom, caption.argTo))
          : "",
        kind: numbered.kind,
        at: caption ? caption.argFrom : float.from,
      });
      continue;
    }

    const heading = lastHeadingBefore(headings, label.from);
    found.set(label.key, {
      key: label.key,
      number: heading ? (numbers.get(heading.from) ?? null) : null,
      title: heading ? plainText(heading.title) : "",
      kind: heading ? "heading" : "unknown",
      at: heading ? heading.titleFrom : label.from,
    });
  }

  return found;
}

/** The heading a label sits under, or null when it sits above them all. */
function lastHeadingBefore(
  headings: readonly Heading[],
  at: number,
): Heading | null {
  let found: Heading | null = null;
  for (const heading of headings) {
    if (heading.to > at) break;
    found = heading;
  }
  return found;
}

/** The chapter number in force at an offset, as a float's prefix. */
function chapterBefore(
  headings: readonly Heading[],
  numbers: ReadonlyMap<number, string>,
  at: number,
): string {
  let chapter = "";
  for (const heading of headings) {
    if (heading.from > at) break;
    if (heading.level === 1) chapter = numbers.get(heading.from) ?? chapter;
  }
  return chapter;
}

/**
 * Spacing commands, and the character each one sets.
 *
 * `z.\,B.` is how German typography sets an abbreviation, and showing the
 * `\,` between the letters is the difference between reading a sentence and
 * reading its source. The widths are LaTeX's own: a thin space is 1/6 em, a
 * `\;` is thick, and `~` is an ordinary space that will not break.
 */
export const SPACES: Record<string, string> = {
  ",": " ",
  ":": " ",
  ";": " ",
  "!": "",
  " ": " ",
};

/** One spacing command in the text. */
export interface Spacing {
  from: number;
  to: number;
  /** What to draw instead. */
  character: string;
}

/**
 * Every spacing command, including the tie `~`.
 *
 * A tie is not a backslash command, so it is found here rather than through
 * `braceCommands`, and it is drawn as a non-breaking space — which is what it
 * is, and which stops `Abschnitt~3.5` breaking across a line.
 */
export function spacings(text: string): Spacing[] {
  const found: Spacing[] = [];

  for (const token of tokensIn(text)) {
    // A tie is not a backslash command, which is why the index carries it: `~`
    // is an ordinary space that will not break, and `Abschnitt~3.5` relies on
    // exactly that.
    if (token.kind === Kind.Special && token.character === "~") {
      found.push({ from: token.at, to: token.after, character: NO_BREAK });
      continue;
    }
    // An escape that is not a space is a character: `\%` is a per cent sign and
    // `\\` is a line break, and neither is drawn as blank.
    if (token.kind !== Kind.Escape) continue;
    const width = SPACES[token.character];
    if (width === undefined) continue;
    found.push({ from: token.at, to: token.after, character: width });
  }

  return found;
}

/** What a tie draws as: a space the line will not break at. */
const NO_BREAK = "\u00a0";

/**
 * The commands a template defines to carry the document's own metadata.
 *
 * A title page writes `\thetitle`, never the title: the preamble `\let`s it to
 * `\@title`, and a template with a subtitle builds `\thesubtitle` out of a
 * `\newcommand`. These are the handful every template defines, and resolving
 * them is what makes a title page read as a title page.
 */
export const METADATA_COMMANDS = new Set([
  "thetitle",
  "theauthor",
  "thedate",
  "thesubtitle",
  "thereviewer",
]);

/** Every use of one of them in the text. */
export function metadataUses(text: string): Silent[] {
  const found: Silent[] = [];

  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command) continue;
    if (!METADATA_COMMANDS.has(token.name)) continue;
    found.push({ command: token.name, from: token.at, to: token.after });
  }

  return found;
}

/** A list's optional argument, which is styling rather than content. */
export interface ListOptions {
  from: number;
  to: number;
  /** The `label=` value, when the list sets its own markers. */
  label: string | null;
  /** The `start=` value, when the list does not start at one. */
  start: number | null;
}

/**
 * Read the `[...]` after a list's `\begin`.
 *
 * `enumitem` options are how a real document controls its lists — `[nosep]`
 * appears 36 times in the thesis this was built against — and every one of
 * them is a layout instruction, so none of them belongs on screen. The two
 * that change what the *reader* sees are kept: the marker and where it starts.
 */
export function listOptions(
  text: string,
  bodyFrom: number,
): ListOptions | null {
  let cursor = bodyFrom;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] !== "[") return null;

  const close = text.indexOf("]", cursor);
  if (close === -1) return null;

  const options = text.slice(cursor + 1, close);
  const label = /(?:^|,)\s*label\s*=\s*([^,\]]*)/.exec(options);
  const start = /(?:^|,)\s*start\s*=\s*(\d+)/.exec(options);

  return {
    from: cursor,
    to: close + 1,
    label: label ? label[1]!.trim() : null,
    start: start ? Number(start[1]) : null,
  };
}

/**
 * The marker an `enumitem` label produces for an item.
 *
 * `label=\alph*)` gives `a)`, `b)`, `c)`. The star is where the counter goes,
 * so everything around it is literal — which is why this substitutes rather
 * than matching a fixed set of shapes.
 */
export function labelledMarker(label: string, index: number): string | null {
  const counter = /\\(alph|Alph|arabic|roman|Roman)\*/.exec(label);
  if (!counter) return null;

  const value = (() => {
    switch (counter[1]) {
      case "alph":
        return String.fromCharCode(96 + ((index - 1) % 26) + 1);
      case "Alph":
        return String.fromCharCode(64 + ((index - 1) % 26) + 1);
      case "roman":
        return romanNumeral(index).toLowerCase();
      case "Roman":
        return romanNumeral(index);
      default:
        return String(index);
    }
  })();

  return label.replace(counter[0], value).trim();
}

/** Roman numerals, for list markers that ask for them. */
function romanNumeral(value: number): string {
  const parts: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let left = value;
  let out = "";
  for (const [amount, numeral] of parts) {
    while (left >= amount) {
      out += numeral;
      left -= amount;
    }
  }
  return out;
}

/**
 * The quotation marks a document's language uses.
 *
 * `csquotes` picks these from `babel`, which is why the language is read from
 * the preamble rather than being a setting: a German document quotes „like
 * this“ and an English one “like this”, and getting it from the document means
 * the author never has to say so twice.
 */
export function quotationMarks(text: string): { open: string; close: string } {
  const preamble = text.slice(0, Math.min(text.length, 65536));
  if (/\\usepackage\s*\[[^\]]*\b(ngerman|german|austrian)\b/.test(preamble)) {
    return { open: "„", close: "“" };
  }
  if (/\\usepackage\s*\[[^\]]*\b(french|francais)\b/.test(preamble)) {
    return { open: "« ", close: " »" };
  }
  return { open: "“", close: "”" };
}

/**
 * Commands that stand for nothing a reader sees.
 *
 * `\noindent` and `\centering` change how the next paragraph is set, which is
 * drawn rather than written out; `\FloatBarrier` and `\par` are instructions
 * to the typesetter. All of them are hidden, and all of them come back when
 * the caret reaches them.
 */
export const SILENT_COMMANDS = new Set([
  "noindent",
  "centering",
  "raggedright",
  "raggedleft",
  "FloatBarrier",
  "par",
  "clearpage",
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "endfirsthead",
  "endhead",
  "endfoot",
  "endlastfoot",
]);

/** Where a silent command sits. */
export interface Silent {
  command: string;
  from: number;
  to: number;
}

/** Every silent command in the text. */
export function silentCommands(text: string): Silent[] {
  const found: Silent[] = [];

  for (const token of tokensIn(text)) {
    if (token.kind !== Kind.Command) continue;
    if (!SILENT_COMMANDS.has(token.name)) continue;
    found.push({ command: token.name, from: token.at, to: token.after });
  }

  return found;
}

/**
 * Whether an `\includegraphics` names a file, and which.
 *
 * The optional `[width=...]` is skipped rather than read: how wide a figure is
 * printed is the typesetter's business, and a figure drawn to the measure of
 * the pane is closer to the truth than one drawn to a fraction of a page width
 * the editor is not laying out.
 */
export function includedGraphics(
  text: string,
): { from: number; to: number; path: string }[] {
  const found: { from: number; to: number; path: string }[] = [];
  const comments = commentRanges(text);

  for (const match of text.matchAll(
    /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{/g,
  )) {
    const at = match.index;
    if (comments.some((range) => at >= range.from && at < range.to)) continue;
    const open = at + match[0].length - 1;
    const end = matchBrace(text, open);
    if (end === null) continue;
    found.push({
      from: at,
      to: end,
      path: text.slice(open + 1, end - 1).trim(),
    });
  }

  return found;
}
