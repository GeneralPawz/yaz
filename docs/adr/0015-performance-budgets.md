# 0015 — Performance budgets enforced in CI

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

"Performant, not RAM hungry" is a stated goal, and goals stated that way are not
achievable — they cannot be tested, so they lose every argument against a feature
that is concrete. Performance then degrades the way it always does: no single
change is responsible, each is individually defensible, and a year later the
application is slow and nobody can point at when.

The pressure here is structural. [0002](0002-application-shell-tauri.md) chose a
webview for the plugin ecosystem, knowingly giving up the memory floor of a
native GUI. Having spent that, we cannot also be careless.

## Decision

**Numeric budgets, measured by an automated benchmark suite on every pull
request, on both architectures. Exceeding a budget fails the build.**

### Budgets (initial; revised only by amending this ADR)

| Metric | Budget | Conditions |
| --- | --- | --- |
| Cold start to interactive | < 1000 ms | Release build, no project open |
| Open a 50-file, 500-page project | < 2000 ms | Warm cache, to editable state |
| Idle RSS | < 420 MB | Whole process tree, no project open |
| RSS with 10 documents open | < 600 MB | Same project |
| Keystroke to paint | < 16 ms (p99) | 5000-line document, visual mode on |
| Mode toggle (source ↔ visual) | < 100 ms | 5000-line document |
| Full-text project search | < 200 ms | 50-file project |
| Installer size | < 40 MB | Per platform/architecture |

**Keystroke latency is the budget that matters most.** Everything else is
noticed once per session; typing latency is noticed continuously, and it is the
difference between a tool that feels like an editor and one that feels like a
web page.

### Amendment, 2026-08-14: the memory budgets were wrong

The original idle budget was 150 MB, derived from the estimate in
[ADR-0002](0002-application-shell-tauri.md) that a Tauri application would sit
"roughly 60–120 MB RSS". **Measurement of a real window showed 384 MB** —
production build, `aarch64-pc-windows-msvc`, idle with no project open:

| Process | RSS |
| --- | --- |
| `yaz.exe` (the Rust core) | 28 MB |
| 6 × `msedgewebview2.exe` | 356 MB |
| **Total** | **384 MB** |

The first attempt at this measurement read 368 MB and was invalid: it was taken
against a binary built with bare `cargo build --release`, which produces a *dev*
Tauri binary that never embeds the frontend, so the webview was rendering an
error page rather than the application. Measure only what `pnpm app:build`
produces, and confirm the binary is a production one before trusting a number
from it — `docs/contributing/setup.md` describes the check.

The Rust side is comfortably small and was never the problem. The estimate was
wrong about the webview: a Chromium-based WebView2 instance splits into browser,
GPU, network, storage, renderer and crashpad processes, and that floor is
inherent to the shell decision rather than to anything we wrote. Note the
measurement must walk the process tree from our own PID — counting every
`msedgewebview2.exe` on the machine sweeps in other applications' webviews and
yields a number several times too large.

The budgets are therefore raised to **420 MB idle** and **600 MB with ten
documents open** — the measured baseline plus headroom, which is what a budget
is for. This is recorded rather than quietly adjusted, exactly as the enforcement
rules below require.

**What this does not mean.** It is not a licence to drift further. 420 MB is a
ceiling to be defended and ideally clawed back, and the reduction avenues have
not yet been tried: WebView2 exposes a memory-usage target level, pdf.js is
currently parsed eagerly in the main bundle when it need not be, and core plugins
are not yet lazily loaded. Each should be measured before the budget is treated
as settled.

**It also does not invalidate [ADR-0002](0002-application-shell-tauri.md).** That
decision rested on the plugin ecosystem, not on memory — a native Rust GUI would
cost roughly 40 MB and have no ecosystem at all. But the ADR's stated figure is
now known to be wrong by a factor of three, and anyone reasoning from it should
read this amendment instead.

### Method

- Benchmarks live in `benches/` (Criterion for Rust) and `apps/desktop/bench/`
  (scripted UI interaction for frontend metrics), over fixture projects in
  `tests/fixtures/` that are versioned and representative — including one
  deliberately awful 800-page thesis.
- **Run on native x86_64 and ARM64 runners** ([0014](0014-target-platforms-and-arm64.md)).
  A budget met only on x86_64 is not met.
- Results are tracked over time and published to the docs site, so the trend is
  visible rather than only the current pass/fail.
- **Regressions fail the pull request.** A change that needs more budget must
  amend this ADR in the same pull request, with the reasoning. The purpose is not
  to make budgets immovable but to make raising them a visible, argued decision
  rather than an accumulation of unnoticed drift.
- Noisy-neighbour variance on shared runners is handled with warmup, repeats and
  medians, and a tolerance band — a flaky performance gate gets disabled by
  whoever it blocks, which is worse than not having one.

### Design rules that follow

- **Core plugins are lazily loaded.** A disabled or unused plugin costs no
  startup time and no memory ([0005](0005-extensibility-tiers.md)).
- **The IPC boundary is not on the keystroke path.** The buffer lives in the
  webview; Rust does filesystem, compilation, and indexing work asynchronously
  and in batches ([0002](0002-application-shell-tauri.md)).
- **Long lists are virtualised.** A bibliography of 20,000 entries renders the
  visible rows only.
- **Project indexing is incremental and off the main thread**, in Rust.
- **A plugin doing long main-thread work is detectable**, attributed by name, and
  surfaced — we cannot prevent it, but the user should know which plugin made
  their editor stutter.

## Consequences

- Performance is a build gate rather than an aspiration, and regressions are
  attributed to the change that caused them while it is still in review.
- The budgets constrain design in useful, specific ways — the rules above follow
  directly from them rather than from taste.
- Building and maintaining the benchmark suite is real work that produces no user
  features, and it must exist before the application is large enough to need it.
- Benchmarks on shared CI runners are inherently noisy, and the tolerance band
  means small regressions can hide. Trend tracking is the mitigation.
- CI time increases; benchmarks run on pull requests to `main`, not on every push
  to every branch.
- Some budgets above are guesses made before the code exists. They will be wrong
  in both directions and are expected to be amended — with reasoning recorded,
  which is the point.

## Alternatives considered

**Profile when it feels slow.** The default. Rejected because by then the causes
are numerous, entangled, and expensive to unpick, and nobody can identify which
change was responsible.

**Track metrics without failing the build.** Visibility without enforcement.
Rejected: a dashboard nobody is obliged to look at is a dashboard nobody looks
at. The forcing function is the point.

**Adopt another editor's published numbers as targets.** Rejected as
uncomparable — different architecture, different feature set, different measuring
method. Our own fixtures and our own method, tracked over time, are what tell us
whether *we* are getting worse.
