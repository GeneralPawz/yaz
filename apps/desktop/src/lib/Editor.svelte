<script lang="ts">
  import { EditorState, Compartment } from "@codemirror/state";
  import {
    EditorView,
    keymap,
    lineNumbers,
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

  interface Props {
    /** Buffer contents. Changing this to a different file replaces the document. */
    doc: string;
    /** Which file this buffer belongs to; used to decide replace-vs-update. */
    docId: string;
    onChange: (text: string) => void;
    onSave: () => void;
    vimMode: boolean;
  }

  let { doc, docId, onChange, onSave, vimMode }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let loadedDocId = "";

  const vimCompartment = new Compartment();

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
      lineNumbers(),
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
      syntaxHighlighting(yazHighlight),
      yazTheme,
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ];
  }

  $effect(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        // Vim goes in a compartment so it can be toggled without rebuilding the
        // document, which would lose the undo history and cursor.
        extensions: [vimCompartment.of(vimMode ? vim() : []), ...baseExtensions()],
      }),
    });
    loadedDocId = docId;
    return () => {
      view?.destroy();
      view = undefined;
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
    view?.dispatch({
      effects: vimCompartment.reconfigure(vimMode ? vim() : []),
    });
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    block-size: 100%;
    inline-size: 100%;
    overflow: hidden;
  }
</style>
