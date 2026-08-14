# 0014 — Target platforms and the native ARM64 policy

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The requirement is Linux and Windows now, macOS later, on x86_64 and ARM64 —
with ARM64 that genuinely uses the hardware rather than "an x86_64 build made to
work through emulation".

This is not an abstract concern. On Windows-on-ARM, x86_64 binaries run under
emulation transparently enough that a project can ship an x64-only build,
observe that it works, and never notice it is leaving most of the machine's
performance unused. The failure mode is silent, which is what makes it worth an
explicit policy rather than an intention.

The commonest way it happens is a single dependency: one crate with a
hand-written x86 intrinsic and no `aarch64` path, one npm package shipping a
prebuilt `.node` for x64 only, one external tool available only as x64 — and the
whole application is pinned to emulation.

## Decision

**ARM64 is a first-class target. Every artefact we publish for an ARM platform
is a native ARM binary through its entire dependency chain. We do not ship an
emulated fallback, ever.**

### Shipping matrix

| Platform | Architecture | Status | Webview |
| --- | --- | --- | --- |
| Windows 10/11 | x86_64 | Tier 1 | WebView2 |
| Windows 11 | aarch64 | **Tier 1** | WebView2 (native ARM64) |
| Linux | x86_64 | Tier 1 | WebKitGTK |
| Linux | aarch64 | **Tier 1** | WebKitGTK |
| macOS | aarch64 / x86_64 | Planned | WKWebView |

Tier 1 means: built in CI, tested in CI, released together, and a break on any of
them blocks the release. ARM64 is not a best-effort extra.

### Enforcement

- **CI builds and tests ARM64 on native ARM64 runners** — `ubuntu-24.04-arm` and
  Windows ARM runners — not through cross-compilation or QEMU. Emulated CI hides
  exactly the problems this policy exists to catch, and makes performance
  measurement meaningless.
- **A dependency without a native `aarch64` path is a blocker, not a caveat.**
  Before adopting any dependency we check it builds and runs natively on ARM64.
  If it does not, we find another or write the missing piece — we do not ship an
  x64 build to work around it.
- **The performance budgets in [0015](0015-performance-budgets.md) are measured
  on ARM64 as well as x86_64.** A budget met only on x86_64 is not met.
- **The updater is architecture-exact.** An `aarch64` installation is never
  offered an `x86_64` artefact ([0013](0013-update-distribution.md)).
- Architecture-specific optimisation is written portably — `std::simd` or
  explicitly-guarded `aarch64` and `x86_64` paths with a scalar fallback. An
  `x86_64`-only fast path with no NEON equivalent is an incomplete change.
- The default LaTeX engine is native on every architecture, which is one of the
  reasons Tectonic is embedded rather than a system distribution shelled out to
  ([0007](0007-latex-compilation-engines.md)) — system TeX on Windows-on-ARM is
  typically an emulated x64 build.

### macOS

Deferred, not designed out. The constraint accepted now: nothing may assume two
platforms. Path handling, keyboard modifiers, menu structure, and packaging are
abstracted from the start, because retrofitting a third platform through
`if windows { } else { }` branches spread across a codebase is the expensive way.

## Consequences

- ARM64 users get the performance of their hardware. On a modern ARM laptop this
  is a substantial, user-visible difference, particularly in compilation.
- Dependency selection is genuinely constrained, and we will occasionally reject
  a good library or do work upstream to make it portable.
- CI cost and complexity roughly double: four build/test jobs rather than two.
  Native ARM runners are available on GitHub-hosted infrastructure and are free
  for public repositories ([0018](0018-licensing.md) keeps the repository public).
- Release engineering must handle four artefacts atomically. A green x86_64 build
  and a failed ARM64 build is a failed release.
- Contributors on x86_64 machines cannot fully verify ARM64 behaviour locally.
  CI is the authority, and this must be visible in pull request checks.
- **Windows-on-ARM development requires the ARM64 MSVC toolchain component**
  (`Microsoft.VisualStudio.Component.VC.Tools.ARM64`), which is not installed by
  default even on ARM64 machines. `docs/contributing/setup.md` states this,
  because the resulting linker error is not self-explanatory.

## Alternatives considered

**x86_64 only, rely on emulation for ARM.** Halves the matrix and works. Rejected
as the explicit non-goal of this project: it wastes the hardware, and on
compile-heavy workloads the loss is large.

**Cross-compile ARM64 from x86_64 runners.** Cheaper CI. Rejected because it
produces untested binaries — cross-compilation catches compile errors and nothing
about runtime behaviour — and yields no performance data at all.

**QEMU-emulated ARM64 CI.** Would at least run the tests. Rejected: slow enough
to dominate CI time, and performance numbers from it are meaningless, so it fails
the requirement that budgets be enforced on ARM.

**ARM64EC on Windows.** Allows mixing ARM64 and emulated x64 code in one process,
useful for an x64-only dependency. Rejected as precisely the "fake ARM" this
policy rules out. It stays available as an emergency measure, and using it would
require a superseding ADR.
