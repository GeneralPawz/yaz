# 0006 — Plugin runtime and capability-based security

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Community plugins are arbitrary code from strangers, running on machines that
hold unpublished research, and — via Zotero and Obsidian integration — pointed
directly at the user's entire literature library and personal notes. That is an
attractive target.

There is a genuine tension. Plugins that can build real UI need DOM access, and
DOM access inside our own window means a plugin can read and alter anything the
application shows. Plugins that are properly isolated cannot draw. Obsidian
resolves this by granting full trust and relying on community review. Its
ecosystem is excellent, which shows the model works socially; it also means one
compromised popular plugin is a total compromise of every user who installs it.

## Decision

**Plugins are JavaScript/TypeScript running in the application's webview context
with full DOM access, but every privileged operation crosses into Rust, where a
capability broker enforces a manifest-declared permission set plus explicit user
grants.**

### The boundary

Plugins get no ambient authority. There is no `fetch`, no `XMLHttpRequest`, no
WebSocket, no direct Tauri IPC handle in a plugin's scope. All of it is removed
before plugin code runs. What a plugin has is the `App` object from `@yaz/api`,
whose privileged methods are thin wrappers over IPC calls that Rust brokers.

**The security boundary is the Rust process, not the JavaScript context.** This
is the load-bearing claim of this ADR. A plugin cannot reach the filesystem,
the network, or a subprocess except through a Rust call that checks its
identity, its manifest, and the user's grants.

### Capabilities

Declared in `manifest.json`, granted by the user at install time, revocable
individually at any time in settings:

| Capability                                 | Grants                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| `fs:project`                               | Read/write within the open project root                      |
| `fs:read` / `fs:write`                     | Access to declared paths outside the project                 |
| `net`                                      | HTTP to explicitly declared host patterns — never a wildcard |
| `process`                                  | Execute declared binaries, argument-validated                |
| `zotero`                                   | The Zotero bridge API                                        |
| `obsidian`                                 | Vault access through the Obsidian bridge                     |
| `clipboard`, `notifications`, `shell:open` | As named                                                     |

Rules enforced by the broker: paths are canonicalised and symlink-resolved
before any check, so `..` traversal and symlink escapes fail; network hosts are
matched against the declared list, not merely logged; every denial is recorded in
a log the user can inspect.

### What this does not protect against — stated plainly

A plugin sharing the DOM can read the open manuscript, observe keystrokes,
overlay fake UI, and call another plugin's exported functions. **Capabilities
constrain what leaves the machine and what touches the disk; they do not isolate
a plugin from the application's own interface.** A malicious plugin without `net`
cannot exfiltrate, but it can corrupt what you see and, with `fs:project`,
what you save. We document this, in these terms, in the plugin security page —
overstating the guarantee would be worse than not having it.

### Supporting measures

- Plugins are disabled by default in a new install; enabling requires an
  explicit action with the capability list shown.
- A **restricted mode** loads no community plugins at all, for opening untrusted
  projects.
- A plugin's declared capabilities are shown at install _and_ re-confirmed when
  an update requests capabilities the installed version did not have. Silent
  privilege escalation through auto-update is the most likely real attack, and
  [0013](0013-update-distribution.md) blocks it.
- Uncaught plugin errors are contained, attributed to the plugin by name, and
  offer to disable it, rather than taking down the window.

## Consequences

- Plugin authors write ordinary TypeScript with ordinary DOM APIs — the low
  barrier that makes an ecosystem possible — while the operations that can
  actually harm a user are gated.
- We are meaningfully safer than the pure-trust model without paying its
  usual price in plugin capability.
- Every privileged API needs a broker implementation on the Rust side, and the
  broker is now security-critical code: a path-canonicalisation bug is a
  sandbox escape. It gets adversarial tests, including traversal and symlink
  cases, as a matter of course.
- Capability prompts are user friction. We reduce it by asking once at install
  with a clear list, not per call, and by keeping the capability vocabulary small
  enough to be readable by a non-programmer.
- Plugins doing heavy computation share the UI thread. The API therefore offers
  a worker mechanism, and we treat long main-thread work by a plugin as a bug we
  can detect and surface.

## Alternatives considered

**Obsidian's model — full trust, no gate.** Least friction, proven at scale.
Rejected because the incremental cost of brokering is moderate and the incremental
protection is large, given that our target users hold unpublished work and we
deliberately point plugins at their entire reference library.

**An isolated JavaScript runtime (QuickJS, or a separate Deno-style isolate).**
Genuine isolation with capability-gated APIs. Rejected because plugins lose DOM
access, so every UI extension must be expressed through a constrained message
protocol that we design, document, and extend forever. It converts "write some
TypeScript" into "learn our bespoke UI protocol", which is how ecosystems fail to
form. The security gain over this decision is real but narrower than it looks: it
protects against UI tampering, while both designs gate disk and network equally.

**WebAssembly plugins.** Strongest isolation, language-agnostic. Rejected on
author experience: a real toolchain and build step per plugin, and poor DOM
ergonomics. Not ruled out for a future _compute_ plugin type — a citation-style
processor or exotic parser — where isolation matters and no UI is involved.

**Native dynamic-library plugins.** Rejected in [0002](0002-application-shell-tauri.md):
unstable ABI, per-platform build matrix, and no isolation at all.
