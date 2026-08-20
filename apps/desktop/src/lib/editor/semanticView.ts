/**
 * Drawing what the commands mean.
 *
 * [`semantics.ts`](./semantics.ts) works out what each one stands for; this
 * puts it on screen. The split is the same one the rest of the editor keeps:
 * the arithmetic is a pure function over the text and is tested as one, and
 * only the drawing needs a browser.
 *
 * # Nothing here invents a number
 *
 * A `\ref` shows the number this editor counted, and a `\cite` shows what the
 * bibliography says. Where the document does not define the target — a label
 * that is not there, a key that is not in the `.bib` — the reference is drawn
 * as *unresolved* rather than as something plausible. A reference that looks
 * fine and points nowhere is the failure worth designing against: it survives
 * proofreading and shows up as `??` in the printed thesis.
 */

import { EditorSelection, Facet } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { t } from "../i18n";
import { glossaryEntries } from "./generated";
import { drawable, replace } from "./pass";
import { showLineBreaks, showMachinery } from "./viewModes";
import type { Pass } from "./pass";
import {
  SEMANTIC_COMMANDS,
  includedGraphics,
  labelledMarker,
  lineBreaks,
  listOptions,
  metadataUses,
  settingCommands,
  quotationMarks,
  sectionNumbers,
  semantics,
  silentCommands,
  spacings,
  targets,
} from "./semantics";
import type { Occurrence, Target } from "./semantics";
import { braceCommands, environments, headings } from "./structure";
import {
  ALIGNMENTS,
  SHAPES,
  SIZES,
  declarations,
  metadata,
  verticalSpaces,
} from "./typography";
import type { Heading } from "./structure";

/** What the bibliography says about one entry. */
export interface BibEntry {
  key: string;
  /** What to draw in the text, e.g. `Meister 2021`. */
  label: string;
  /** What to show on hover: the title, and whatever else is worth knowing. */
  detail: string;
}

/**
 * The project's bibliography, supplied by the shell.
 *
 * A facet rather than something read from the buffer, because a `.bib` is a
 * different file — and in the default single-file mode it is not even the file
 * that is open. Empty is a perfectly good value: a citation then draws its key,
 * which is what the author typed and is still better than `\parencite{...}`.
 */
export const bibliography = Facet.define<
  ReadonlyMap<string, BibEntry>,
  ReadonlyMap<string, BibEntry>
>({
  combine: (values) => values[0] ?? new Map(),
});

/**
 * How to turn a figure's path into something an `<img>` can show.
 *
 * A facet, because the answer needs the filesystem and this module must not:
 * the shell reads the bytes through the capability-checked command and hands
 * back a URL. Absent, a figure is drawn as a frame naming its file, which is
 * what a figure whose image cannot be read should look like anyway.
 */
export const imageSource = Facet.define<
  (path: string) => Promise<string | null>,
  ((path: string) => Promise<string | null>) | null
>({
  combine: (values) => values[0] ?? null,
});

/** What to do when a citation is clicked, since its entry is in another file. */
export const followCitation = Facet.define<
  (key: string) => void,
  ((key: string) => void) | null
>({
  combine: (values) => values[0] ?? null,
});

/**
 * A reference drawn as what it refers to.
 *
 * The number where there is one, the title where there is not, and the key
 * itself where the document defines neither — marked as unresolved, because a
 * reference that looks right and points nowhere is worse than one that says it
 * is broken.
 */
class ReferenceWidget extends WidgetType {
  constructor(
    readonly command: string,
    readonly key: string,
    readonly target: Target | undefined,
  ) {
    super();
  }

  override eq(other: ReferenceWidget): boolean {
    return (
      other.key === this.key &&
      other.command === this.command &&
      other.target?.number === this.target?.number &&
      other.target?.title === this.target?.title
    );
  }

  /** What LaTeX would print here, as near as the buffer can say. */
  private text(): string {
    if (!this.target) return this.key;
    if (this.command === "nameref") return this.target.title || this.key;
    if (this.target.number) {
      // `\autoref` and `\cref` print the kind before the number, which is the
      // whole reason anyone uses them.
      const named = this.command === "autoref" || this.command.endsWith("cref");
      return named
        ? `${t(`reference-kind-${this.target.kind}`)} ${this.target.number}`
        : this.target.number;
    }
    return this.target.title || this.key;
  }

  override toDOM(view: EditorView): HTMLElement {
    const node = document.createElement("span");
    node.className = this.target
      ? "cm-yaz-reference"
      : "cm-yaz-reference cm-yaz-unresolved";
    node.textContent = this.text();
    node.title = this.target
      ? describe(this.target)
      : t("reference-undefined", { key: this.key });

    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const at = this.target?.at;
      if (at === undefined) {
        // Nowhere to go, so the next best thing is the source of the reference
        // itself — which is what the author has to fix.
        view.dispatch({
          selection: EditorSelection.cursor(view.posAtDOM(node)),
        });
      } else {
        view.dispatch({
          selection: EditorSelection.cursor(
            Math.min(at, view.state.doc.length),
          ),
          scrollIntoView: true,
        });
      }
      view.focus();
    });
    return node;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** How a target reads in a tooltip. */
function describe(target: Target): string {
  const kind = t(`reference-kind-${target.kind}`);
  const number = target.number ? ` ${target.number}` : "";
  return target.title
    ? `${kind}${number}: ${target.title}`
    : `${kind}${number}`;
}

/** A citation, drawn as the bibliography's short form. */
class CitationWidget extends WidgetType {
  constructor(
    readonly command: string,
    readonly keys: string[],
    readonly entries: (BibEntry | undefined)[],
    readonly follow: ((key: string) => void) | null,
  ) {
    super();
  }

  override eq(other: CitationWidget): boolean {
    return (
      other.command === this.command &&
      other.keys.join() === this.keys.join() &&
      other.entries.map((entry) => entry?.label).join() ===
        this.entries.map((entry) => entry?.label).join()
    );
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    const resolved = this.entries.some(Boolean);
    node.className = resolved
      ? "cm-yaz-citation"
      : "cm-yaz-citation cm-yaz-unresolved";

    const shown = this.keys.map(
      (key, index) => this.entries[index]?.label ?? key,
    );
    // `\parencite` prints its own brackets and `\textcite` does not — the
    // difference is the whole reason a document uses both.
    const bare = this.command === "textcite" || this.command === "citet";
    node.textContent = bare ? shown.join("; ") : `[${shown.join("; ")}]`;

    node.title = this.entries
      .map((entry, index) =>
        entry
          ? entry.detail
          : t("citation-unknown", { key: this.keys[index] ?? "" }),
      )
      .join("\n");

    const follow = this.follow;
    const first = this.keys[0];
    if (follow && first) {
      node.addEventListener("mousedown", (event) => {
        event.preventDefault();
        follow(first);
      });
    }
    return node;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** A glossary reference, drawn as the word it stands for. */
class GlossaryWidget extends WidgetType {
  constructor(
    readonly command: string,
    readonly key: string,
    readonly shown: string,
    readonly detail: string | null,
    readonly at: number | null,
  ) {
    super();
  }

  override eq(other: GlossaryWidget): boolean {
    return other.shown === this.shown && other.detail === this.detail;
  }

  override toDOM(view: EditorView): HTMLElement {
    const node = document.createElement("span");
    node.className = this.detail
      ? "cm-yaz-glossary"
      : "cm-yaz-glossary cm-yaz-unresolved";
    node.textContent = this.shown;
    node.title = this.detail ?? t("glossary-unknown", { key: this.key });

    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (this.at !== null) {
        view.dispatch({
          selection: EditorSelection.cursor(
            Math.min(this.at, view.state.doc.length),
          ),
          scrollIntoView: true,
        });
      }
      view.focus();
    });
    return node;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** A fixed piece of text standing in for markup — a quotation mark, a space. */
class TextWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly className: string,
  ) {
    super();
  }

  override eq(other: TextWidget): boolean {
    return other.content === this.content && other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = this.className;
    node.textContent = this.content;
    return node;
  }
}

/**
 * A stretch of empty page the document asked for.
 *
 * `\vspace{1cm}` on a title page is a centimetre of paper, and drawing it as
 * the words `\vspace{1cm}` is the difference between a title page and a list
 * of instructions for making one.
 */
class SpaceWidget extends WidgetType {
  constructor(readonly em: number | null) {
    super();
  }

  override eq(other: SpaceWidget): boolean {
    return other.em === this.em;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-vspace";
    // `\vfill` takes whatever is left, which on screen is a generous fixed
    // amount: the editor is not laying out a page and cannot know what is left.
    node.style.blockSize = this.em === null ? "4em" : `${this.em}em`;
    node.setAttribute("aria-hidden", "true");
    return node;
  }
}

/**
 * A figure, drawn as a figure.
 *
 * The image where it can be read, a frame naming the file where it cannot, and
 * the caption beneath — numbered the way LaTeX numbers it, so the number here
 * and the number every `\ref` to it shows are the same number.
 *
 * The image loads after the widget is on screen. A decoration is built
 * synchronously on the keystroke path and reading a file is not synchronous, so
 * the frame appears first and the picture arrives into it.
 */
class FigureWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly caption: string,
    readonly number: string,
    readonly kind: "figure" | "table",
    readonly resolve: ((path: string) => Promise<string | null>) | null,
  ) {
    super();
  }

  override eq(other: FigureWidget): boolean {
    return (
      other.path === this.path &&
      other.caption === this.caption &&
      other.number === this.number
    );
  }

  override toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-yaz-figure";

    const frame = document.createElement("div");
    frame.className = "cm-yaz-figure-frame";
    frame.textContent = this.path;
    box.append(frame);

    if (this.resolve && this.path) {
      void this.resolve(this.path).then((url) => {
        if (!url) return;
        const image = document.createElement("img");
        image.className = "cm-yaz-figure-image";
        image.src = url;
        image.alt = this.caption;
        frame.replaceWith(image);
      });
    }

    if (this.caption) {
      const caption = document.createElement("div");
      caption.className = "cm-yaz-figure-caption";
      const label = t(`figure-caption-${this.kind}`, { number: this.number });
      caption.textContent = `${label}: ${this.caption}`;
      box.append(caption);
    }

    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** An explicit line break, drawn as the break rather than as the two marks. */
class BreakWidget extends WidgetType {
  override eq(): boolean {
    // Every one is the same, so CodeMirror may reuse any of them.
    return true;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-linebreak";
    // A real break rather than a styled block: what follows has to start on
    // the next line inside the same paragraph, which is what `\\` means.
    node.append(document.createElement("br"));
    node.setAttribute("aria-hidden", "true");
    return node;
  }
}

/** What the semantic pass worked out, for the passes that run after it. */
export interface Meaning {
  /** The label each heading carries, by the heading's start offset. */
  labelled: Map<number, string>;
  /** The number each heading takes, by the heading's start offset. */
  numbers: Map<number, string>;
  /** Every label in the document, so a later pass can describe one. */
  targets: Map<string, Target>;
  /** Marker overrides for lists that set their own, by the list's start. */
  listMarkers: Map<number, { label: string; start: number }>;
}

/** How a glossary command changes the word it prints. */
function glossaryForm(command: string, name: string, detail: string): string {
  const plural = command === "glspl" || command === "Glspl";
  const capital = command.startsWith("G");
  const long = command === "acrlong" || command === "glsdesc";

  let word = long && detail ? detail : name;
  if (plural) word = /s$/i.test(word) ? word : `${word}s`;
  if (capital && word) word = word[0]!.toUpperCase() + word.slice(1);
  if (command === "acrfull" && detail) word = `${detail} (${name})`;
  return word;
}

/**
 * Draw everything that stands for something else.
 *
 * Returns what the later passes need, rather than storing it: the heading pass
 * wants to know which label a heading carries, and computing the semantics
 * twice would be a second walk of the document per keystroke.
 */
export function semanticMarkup(pass: Pass): Meaning {
  const found = semantics(
    pass.text,
    braceCommands(pass.text, SEMANTIC_COMMANDS),
  );
  const structure = headings(pass.text);
  const floats = environments(pass.text, [
    "figure",
    "figure*",
    "table",
    "table*",
    "longtable",
    "sidewaystable",
  ]);
  const targeted = targets(
    pass.text,
    structure,
    found.labels,
    floats,
    found.captions,
  );

  const meaning: Meaning = {
    labelled: labelsByHeading(structure, found.labels),
    numbers: sectionNumbers(structure),
    targets: targeted,
    listMarkers: new Map(),
  };

  const entries = new Map(
    glossaryEntries(pass.text)
      .filter((entry) => entry.key !== null)
      .map((entry) => [entry.key!, entry]),
  );
  const books = pass.state.facet(bibliography);
  const follow = pass.state.facet(followCitation);
  const resolve = pass.state.facet(imageSource);
  const marks = quotationMarks(pass.text);

  // Figures, drawn as figures. Before the labels and captions inside them are
  // looked at on their own account, because the whole environment is claimed.
  drawFigures(pass, floats, found.captions, targeted, resolve);

  // A label is folded into whatever it labels — the heading shows it on hover
  // — so nothing of it is left on screen.
  for (const label of found.labels) {
    if (drawable(pass, label.from, label.to))
      replace(pass, label.from, label.to);
  }

  for (const reference of found.references) {
    if (!drawable(pass, reference.from, reference.to)) continue;
    replace(
      pass,
      reference.from,
      reference.to,
      new ReferenceWidget(
        reference.command,
        reference.key,
        targeted.get(reference.key),
      ),
    );
  }

  for (const citation of found.citations) {
    if (!drawable(pass, citation.from, citation.to)) continue;
    // `\parencite{a,b}` is one citation of two works, which is how a document
    // cites two sources for one claim.
    const keys = citation.key
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    replace(
      pass,
      citation.from,
      citation.to,
      new CitationWidget(
        citation.command,
        keys,
        keys.map((key) => books.get(key)),
        follow,
      ),
    );
  }

  for (const use of found.glossary) {
    if (!drawable(pass, use.from, use.to)) continue;
    const entry = entries.get(use.key);
    replace(
      pass,
      use.from,
      use.to,
      new GlossaryWidget(
        use.command,
        use.key,
        entry
          ? glossaryForm(use.command, entry.label, entry.detail ?? "")
          : use.key,
        entry?.detail ?? null,
        entry?.at ?? null,
      ),
    );
  }

  // The quotation marks the document's language uses, in place of the command.
  for (const quotation of found.quotations) {
    if (!drawable(pass, quotation.from, quotation.to)) continue;
    replace(
      pass,
      quotation.from,
      quotation.argFrom,
      new TextWidget(marks.open, "cm-yaz-quote-mark"),
    );
    replace(
      pass,
      quotation.argTo,
      quotation.to,
      new TextWidget(marks.close, "cm-yaz-quote-mark"),
    );
  }

  // What the document says about itself, in the place that writes `\thetitle`
  // rather than the title. Resolved from the source each time, so editing
  // `\title{...}` changes the title page in the same keystroke.
  const declared = metadata(pass.text);

  for (const use of metadataUses(pass.text)) {
    const value = declared.get(use.command);
    if (value === undefined || !drawable(pass, use.from, use.to)) continue;
    replace(pass, use.from, use.to, new TextWidget(value, "cm-yaz-declared"));
  }

  // `\textls[200]{...}` spaces the letters out, which is what a university
  // name across the top of a title page is set in. The amount is thousandths
  // of an em, as `microtype` counts it.
  for (const spaced of braceCommands(pass.text, ["textls"])) {
    const option = /\[(-?\d+)\]/.exec(
      pass.text.slice(spaced.from, spaced.argFrom),
    );
    const amount = option ? Number(option[1]) / 1000 : 0.1;
    if (spaced.argTo > spaced.argFrom) {
      pass.ranges.push(
        Decoration.mark({
          class: "cm-yaz-tracked",
          attributes: { style: `letter-spacing:${amount}em` },
        }).range(spaced.argFrom, spaced.argTo),
      );
    }
    if (drawable(pass, spaced.from, spaced.argFrom)) {
      replace(pass, spaced.from, spaced.argFrom);
      replace(pass, spaced.argTo, spaced.to);
    }
  }

  // Declarations style the group they open and are then hidden. Sizes and
  // shapes are marks, which is what lets several of them apply to one group.
  for (const declaration of declarations(pass.text)) {
    const size = SIZES[declaration.command];
    const shape = SHAPES[declaration.command];
    const alignment = ALIGNMENTS[declaration.command];

    if (declaration.bodyTo > declaration.bodyFrom) {
      if (size !== undefined) {
        pass.ranges.push(
          Decoration.mark({
            class: "cm-yaz-sized",
            attributes: { style: `font-size:${size}em` },
          }).range(declaration.bodyFrom, declaration.bodyTo),
        );
      }
      if (shape) {
        pass.ranges.push(
          Decoration.mark({ class: shape }).range(
            declaration.bodyFrom,
            declaration.bodyTo,
          ),
        );
      }
      if (alignment) {
        // Alignment is a property of whole lines, so it is a line decoration
        // on each of them rather than a mark across the middle of one.
        const doc = pass.state.doc;
        const last = doc.lineAt(
          Math.min(declaration.bodyTo, doc.length),
        ).number;
        for (
          let number = doc.lineAt(declaration.bodyFrom).number;
          number <= last;
          number += 1
        ) {
          pass.ranges.push(
            Decoration.line({
              class: `cm-yaz-align cm-yaz-align-${alignment}`,
            }).range(doc.line(number).from),
          );
        }
      }
    }

    if (drawable(pass, declaration.from, declaration.to)) {
      replace(pass, declaration.from, declaration.to);
    }
  }

  for (const space of verticalSpaces(pass.text)) {
    if (!drawable(pass, space.from, space.to)) continue;
    replace(pass, space.from, space.to, new SpaceWidget(space.em));
  }

  for (const space of spacings(pass.text)) {
    if (!drawable(pass, space.from, space.to)) continue;
    replace(
      pass,
      space.from,
      space.to,
      new TextWidget(space.character, "cm-yaz-space"),
    );
  }

  // `\renewcommand{\arraystretch}{1.2}` and the like: their arguments are
  // settings, and a reader has no use for either the command or them.
  const machinery = pass.state.field(showMachinery, false);
  if (!machinery) {
    for (const setting of settingCommands(pass.text)) {
      if (drawable(pass, setting.from, setting.to)) {
        replace(pass, setting.from, setting.to);
      }
    }
  }

  // An explicit break, unless the reader has asked to see the markup.
  if (!pass.state.field(showLineBreaks, false)) {
    for (const found of lineBreaks(pass.text)) {
      if (!drawable(pass, found.from, found.to)) continue;
      replace(pass, found.from, found.to, new BreakWidget());
    }
  }

  // A figure's image where there is no figure around it — which is how a title
  // page puts a logo on the page.
  for (const graphic of includedGraphics(pass.text)) {
    if (pass.covered.overlaps(graphic.from, graphic.to)) continue;
    if (!drawable(pass, graphic.from, graphic.to)) continue;
    replace(
      pass,
      graphic.from,
      graphic.to,
      new FigureWidget(graphic.path, "", "", "figure", resolve),
    );
  }

  for (const silent of silentCommands(pass.text)) {
    if (drawable(pass, silent.from, silent.to)) {
      replace(pass, silent.from, silent.to);
    }
  }

  // A list's options are layout instructions, so none of them is on screen —
  // except the two that change what the reader sees, which are handed on.
  for (const list of environments(pass.text, [
    "itemize",
    "enumerate",
    "description",
  ])) {
    const options = listOptions(pass.text, list.bodyFrom);
    if (!options) continue;
    if (options.label) {
      meaning.listMarkers.set(list.from, {
        label: options.label,
        start: options.start ?? 1,
      });
    }
    if (drawable(pass, options.from, options.to)) {
      replace(pass, options.from, options.to);
    }
  }

  return meaning;
}

/**
 * Draw each figure as one block.
 *
 * Only figures: a table environment already has its contents drawn by the
 * table pass, and replacing the whole thing would throw that away in exchange
 * for a frame.
 */
function drawFigures(
  pass: Pass,
  floats: readonly {
    name: string;
    from: number;
    to: number;
    bodyFrom: number;
    bodyTo: number;
  }[],
  captions: readonly Occurrence[],
  targeted: ReadonlyMap<string, Target>,
  resolve: ((path: string) => Promise<string | null>) | null,
): void {
  for (const float of floats) {
    if (!float.name.startsWith("figure") && float.name !== "wrapfigure") {
      continue;
    }
    const graphics = includedGraphics(
      pass.text.slice(float.bodyFrom, float.bodyTo),
    );
    if (graphics.length !== 1) continue;

    const caption = captions.find(
      (candidate) =>
        candidate.from >= float.bodyFrom && candidate.to <= float.bodyTo,
    );
    // The number the figure will carry, found through whichever label names it
    // — so the figure and every reference to it agree.
    const number =
      [...targeted.values()].find(
        (target) =>
          target.kind === "figure" &&
          target.at >= float.bodyFrom &&
          target.at <= float.bodyTo,
      )?.number ?? "";

    if (!drawable(pass, float.from, float.to)) continue;
    replace(
      pass,
      float.from,
      float.to,
      new FigureWidget(
        graphics[0]!.path,
        caption ? pass.text.slice(caption.argFrom, caption.argTo) : "",
        number,
        "figure",
        resolve,
      ),
    );
  }
}

/** Re-exported so `richText` can draw a marker without importing semantics. */
export { labelledMarker };

/**
 * Which label each heading carries.
 *
 * A `\label` belongs to the heading above it, and only when nothing else comes
 * between — a label further down the section names the section too, but showing
 * it on the heading would suggest it sits there.
 */
function labelsByHeading(
  structure: readonly Heading[],
  labels: readonly Occurrence[],
): Map<number, string> {
  const found = new Map<number, string>();

  for (const heading of structure) {
    const label = labels.find(
      (candidate) =>
        candidate.from >= heading.to && candidate.from <= heading.to + 2,
    );
    if (label) found.set(heading.from, label.key);
  }

  return found;
}

/** Everything the semantic view draws, styled. */
export const semanticTheme = EditorView.baseTheme({
  ".cm-yaz-reference, .cm-yaz-citation": {
    color: "var(--yaz-syntax-reference)",
    cursor: "pointer",
    borderRadius: "var(--yaz-radius-sm)",
  },
  ".cm-yaz-reference:hover, .cm-yaz-citation:hover, .cm-yaz-glossary:hover": {
    background: "var(--yaz-bg-hover)",
  },
  ".cm-yaz-glossary": {
    cursor: "help",
    borderBlockEnd: "1px dotted var(--yaz-text-muted)",
  },
  // Unresolved is drawn, not hidden. A reference that points nowhere is a
  // defect the author has to see before the compile tells them in `??`.
  ".cm-yaz-unresolved": {
    color: "var(--yaz-syntax-error)",
    textDecoration: "underline",
    textDecorationStyle: "wavy",
    textUnderlineOffset: "0.2em",
  },
  ".cm-yaz-figure": {
    display: "block",
    textAlign: "center",
    margin: "var(--yaz-space-4) auto",
  },
  ".cm-yaz-figure-image": {
    maxInlineSize: "100%",
    blockSize: "auto",
    borderRadius: "var(--yaz-radius-sm)",
  },
  // What is drawn until the image arrives, and what stays if it never does.
  ".cm-yaz-figure-frame": {
    display: "grid",
    placeItems: "center",
    minBlockSize: "6em",
    padding: "var(--yaz-space-4)",
    border: "1px dashed var(--yaz-border)",
    borderRadius: "var(--yaz-radius-md)",
    color: "var(--yaz-text-muted)",
    fontFamily: "var(--yaz-font-mono)",
    fontSize: "0.85em",
    wordBreak: "break-all",
  },
  ".cm-yaz-figure-caption": {
    marginBlockStart: "var(--yaz-space-2)",
    fontFamily: "var(--yaz-font-sans)",
    fontSize: "0.9em",
    color: "var(--yaz-text-secondary)",
    textAlign: "center",
  },
  ".cm-yaz-linebreak": { display: "inline" },
  ".cm-yaz-quote-mark": { color: "var(--yaz-text-secondary)" },
  // A declaration's size is inline style rather than a class: there are ten of
  // them and the scale is the value, not a name.
  ".cm-yaz-sized": { lineHeight: "1.2" },
  ".cm-yaz-vspace": { display: "block" },
  ".cm-yaz-align-center": { textAlign: "center" },
  ".cm-yaz-align-start": { textAlign: "start" },
  ".cm-yaz-align-end": { textAlign: "end" },
  // What the document declares about itself, shown where it is written.
  ".cm-yaz-declared": { color: "inherit" },
  ".cm-yaz-sans": { fontFamily: "var(--yaz-font-sans)" },
  ".cm-yaz-space": { whiteSpace: "pre" },
});
