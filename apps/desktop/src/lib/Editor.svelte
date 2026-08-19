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
  import { richText, richTextEnabled, setRichText } from "./editor/richText";
  import { lineNumbering } from "./editor/lineNumbers";
  import type { LineNumbering } from "./editor/lineNumbers";
  import { editorKeymap } from "./keys/editorKeys";
  import type { ResolvedShortcut } from "./keys/registry";

  interface Props {
    /** Buffer contents. Changing this to a different file replaces the document. */
    doc: string;
    /** Which file this buffer belongs to; used to decide replace-vs-update. */
    docId: string;
    onChange: (text: string) => void;
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
    shortcuts,
    onCursor,
    onReady,
  }: Props = $props();

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
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
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

    // Opening straight into rich text should not need a second frame.
    untrack(() => {
      if (rich) instance.dispatch({ effects: setRichText.of(true) });
    });

    view = instance;
    untrack(() => {
      loadedDocId = docId;
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
  $effect(() => {
    if (!view || docId === loadedDocId) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      selection: { anchor: 0 },
    });
    loadedDocId = docId;
  });

  $effect(() => {
    // An effect rather than a reconfigure: switching view must not rebuild the
    // editor, or the caret and the undo history go with it.
    view?.dispatch({ effects: setRichText.of(rich) });
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
  }

  /* Zoom applies whether or not the page is showing: someone reading a long
     document wants larger text on a full-width pane too. */
  .editor :global(.cm-content) {
    font-size: calc(var(--yaz-font-size-base) * var(--yaz-zoom, 1));
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

  .editor.paged :global(.cm-content) {
    inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    max-inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    min-block-size: calc(var(--yaz-page-height) * var(--yaz-zoom, 1));
    box-sizing: border-box;
    /* A typical one-inch margin, so the measure on screen is close to the
       measure on paper. */
    padding: 25mm 25mm;
    margin-block: var(--yaz-space-4);
    background: var(--yaz-bg-primary);
    box-shadow: 0 2px 12px var(--yaz-pdf-page-shadow);
  }

  .editor.paged :global(.cm-gutters) {
    background: transparent;
    border: none;
  }
</style>
