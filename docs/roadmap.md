# Roadmap

What is built, what is next, and the one large open question about where the
typesetting engine goes.

This is a plan, not a promise. Dates are absent on purpose — the phase order
matters and the calendar does not.

## Phases

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Architecture decided and recorded, repository, CI, release automation | ✅ done |
| 2 | Walking skeleton — open a folder, edit a `.tex`, compile, see the PDF | ✅ done |
| 3 | Plugin runtime, capability broker, theme engine, i18n runtime | **next** |
| 4 | Editor depth — Lezer grammar, completion, diagnostics, Vim, visual mode | |
| 5 | Zotero and Obsidian bridges | |
| 6 | Templates, export, community registry | |

**Phase 3 comes before feature work deliberately.** Every feature after it is
built *on* the plugin API, the theme tokens and the message catalogue rather than
retrofitted onto them — and our own Zotero bridge, Obsidian bridge and Vim mode
are the first things built that way, which is how the API gets exercised by
demanding work before an external author meets it
([ADR-0005](/adr/0005-extensibility-tiers)).

### Working today

Open a folder, edit `.tex` files with line numbers, LaTeX highlighting and
optional Vim keys, save, choose an engine, compile, and read the PDF beside your
source.

### Not built yet

Visual mode, plugins, user themes, and the Zotero and Obsidian bridges.

## Engines

[ADR-0007](/adr/0007-latex-compilation-engines) treats compilation as a pluggable
backend rather than a fixed dependency. That decision is what makes the following
possible without disturbing anything else.

| Engine | Language | Status | For |
| --- | --- | --- | --- |
| **Tectonic** | LaTeX | shipping | Almost everyone. Embedded, nothing to install, native on every architecture |
| **System TeX** | LaTeX | shipping | Templates demanding `pdflatex` or `lualatex`; anyone who already has a distribution |
| **Typst** | Typst | **experimental** | A modern, fast, pure-Rust alternative for documents that are not bound to a journal's `.cls` |

### Why Typst is being tried

Typst is a complete typesetting system written in Rust, and it is available as an
embeddable library exactly as Tectonic is. For a researcher writing from their
own notes — rather than filling in a publisher's template — it is plausibly the
better tool: far smaller, far faster, and with incremental compilation.

It is not a LaTeX engine and does not pretend to be. **Typst documents are `.typ`
files in a different language.** So this is not a drop-in third choice for an
existing `.tex` project; it is a different way to write a document that happens
to share the editor, the Zotero bridge and the Obsidian bridge. That distinction
is the main thing to get right in the user interface, and the reason the engine
is behind a feature flag while it is evaluated.

What it buys, if it works out: no vcpkg, no ICU4C, no half-hour dependency build,
a far smaller binary, and a pure-Rust path that is trivially native on ARM64.

## The open question: a lean Rust engine

Tectonic embeds a large amount of C. That is the honest cost of LaTeX
compatibility, and for now it is the right cost — but it is worth writing down
what the alternative would actually involve, because the answer is unintuitive.

### Every supporting library already has a Rust replacement

Not speculatively. **Typst ships a Rust replacement for every one of them in
production**, which is the strongest available evidence that the pieces are
adequate:

| C library in Tectonic | Rust replacement | Verdict |
| --- | --- | --- |
| FreeType | `ttf-parser`, or `skrifa` — Google's FreeType replacement, shipping in Chrome | Solved |
| HarfBuzz | `rustybuzz` — a port of HarfBuzz, so behaviour matches | Solved |
| ICU4C | `icu_segmenter` / `icu_properties` / `icu_collator` (ICU4X, modular), `unicode-segmentation`, `unicode-normalization`, `unicode-script` | Solved, and this is where the size goes |
| libpng | `png` | Trivial |
| zlib | `zlib-rs` — already in our lockfile | Trivial |
| Graphite2 | none, and none needed — Typst ships without it | Delete |
| *(hyphenation)* | `hypher` — Knuth–Liang patterns, English and German included | Solved |
| *(PDF output, `xdvipdfmx`'s job)* | `pdf-writer`, `krilla` | Solved |

For English and German the Unicode story collapses almost entirely: no
bidirectional text, no Indic reordering, no CJK segmentation. That is most of the
half-hour build and most of the 44 MB.

### What would genuinely have to be written: the engine

Everything above is a library swap. **XeTeX is not.**

TeX is a macro-expansion virtual machine with roughly 350 primitives, category
codes, the box-and-glue model, Knuth–Plass line breaking, page builders,
`\halign`, output routines, and a separate math typesetting engine with its own
font metrics. Around 25,000 lines of literate Pascal, plus XeTeX's Unicode and
font extensions on top.

The algorithms are not the hard part. **Bit-compatible macro semantics are** —
because the promise is that a journal template works, and journal templates are
LaTeX packages that exercise TeX's strangest corners. LaTeX2e is roughly 50,000
lines of TeX macros before anyone reaches `elsarticle.cls`.

The prior art is unambiguous:

- [RusTeX](https://github.com/slatex/RusTeX) implements plain TeX, eTeX and
  pdfTeX primitives in Rust — and its authors describe it as experimental,
  deprecated in favour of a rewrite, and it delegates to a local TeX
  installation regardless.
- Tectonic is a Rust project, written by people who plainly could have, and
  chose to keep the C engine.
- **Typst succeeded precisely by not being TeX-compatible.**

There is also a mechanical obstacle to doing this incrementally: XeTeX is C and
reaches FreeType, HarfBuzz and ICU through their C APIs. `zlib-rs` offers a C ABI
and could drop in; the others do not. Replacing them under XeTeX is close to
all-or-nothing.

### Proposal, not plan

**Do not reimplement TeX.** The lean pure-Rust stack people want is real, and it
already exists — it is called Typst. Adding it as an engine gets the benefit
without a multi-year reimplementation that the ecosystem has repeatedly attempted
and abandoned, and it costs nothing on the LaTeX side, which stays exactly as it
is for the people who need `elsarticle.cls`.

If the Typst experiment goes well, the interesting question stops being "should
we rewrite TeX" and becomes "how much of the Obsidian-and-Zotero-to-manuscript
pipeline is engine-independent" — which is a far better question, and one the
existing engine abstraction is already shaped for.

Revisit only if Typst proves inadequate for real academic writing in a way that
LaTeX compatibility would fix. That would be a new ADR, with evidence.
