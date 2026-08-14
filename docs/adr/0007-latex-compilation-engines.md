# 0007 — LaTeX compilation: Tectonic by default, system TeX as a peer

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Two requirements pull apart here.

**Onboarding.** A user should install yaz and compile a document. Requiring them
to first install a multi-gigabyte TeX distribution, and then diagnose why a
package is missing, loses most people before they ever see the product.

**Template fidelity.** A stated goal is that a user can drop in a template from a
journal or conference and it works. Those templates are not written against an
idealised LaTeX. They assume `pdflatex` or `lualatex` specifically, obscure
packages, sometimes `--shell-escape`, sometimes a `Makefile`. A template that
compiles at the publisher and not in yaz is a bug in yaz.

No single engine satisfies both. Tectonic gives us the first: a self-contained
Rust implementation that fetches only the packages a document needs, with no
system installation. It does not give us the second, because it is XeTeX-based
and cannot be `pdflatex`.

Relevant to this project specifically: system distributions are frequently not
native on ARM64. A Windows-on-ARM machine typically runs an x64 MiKTeX under
emulation, which is both slower and contrary to [0014](0014-target-platforms-and-arm64.md).

## Decision

**A pluggable engine abstraction in `yaz-compile`, with Tectonic embedded as the
default and system TeX distributions supported as first-class peers.**

- `yaz-compile` defines a `CompileEngine` trait. Invocation, log parsing,
  diagnostics, artefact paths, and SyncTeX handling are engine-independent.
- **Tectonic** is embedded as a Rust crate — in-process, no subprocess, native on
  every architecture we ship, and it resolves its own multi-pass runs. It is the
  default for new projects and requires nothing of the user.
- **System TeX** (TeX Live, MiKTeX) is detected at startup on all platforms. When
  present it is offered as an engine, driven through `latexmk` where available so
  we inherit its dependency resolution rather than reimplementing it.
- **Engine selection is per project**, persisted in the project file, and
  overridable per build. Importing a template can set it: a template declaring
  `pdflatex` selects a system engine and says so, rather than failing obscurely
  under Tectonic.
- **Log parsing is shared and structured.** TeX logs are parsed into typed
  diagnostics with file/line attribution and mapped back onto editor ranges. This
  is engine-independent because TeX's log format, for all its faults, is not.
- `--shell-escape` is **off by default and requires explicit per-project opt-in
  with a warning**, since it grants arbitrary code execution to a document.

## Consequences

- The default path is: install, open, compile. No TeX distribution required.
- On ARM64, the default engine is genuinely native — a real speed improvement
  over an emulated system distribution, and the only way to honour the ARM policy.
- Templates needing `pdflatex`, `lualatex`, or unusual packages work, provided
  the user has a system distribution. We detect its absence and say precisely
  that, rather than reporting a confusing compile error.
- Two engines means two sets of behaviour to test. The engine abstraction is
  tested against both, and the template corpus in `tests/templates/` is compiled
  under each in CI.
- Embedding Tectonic pulls a substantial dependency tree into the binary and
  increases build times and artefact size. Accepted: it is what removes the
  install barrier.
- Tectonic's first compile of a document downloads packages, so it needs network
  access and a visible progress state. Its package cache is warmed on first run
  and shared across projects. Fully offline first-use is a known limitation; a
  bundled minimal package set is possible later.
- We must track Tectonic's compatibility gaps and report them as such, rather
  than letting the user conclude their document is broken.

## Alternatives considered

**System TeX only.** What most LaTeX editors do. Rejected on onboarding, and
because it makes the ARM story dependent on distributions we do not control.

**Tectonic only.** Cleanest architecture and the best ARM story. Rejected on
template fidelity, which is a stated product goal — no `pdflatex`, and packages
that are incompatible in practice.

**Bundle a full TeX Live.** Guarantees fidelity and offline use. Rejected on
size: multiple gigabytes per platform per architecture, which is untenable for
download, update, and CI, and would dominate the release pipeline.

**Server-side compilation.** Overleaf's model. Rejected as contrary to the
product: yaz is a local application over local files, users hold unpublished
work, and it would introduce hosting costs and an availability dependency.
