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

### A third engine, and why it is not a third LaTeX engine

**Typst** is being trialled behind the `typst-engine` feature. It is a complete
typesetting system in Rust, embeddable exactly as Tectonic is, and it needs no
system C libraries at all — no vcpkg, no ICU4C, no half-hour dependency build,
and it is native on every architecture without effort.

It is not, however, interchangeable with the other two. **Typst is a different
document language.** Tectonic and the system engines are two ways to typeset the
same `.tex`; a Typst project is written in `.typ`. Presenting all three as
equivalent options in one picker would be the single easiest way to make this
feature incomprehensible, so `EngineChoice::language` exists and selecting an
engine whose language does not match the project's entry document is **refused**
rather than attempted. A parse error is not a useful answer to "why did my
document stop building".

The reason to have it: for someone writing from their own notes rather than
filling in a publisher's template, Typst is plausibly the better tool — far
smaller, far faster, with incremental compilation. It buys nothing for anyone who
needs `elsarticle.cls`, which is exactly why it is an addition and the LaTeX path
is untouched.

This also closes off a question that would otherwise keep being asked: whether to
reimplement the whole stack in Rust. Every *supporting* library has a credible
Rust replacement — Typst ships them all in production — but the TeX engine itself
does not, and bit-compatible macro semantics are the entire requirement for
journal templates. The [roadmap](https://generalpawz.github.io/yaz/roadmap)
records the analysis. Adding Typst gets the lean pure-Rust path without a
reimplementation the ecosystem has repeatedly attempted and abandoned.

### Two published builds

Because the trade is genuine rather than a default with a workaround, both are
released for every platform:

| Build | Contains | Installer | For |
| --- | --- | ---: | --- |
| **yaz** (`full`) | Tectonic embedded | ~14 MB | Almost everyone. Compiles immediately, nothing to install |
| **yaz-slim** | No embedded engine | ~3 MB | People who already have TeX Live or MiKTeX, or who need `pdflatex`/`lualatex` |

`full` carries the plain name deliberately: it is what someone downloading yaz
for the first time should get, because it works without first installing a
gigabyte of TeX. `slim` is the informed choice, not the default.

Both share a product identifier, so a machine has one yaz rather than two. That
places a requirement on the updater, recorded in
[0013](0013-update-distribution.md): update manifests are keyed by **variant as
well as architecture**, because updating a `full` installation to a `slim` build
would silently remove the user's LaTeX engine.

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

  **Measured, 2026-08-14, `aarch64-pc-windows-msvc`:**

  | Artefact | Without Tectonic | With Tectonic | Added |
  | --- | ---: | ---: | ---: |
  | `yaz.exe` | 6.27 MB | 50.46 MB | **+44.19 MB** |
  | Installer (NSIS) | 2.84 MB | 13.82 MB | **+10.98 MB** |

  So the embedded engine costs roughly **44 MB in the binary and 11 MB in the
  download**, the latter being smaller because the installer compresses. Still
  comfortably inside the 40 MB installer budget in
  [0015](0015-performance-budgets.md).

  For context on what that buys: a minimal TeX Live is several hundred megabytes
  and a full one is multiple gigabytes, so 44 MB for a self-contained engine is a
  good trade — and the user downloads it once rather than installing a
  distribution.

  Measure this from a **linked application**, never from a library build or a
  toy example. An earlier attempt used an example that referenced only
  `id()` and `is_available()`; neither reaches any Tectonic code, the linker
  discarded the engine, and the probe reported *zero bytes added on
  linux-aarch64*. Dead-code elimination happens at link time, so anything short
  of a real binary that actually calls into the engine measures nothing.

- The first local build of the vcpkg dependencies took about 25 minutes, and the
  whole pipeline including the application about 34. That is a one-time cost per
  machine, but it is a real barrier for contributors on Windows and worth saying
  out loud rather than discovering.
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
