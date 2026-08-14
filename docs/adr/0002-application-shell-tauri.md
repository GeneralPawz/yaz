# 0002 — Application shell: Tauri v2 over Electron and pure-Rust GUI

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

yaz must simultaneously satisfy requirements that pull in opposite directions:

- A **Rust backend** (project constraint).
- A **third-party plugin ecosystem** on the Zotero/Obsidian model: an author
  writes an extension, publishes a GitHub repository, and a user installs it —
  including installing from a local file.
- A **serious text editor**: syntax highlighting, autocompletion, line numbers,
  Vim, *and* a rich-text mode. Real manuscripts bring complex text: ligatures,
  IME for CJK, bidirectional text for Arabic and Hebrew.
- **Modest memory use**, on Linux and Windows, on x86_64 and ARM64.

The memory requirement pulls towards a native Rust GUI. The other two pull hard
the other way.

## Decision

We build on **Tauri v2**: a Rust core process that owns all privileged work,
driving the operating system's own webview (WebView2 on Windows, WebKitGTK on
Linux, WKWebView on macOS later) for the user interface.

## Consequences

**The plugin ecosystem becomes possible.** Plugins are JavaScript/TypeScript:
`manifest.json` plus a bundled `main.js`. An author needs no compiler, no
cross-platform build matrix, and no per-architecture artefacts. This is the
single strongest reason for the decision and it is why the memory argument does
not win.

**We inherit a mature text stack.** CodeMirror 6, KaTeX, and pdf.js exist, are
maintained, and solve problems (bidi, IME, incremental highlighting, accessible
selection) that would each be a multi-month project natively. See
[0004](0004-editor-core-codemirror-single-buffer.md).

**Memory sits in the middle, not at the bottom.** Expect roughly 60–120 MB RSS
for a loaded project, against ~40 MB for a native Rust GUI and 300 MB+ for
Electron. We do not ship a browser engine; we borrow the one the OS already
loaded. Budgets are set and enforced in [0015](0015-performance-budgets.md).

**ARM64 stays genuinely native.** WebView2 and WebKitGTK both ship native
aarch64 builds, so no part of the shell is emulated. See
[0014](0014-target-platforms-and-arm64.md).

**We accept webview fragmentation as a real, recurring cost.** WebKitGTK on
Linux lags Chromium-based WebView2 on Windows in CSS and JS support. Every
frontend feature must be verified on both. We pin a documented minimum WebKitGTK
version and test it in CI rather than discovering breakage from bug reports.

**The Rust/JS boundary must be designed, not accumulated.** Every crossing is
serialisation. Chatty per-keystroke IPC will destroy the latency budget. The
rule: the editor buffer lives in the webview and is authoritative for editing;
Rust owns the filesystem, compilation, indexing, and all network and process
access. Bulk data crosses rarely and in batches.

## Alternatives considered

**A pure-Rust GUI (egui, Iced, Slint, Dioxus native, GPUI).** Rejected on two
independent grounds, either of which is disqualifying.

*Plugins.* A third-party plugin wanting to draw UI would ship a native dynamic
library per OS × architecture, compiled against our exact compiler version and
linked over an unstable Rust ABI. Realistically nobody ships those, and the
ecosystem never forms. WebAssembly plugins solve isolation but not user
interface: they cannot touch a Rust-native widget tree without us inventing and
maintaining a complete widget-over-FFI protocol.

*Text.* No Rust GUI toolkit has a text editing component near what this project
needs. We would be writing a text editor engine — highlighting, folding,
completion, bidi, IME, plus a WYSIWYG mode — as a prerequisite to writing the
actual application.

**Electron.** Straightforwardly better DX and the most predictable rendering
across platforms, since Chromium ships with the app. Rejected on memory: a
baseline several times our budget, directly contradicting a stated requirement.
It also does not give us a Rust backend without running a second process.

**Native GUI with an embedded webview only for the editor pane.** Keeps chrome
native and memory low while retaining CodeMirror. Rejected because it produces
the worst plugin story of all: plugins could extend the editor pane but not the
surrounding application, and we would still maintain a native widget layer.
