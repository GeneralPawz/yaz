# Choosing an engine

yaz can typeset with an **embedded** engine or with a **TeX distribution you
already have**. Neither is a fallback for the other, and the choice is per
project rather than global, because journal templates frequently require a
specific typesetter.

## The two options

### Tectonic (embedded)

A complete TeX engine compiled into yaz. Nothing to install, and it fetches only
the support files a document actually needs.

- **Requires nothing.** A fresh install compiles immediately.
- **Native on every architecture**, including ARM64 — which matters, because a
  system TeX distribution on Windows-on-ARM is typically an x86_64 build running
  under emulation.
- **It is XeTeX-based, and cannot be `pdflatex`.** A template that specifically
  requires pdfTeX or LuaTeX needs the system engine.
- The first compile of a document downloads support files, so it needs network
  access once. Later runs use the shared cache.

Tectonic is a compile-time feature. A build without it **cannot be given it by
changing a setting** — the engine has to be linked in. The picker says so rather
than hiding the option, because "not included in this build" is actionable and a
silent absence is not.

### System TeX (TeX Live, MiKTeX)

Whatever is installed on the machine, driven through `latexmk` when available so
that multi-pass runs, BibTeX invocation and `.aux` settling are handled by a tool
that has solved those problems well.

- **`pdflatex`, `xelatex` and `lualatex`** all available, so publisher templates
  work as written.
- Requires a TeX distribution — often a gigabyte or more.
- On Windows-on-ARM it is usually emulated, so it is slower than it looks.

## How the choice is stored

Selecting an engine writes `yaz.toml` into the project root:

```toml
entry = "main.tex"
engine = "system:xelatex"
```

A flat string rather than a nested table, because the file is meant to be edited
by hand. Valid values are `tectonic` or `system:<binary>`.

Because it lives with the project rather than in your personal settings, a
co-author who opens the same directory compiles the same way you do. That is the
point: a manuscript that builds differently depending on who opened it is a
manuscript nobody can review.

## Engines are refused, never substituted

If a project is pinned to `lualatex` and `lualatex` is not installed, the compile
**fails and says so**. yaz will not quietly use a different engine, and an
unrecognised name in a hand-edited `yaz.toml` is rejected rather than guessed at.

This looks unhelpful for about five seconds and is the right behaviour: a
silently different engine produces a subtly different PDF — different fonts,
different line breaks, sometimes different pagination — and discovering that
after submission is considerably worse than an error message.

See [ADR-0007](/adr/0007-latex-compilation-engines).
