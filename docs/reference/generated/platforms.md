<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# Supported platforms

Generated from the CI build matrix, so this cannot claim support for something
that is not actually built and tested.

| OS | Architecture | CI runner | Build |
| --- | --- | --- | --- |
| linux | `x86_64` | `ubuntu-24.04` | native |
| linux | `aarch64` | `ubuntu-24.04-arm` | native |
| windows | `x86_64` | `windows-2022` | native |
| windows | `aarch64` | `windows-11-arm` | native |

ARM64 is **tier 1**, not best-effort: every one of these is built and tested on a
runner of its own architecture, never cross-compiled and never under emulation.
A dependency without a native `aarch64` path is a blocker rather than a caveat,
and performance budgets are measured on ARM64 as well as x86_64 — a budget met
only on x86_64 is not met.

See [ADR-0014](/adr/0014-target-platforms-and-arm64).
