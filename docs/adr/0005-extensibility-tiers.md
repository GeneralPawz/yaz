# 0005 — Extensibility tiers: core, core plugins, community plugins

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The boundary between "application feature" and "plugin" has to be drawn before
features are written, not after. Drawn late, it is drawn by accident: whatever
happened to be built first becomes core, the plugin API is retrofitted to
whatever core happens to expose, and it is discovered to be inadequate only when
the first external author tries to use it.

Obsidian's three-tier structure is the model worth copying, and the reason it
works is not the tiers themselves — it is that first-party bundled features are
built on the *same public API* that community authors get.

## Decision

Three tiers, with a hard rule attached to the middle one.

### Tier 1 — Core

Non-negotiable. No plugin may replace it, and it is the substrate everything else
is written against.

| Area | Responsibility |
| --- | --- |
| Editor host | The CodeMirror instance, its extension registry, the buffer/document lifecycle |
| Document & file I/O | Reading, writing, atomic saves, encoding detection, external-change reconciliation |
| Project model | What a project is, its root, its file tree, its build entry points |
| Compile orchestration | Engine abstraction, invocation, log parsing, artefact management ([0007](0007-latex-compilation-engines.md)) |
| PDF host | The viewer surface and page lifecycle |
| Plugin runtime | Loading, lifecycle, capability broker, permission grants ([0006](0006-plugin-runtime-and-capabilities.md)) |
| Settings store | Schema, persistence, migration, the settings UI host |
| Theme engine | CSS custom property contract, theme loading and hot reload ([0010](0010-theming.md)) |
| i18n runtime | Catalogue loading, message resolution, locale fallback ([0011](0011-localisation.md)) |
| Command registry | Named commands, the palette, and the keymap layer including the Vim host |
| Workspace | Pane layout, tabs, split views, view registration |
| Updater | Application and plugin updates ([0013](0013-update-distribution.md)) |

The test for core membership: *would the application be incoherent without it, or
does more than one plugin need to depend on it?*

### Tier 2 — Core plugins

Bundled with the application, enabled by default or opt-in, maintained by us,
individually toggleable — **and written strictly against the public plugin API,
with no privileged access whatsoever.**

| Core plugin | Notes |
| --- | --- |
| `vim` | Vim keybindings, on the core keymap API |
| `zotero` | Library search, citation insertion, `.bib` sync ([0008](0008-zotero-integration.md)) |
| `obsidian` | Vault browsing, Markdown → LaTeX ([0009](0009-obsidian-integration.md)) |
| `bibliography` | `.bib` management, deduplication, key hygiene |
| `outline` | Document structure navigator |
| `templates` | Import and manage journal/conference templates |
| `git` | Version history, diff, commit |
| `synctex` | Forward and inverse search between source and PDF |
| `spellcheck` | Dictionaries and LanguageTool integration |
| `tables` | Table editing affordances in visual mode |
| `figures` | Asset import, placement, and management |
| `export` | DOCX/HTML/Markdown export |
| `snippets` | Symbol palette, snippet expansion |
| `stats` | Word count, readability, progress tracking |

**The rule: a core plugin that needs an API which does not exist yet gets the API
added to core as public API — never a private back door.** This is the entire
point of the tier. Shipping the Zotero bridge and Vim as core *plugins* means the
plugin API is exercised by demanding, real features from month one, and its
inadequacies surface to us before they surface to an external author.

### Tier 3 — Community plugins

Third-party, installed from a GitHub release or from a local file, listed in a
separate `yaz-releases` index repository. Identical API to tier 2.

## Consequences

- The plugin API cannot quietly become a second-class citizen, because our own
  headline features stop working if it does.
- Users can disable substantial parts of the application. A user who does not
  use Zotero pays nothing for it — no memory, no startup cost — which serves the
  performance goals directly.
- Core plugins must be lazily loaded and must not be assumed present by other
  code, since any of them may be off.
- We are constrained in a way that costs real time: when a core plugin needs
  something, we must design a *general* API rather than the narrow thing that
  would have unblocked us. This is the price of the tier and we pay it
  deliberately.
- Moving a feature between tiers later is a breaking change for anyone depending
  on it, so the initial placement above matters and changes to it need an ADR.
- The core surface is large. We limit growth with the stated membership test, and
  treat any proposal to add to tier 1 as requiring justification against it.

## Alternatives considered

**Two tiers — core application plus community plugins.** Simpler, and the path of
least resistance. Rejected because it removes the forcing function entirely:
first-party features would be written against internals, and the plugin API would
be whatever we imagined external authors might want, validated by nobody.

**Everything a plugin, with a minimal kernel.** Architecturally elegant and
genuinely tempting. Rejected because a text editor, a file model, and a command
system are not optional; making them replaceable buys configurability nobody
asked for at the cost of an unstable foundation for every plugin.

**Core plugins with privileged internal access.** The pragmatic compromise —
bundled features get shortcuts, external ones do not. Rejected precisely because
it is the failure mode this ADR exists to prevent.
