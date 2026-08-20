<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, Compartment } from "@codemirror/state";
  import {
    EditorView,
    keymap,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import {
    autocompletion,
    completionKeymap,
    closeBrackets,
    closeBracketsKeymap,
  } from "@codemirror/autocomplete";
  import {
    StreamLanguage,
    syntaxHighlighting,
    HighlightStyle,
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
  } from "@codemirror/language";
  import { stex } from "@codemirror/legacy-modes/mode/stex";
  import { tags } from "@lezer/highlight";
  import { vim } from "@replit/codemirror-vim";
  import type { EditorApi } from "@yaz/api";
  import {
    richText,
    richTextEnabled,
    setRichText,
    setShowComments,
  } from "./editor/richText";
  import { imageSource } from "./editor/semanticView";
  import { changesIn, setSegments, stitched } from "./editor/stitched";
  import type { Change, Segment } from "./editor/stitch";
  import { includeLinks } from "./editor/includeLinks";
  import { lineNumbering } from "./editor/lineNumbers";
  import type { LineNumbering } from "./editor/lineNumbers";
  import {
    linesPerLandscapePage,
    linesPerPage,
    paginated,
    pagination,
  } from "./editor/pagination";
  import { editorKeymap } from "./keys/editorKeys";
  import type { ResolvedShortcut } from "./keys/registry";

  interface Props {
    /** Buffer contents. Changing this to a different file replaces the document. */
    doc: string;
    /** Which file this buffer belongs to; used to decide replace-vs-update. */
    docId: string;
    /**
     * The buffer changed.
     *
     * The text and the changes both. The text is what everything reading the
     * document wants; the changes are what writing back to several files needs,
     * since an edit can only be sent to a file if it is known as an edit and not
     * as a new version of half a megabyte of text.
     */
    onChange: (text: string, changes: Change[]) => void;
    onSave: () => void;
    vimMode: boolean;
    /** Render LaTeX as styled text. Decorations over the same buffer. */
    rich: boolean;
    /** How the gutter numbers lines, if at all. */
    numbering: LineNumbering;
    /**
     * Set the text on a sheet of paper rather than filling the pane.
     *
     * The sheet is the size the document declares, so what is on screen has
     * the proportions of what will come out of the printer. It is not a
     * preview — the lines do not break where LaTeX will break them, and
     * claiming otherwise would be worse than not showing a page at all.
     */
    pageView: boolean;
    /** The page's proportions, in millimetres. */
    page: { width: number; height: number };
    /** How large the text is drawn, as a percentage. */
    zoom: number;
    /**
     * Whether the author's comments are on screen.
     *
     * Hiding them is a reading aid, not an edit: the characters stay in the
     * buffer and come back the moment the switch moves.
     */
    comments?: boolean;
    /**
     * Whether the page is drawn as white paper whatever the interface is.
     *
     * Someone proofreading wants paper; someone writing at midnight wants the
     * dark they set the rest of the application to. The two are different
     * questions, so this is a separate switch and not a consequence of the
     * colour mode.
     */
    paperLight?: boolean;
    /**
     * Whether paragraphs are set justified, as LaTeX sets them by default.
     *
     * Read from the document rather than chosen here: a document that says
     * `\raggedright` means it, and a paragraph shown flush on both edges when it
     * will print ragged is a paragraph whose shape on screen is a lie.
     */
    justified?: boolean;
    /**
     * Whether a line too long for the pane comes back round.
     *
     * On by default. A pasted URL or a long sentence otherwise runs off to the
     * right and takes the rest of the document with it — the horizontal
     * scrollbar appears, every other line becomes shorter than the pane, and
     * reading means scrolling sideways and back for one line in fifty.
     *
     * Off is a real preference, not an oversight: someone lining up a table by
     * hand, or reading a generated file where a line's length is the point,
     * wants to see where a line actually ends.
     */
    wrap: boolean;
    /**
     * The shortcuts, already resolved against the user's preferences.
     *
     * Passed in rather than read here: the registry is the application's, and
     * an editor that reached for it directly would be a second place shortcuts
     * come from.
     */
    shortcuts: ResolvedShortcut[];
    /**
     * Which file each stretch of the buffer belongs to, or null for one file.
     *
     * Handed over whole, when the shell stitches the document. It is
     * deliberately *not* fed back on every keystroke: the editor moves the map
     * itself as the text changes, because an edit has to be judged before it
     * applies and a map that arrives a frame later arrives after the damage
     * ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)).
     */
    segments?: Segment[] | null;
    /**
     * An edit was refused because it spanned a seam.
     *
     * Nothing happened to the document, so this is the only sign the keystroke
     * was heard at all — which is why it is reported rather than dropped.
     */
    onRefused?: (() => void) | undefined;
    /**
     * A file name in an `\\include` was clicked, as written in the source.
     *
     * Passed on unresolved: the path is relative to the file that contains it,
     * and the editor does not know which file that is.
     */
    onOpenInclude?: ((argument: string) => void) | undefined;
    /**
     * Turn a figure's path into something an `<img>` can show.
     *
     * Passed in because reading a file is the shell's business and not the
     * editor's — the capability check lives in the Rust process (ADR-0006), and
     * an editor that reached for the filesystem would be going round it.
     */
    resolveImage?: ((path: string) => Promise<string | null>) | undefined;
    /** Caret moved, as an offset into the source. */
    onCursor?: ((offset: number) => void) | undefined;
    /**
     * Handed an `EditorApi` when the view exists, and `null` when it goes away.
     *
     * This is how a plugin reaches the buffer. It is deliberately a callback
     * rather than an exported binding: the view outlives neither the component
     * nor a file switch, and a stale handle would let a plugin write into a
     * destroyed document.
     */
    onReady?: (api: EditorApi | null) => void;
  }

  let {
    doc,
    docId,
    onChange,
    onSave,
    vimMode,
    rich,
    numbering,
    pageView,
    page,
    zoom,
    wrap,
    comments = true,
    paperLight = false,
    justified = true,
    shortcuts,
    segments = null,
    resolveImage,
    onRefused,
    onOpenInclude,
    onCursor,
    onReady,
  }: Props = $props();

  /** The map currently installed, so a re-stitch can be told from a keystroke. */
  let loadedSegments: Segment[] | null = null;

  /**
   * The buffer as `@yaz/api` describes it.
   *
   * There is one buffer holding the raw `.tex` in both source and visual mode,
   * so this needs no notion of modes (ADR-0004).
   */
  function editorApi(instance: EditorView): EditorApi {
    return {
      getText: () => instance.state.doc.toString(),
      getSelection: () => {
        const range = instance.state.selection.main;
        return { from: range.from, to: range.to };
      },
      replaceRange: (from, to, text) => {
        instance.dispatch({ changes: { from, to, insert: text } });
      },
      insertAtCursor: (text) => {
        const range = instance.state.selection.main;
        instance.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          // Leave the caret after what was inserted, which is where someone
          // who just pasted a citation expects to keep typing.
          selection: { anchor: range.from + text.length },
        });
        instance.focus();
      },
      getMode: () => (instance.state.field(richTextEnabled, false) ? "visual" : "source"),
      revealRange: (from, to) => {
        instance.dispatch({
          selection: { anchor: from, head: to },
          // `center` rather than the default, so a heading jumped to from
          // the outline does not land against the top edge.
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        instance.focus();
      },
    };
  }

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let loadedDocId = "";

  const vimCompartment = new Compartment();
  const numberCompartment = new Compartment();
  const keyCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const pageCompartment = new Compartment();

  /*
   * Colours come from the theme token contract, never literals — ADR-0010 makes
   * a hardcoded colour in a component a lint failure, and it is what lets a user
   * theme restyle the editor without touching code.
   */
  const yazTheme = EditorView.theme(
    {
      "&": {
        color: "var(--yaz-editor-text)",
        backgroundColor: "var(--yaz-editor-bg)",
        height: "100%",
        fontSize: "var(--yaz-font-size-base)",
      },
      ".cm-content": {
        fontFamily: "var(--yaz-font-mono)",
        lineHeight: "var(--yaz-line-height)",
        caretColor: "var(--yaz-editor-cursor)",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--yaz-editor-cursor)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--yaz-bg-selection)",
      },
      ".cm-activeLine": { backgroundColor: "var(--yaz-editor-active-line)" },
      ".cm-gutters": {
        backgroundColor: "var(--yaz-editor-gutter-bg)",
        color: "var(--yaz-editor-gutter-text)",
        border: "none",
        borderInlineEnd: "1px solid var(--yaz-border)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--yaz-bg-hover)",
        color: "var(--yaz-text-primary)",
      },
      ".cm-scroller": { overflow: "auto" },
    },
    { dark: true },
  );

  const yazHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--yaz-syntax-command)" },
    { tag: tags.tagName, color: "var(--yaz-syntax-environment)" },
    { tag: tags.comment, color: "var(--yaz-syntax-comment)", fontStyle: "italic" },
    { tag: tags.string, color: "var(--yaz-syntax-string)" },
    { tag: tags.atom, color: "var(--yaz-syntax-math)" },
    { tag: tags.number, color: "var(--yaz-syntax-math)" },
    { tag: tags.bracket, color: "var(--yaz-text-muted)" },
    { tag: tags.variableName, color: "var(--yaz-syntax-reference)" },
    { tag: tags.invalid, color: "var(--yaz-syntax-error)" },
  ]);

  function baseExtensions() {
    return [
      // The line-number gutter is not here: it lives in a compartment, so that
      // switching it off or over to relative numbers reconfigures the view
      // rather than rebuilding the document.
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      EditorState.allowMultipleSelections.of(true),
      // TODO(phase-4): replace the legacy stex mode with a Lezer LaTeX grammar.
      // Visual mode needs a real syntax tree to hang decorations off, and a
      // StreamLanguage does not give us one (ADR-0004).
      StreamLanguage.define(stex),
      // Rich text is decorations over this same buffer, never a second
      // document (ADR-0004).
      richText(),
      syntaxHighlighting(yazHighlight),
      yazTheme,
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        // Completion's own `Ctrl-Space` is dropped: the window takes that as
        // the prefix every yaz shortcut hangs off, so the binding could never
        // fire. It is re-registered as `edit.complete` on `Ctrl+Shift+Space`,
        // where it is listed and rebindable rather than quietly gone.
        ...completionKeymap.filter((binding) => binding.key !== "Mod-Space"),
        ...searchKeymap,
      ]),
      // A figure's image, when the shell can supply one. Constant for the life
      // of the view: the resolver is a function, not a value that changes.
      imageSource.of((path) => resolveImage?.(path) ?? Promise.resolve(null)),
      pagination(),
      pageCompartment.of([
        paginated.of(false),
        linesPerPage.of(0),
        linesPerLandscapePage.of(0),
      ]),
      // Both are inert until they are given something: stitched mode refuses
      // nothing without a segment map, and a document with no `\\include` in it
      // has no links to draw.
      stitched(() => onRefused?.()),
      includeLinks((argument) => onOpenInclude?.(argument)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString(), changesIn(update.changes));
        }
        // The outline highlights the section the caret is in, so it needs the
        // position rather than the text.
        if (update.selectionSet || update.docChanged) {
          onCursor?.(update.state.selection.main.head);
        }
      }),
    ];
  }

  /**
   * Create the view once, for as long as there is an element to put it in.
   *
   * **This effect must depend on `host` and nothing else.** Everything else it
   * needs is read through `untrack`, because an effect re-runs when anything it
   * read changes — and `doc` changes on every keystroke, since `onChange` feeds
   * the text straight back in as a prop.
   *
   * Reading `doc` here therefore destroyed and rebuilt CodeMirror on every
   * character typed: the editor lost focus and the caret jumped to the top of
   * the file, so the document could only be written one keystroke per click.
   *
   * Subsequent changes are handled by the effects below, which is the point of
   * having them: a new file replaces the document, and toggling Vim
   * reconfigures a compartment. Neither rebuilds the view.
   */
  $effect(() => {
    if (!host) return;
    const parent = host;

    const instance = untrack(
      () =>
        new EditorView({
          parent,
          state: EditorState.create({
            doc,
            // Vim goes in a compartment so it can be toggled without rebuilding
            // the document, which would lose the undo history and cursor.
            extensions: [
              vimCompartment.of(vimMode ? vim() : []),
              numberCompartment.of(lineNumbering(numbering)),
              keyCompartment.of(editorKeymap(shortcuts, { save: onSave })),
              // Wrapping is what the pane's width means. In the page view the
              // content box is the page, so the same extension wraps to the
              // paper rather than to the window — the measure follows the
              // document's own layout without a second setting to keep in step.
              wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
              ...baseExtensions(),
            ],
          }),
        }),
    );

    // Opening straight into rich text should not need a second frame, and
    // neither should opening straight into a stitched document.
    untrack(() => {
      const effects = [];
      if (rich) effects.push(setRichText.of(true));
      if (segments) effects.push(setSegments.of([...segments]));
      if (effects.length > 0) instance.dispatch({ effects });
    });

    view = instance;
    untrack(() => {
      loadedDocId = docId;
      loadedSegments = segments;
      onReady?.(editorApi(instance));
    });

    return () => {
      instance.destroy();
      view = undefined;
      untrack(() => onReady?.(null));
    };
  });

  // Replace the document only when the *file* changes. Reacting to `doc` alone
  // would fight the user's own typing, since onChange feeds it straight back.
  //
  // The segment map rides along in the same transaction rather than arriving in
  // one of its own. Switching into stitched mode changes both at once, and a
  // document replaced while the old map was still installed would be a document
  // every offset of which pointed at the wrong file — briefly, but the refusal
  // filter runs in exactly that window.
  $effect(() => {
    const nextSegments = segments;
    if (!view) return;
    const newDocument = docId !== loadedDocId;
    if (!newDocument && nextSegments === loadedSegments) return;

    view.dispatch({
      ...(newDocument
        ? {
            changes: { from: 0, to: view.state.doc.length, insert: doc },
            selection: { anchor: 0 },
          }
        : {}),
      effects: setSegments.of(nextSegments ? [...nextSegments] : []),
    });
    loadedDocId = docId;
    loadedSegments = nextSegments;
  });

  $effect(() => {
    // An effect rather than a reconfigure: switching view must not rebuild the
    // editor, or the caret and the undo history go with it.
    view?.dispatch({ effects: setRichText.of(rich) });
  });

  $effect(() => {
    view?.dispatch({ effects: setShowComments.of(comments) });
  });

  $effect(() => {
    view?.dispatch({
      effects: vimCompartment.reconfigure(vimMode ? vim() : []),
    });
  });

  // A compartment for the same reason Vim has one: changing the gutter must
  // not rebuild the document.
  $effect(() => {
    view?.dispatch({
      effects: numberCompartment.reconfigure(lineNumbering(numbering)),
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  });

  /**
   * A CSS millimetre, in pixels. Fixed by the specification, not by the screen.
   */
  const PIXELS_PER_MM = 96 / 25.4;

  /**
   * How many lines fit on a sheet, and whether to draw sheets at all.
   *
   * `defaultLineHeight` is a measurement, but a stable one: it depends on the
   * font and the zoom and not on what has been scrolled into view, so a page
   * break derived from it does not move while the reader scrolls — which is
   * the whole reason the break positions are counted rather than measured.
   *
   * The zoom cancels. The sheet is drawn at `height x zoom` and the line is
   * drawn at `line-height x zoom`, so their ratio — which is all this is — is
   * the same at every magnification.
   */
  $effect(() => {
    const instance = view;
    if (!instance) return;

    const lineHeight = instance.defaultLineHeight * (100 / zoom);
    const fits = (millimetres: number) =>
      pageView && lineHeight > 0
        ? Math.max(
            1,
            Math.floor(((millimetres - 2 * PAGE_MARGIN_MM) * PIXELS_PER_MM) / lineHeight),
          )
        : 0;

    instance.dispatch({
      effects: pageCompartment.reconfigure([
        paginated.of(pageView),
        linesPerPage.of(fits(page.height)),
        // A turned sheet is as tall as the paper is wide, so it holds fewer.
        linesPerLandscapePage.of(fits(page.width)),
      ]),
    });
  });

  /** What a page leaves around its text. Kept in step with the stylesheet. */
  const PAGE_MARGIN_MM = 25;

  // Rebinding a shortcut in settings takes effect where the caret is, without
  // the document being rebuilt underneath it.
  $effect(() => {
    view?.dispatch({
      effects: keyCompartment.reconfigure(editorKeymap(shortcuts, { save: onSave })),
    });
  });
</script>

<!--
  The page's width is set in millimetres and its content scaled by the zoom, so
  that "100%" means the sheet is drawn at its real proportions and a change of
  zoom is one number rather than a recalculation of everything on it.
-->
<div
  class="editor"
  class:paged={pageView}
  class:paper={paperLight}
  class:justified
  style:--yaz-page-width="{page.width}mm"
  style:--yaz-page-height="{page.height}mm"
  style:--yaz-zoom={zoom / 100}
  bind:this={host}
></div>

<style>
  .editor {
    block-size: 100%;
    inline-size: 100%;
    overflow: hidden;
    /* What a page leaves around its text, and what the band undoes to reach
       the paper's edge. */
    --yaz-page-margin: 25mm;
  }

  /* Zoom applies whether or not the page is showing: someone reading a long
     document wants larger text on a full-width pane too. */
  .editor :global(.cm-content) {
    font-size: calc(var(--yaz-font-size-base) * var(--yaz-zoom, 1));
  }

  /* Justified, which is what LaTeX does unless the document says otherwise.
     `text-wrap: pretty` keeps the last line of a paragraph from being a single
     short word, which is the one thing hyphenless justification gets worst. */
  .editor.justified :global(.cm-content) {
    text-align: justify;
    text-wrap: pretty;
    hyphens: auto;
  }

  /* White paper under a dark interface.

     The tokens are overridden rather than the colours set directly, so
     everything drawn inside the page — headings, rules, the bands, a rendered
     table — follows without each of them needing to know about this switch
     (ADR-0010). */
  .editor.paper :global(.cm-editor) {
    --yaz-editor-bg: #ffffff;
    --yaz-editor-text: #1a1a1a;
    --yaz-bg-primary: #ffffff;
    --yaz-bg-secondary: #f4f4f5;
    --yaz-bg-tertiary: #e9e9ec;
    --yaz-bg-hover: #e4e4e7;
    --yaz-text-primary: #1a1a1a;
    --yaz-text-secondary: #3f3f46;
    --yaz-text-muted: #71717a;
    --yaz-border: #d4d4d8;
    --yaz-editor-active-line: #f4f4f5;
    --yaz-editor-gutter-bg: #fafafa;
    --yaz-editor-gutter-text: #a1a1aa;
  }

  /* The page. A sheet of the declared size, centred on the surround, with the
     text inside it — the editor still owns the scrolling, so a long document
     scrolls as one continuous sheet rather than paginating. Pagination is
     LaTeX's answer and arrives with the PDF; guessing at it here would put two
     different page breaks in front of the same author. */
  .editor.paged {
    background: var(--yaz-pdf-bg);
    overflow: auto;
  }

  .editor.paged :global(.cm-editor) {
    background: transparent;
  }

  .editor.paged :global(.cm-scroller) {
    justify-content: center;
  }

  /* The content box is the width of the paper and nothing else: the paper
     itself is drawn per line, because that is the only way one continuous
     document can be shown as a stack of separate sheets.

     The margin is a custom property rather than a literal because three other
     things have to undo exactly it — the front-matter band, the fill below a
     short page, and the line count that decides where a sheet ends — and
     numbers that must agree should be one number. */
  .editor.paged :global(.cm-content) {
    inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    max-inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    box-sizing: border-box;
    padding: 0;
    margin-block: var(--yaz-space-4);
    background: transparent;
  }

  .editor.paged :global(.cm-gutters) {
    background: transparent;
    border: none;
  }

  /* The front and back matter, as a band the width of the paper.

     On paper this material is not part of the document at all — it is what
     produces the document — so in the view that shows the paper it is drawn
     as a strip across it rather than as text set in the measure. One row when
     it is closed, a band of rows when it is opened. */
  /* Everything on the page sits on the paper.

     Every direct child, not every line: the marks that open and close the text
     are block widgets, and CodeMirror puts a block widget beside the lines
     rather than inside one. Selecting lines alone left those marks off the
     sheet and against the left edge of the pane, which is what they were doing
     until this rule replaced it. */
  .editor.paged :global(.cm-content > *) {
    box-sizing: border-box;
    inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    margin-inline: auto;
    padding-inline: var(--yaz-page-margin);
    background: var(--yaz-bg-primary);
  }

  /* Turned: as wide as the paper is tall, which is the point of turning it —
     a table that did not fit across the measure fits across this one. */
  .editor.paged :global(.cm-content > .cm-yaz-sheet-turned),
  .editor.paged :global(.cm-content > .cm-yaz-page-fill-turned) {
    inline-size: calc(var(--yaz-page-height) * var(--yaz-zoom, 1));
  }

  /* The band across the front and back matter.

     No negative margin: the sheet's own padding box already spans the paper,
     so a background on it reaches the edges without being pulled outwards —
     and pulling it outwards is what stopped the marks being centred. */
  .editor.paged :global(.cm-yaz-boundary),
  .editor.paged :global(.cm-yaz-matter) {
    background: var(--yaz-bg-tertiary);
  }

  .editor.paged :global(.cm-yaz-boundary) {
    /* Full strength here: on the page it is a band and not an ornament
       floating in the margin, so half-hiding it would read as a mistake. */
    opacity: 1;
  }
</style>
