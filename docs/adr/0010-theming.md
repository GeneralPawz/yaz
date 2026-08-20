# 0010 — Theming via CSS custom properties and user theme files

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The requirement is a dark and a light mode shipped by us, plus users writing
their own file to make the interface look how they want. Obsidian's CSS-file
theming is the reference: it produced a large theme ecosystem because the
mechanism is one every web developer already knows.

The risk is the same one that makes it powerful. If themes can restyle arbitrary
internal DOM, then our markup becomes a public API and any refactor of a
component breaks themes. Obsidian lives with exactly this.

## Decision

**A documented set of CSS custom properties is the theming contract. Themes are
CSS files in a `themes/` folder, hot-reloaded on change.**

### The contract

- A named, versioned set of custom properties on `:root` — colours, spacing
  scale, radii, typography, editor and PDF-viewer surfaces. **These are the
  supported API.** Setting them is guaranteed to work across versions.
- Every colour in the application is expressed through a semantic token
  (`--yaz-bg-primary`, `--yaz-text-muted`, `--yaz-accent`), never a literal. A
  literal colour in a component is a bug, enforced by lint.
- We ship exactly two themes, `yaz-light` and `yaz-dark`, as token sets. They are
  themes written against the same contract users get — the same forcing function
  as core plugins in [0005](0005-extensibility-tiers.md).
- **Restyling internal selectors is permitted but explicitly unsupported.** A
  theme may target any element; we will not treat breaking such a theme as a
  regression. Stated in the theming docs so authors can choose knowingly.

### Mode

Three states: `light`, `dark`, and `system` (following the OS, default). A theme
declares whether it provides both modes; if it provides one, mode switching is
disabled while it is active and the UI says why.

### Mechanics

- Themes live in `<vault-or-config>/themes/<name>/theme.css` plus a
  `manifest.json` (name, author, version, `minAppVersion`, modes provided).
- Installed from a folder, a zip, or a GitHub repository, and updated by the same
  mechanism as plugins ([0013](0013-update-distribution.md)).
- **Hot reload on file change**, so a theme author edits and sees the result
  without restarting.
- Theme CSS is injected in a fixed cascade position, after core styles and before
  plugin styles, so a plugin can style its own UI in terms of the tokens and
  inherit the active theme automatically.
- **A plugin may register additional tokens** but must provide defaults, so its
  UI is never unstyled under a theme that predates it.
- Accessibility: our two themes meet WCAG AA contrast, checked in CI. We cannot
  enforce this for user themes, but the theme development page documents how to
  check.

## Consequences

- A user with any CSS knowledge can retheme the application, and a theme author
  needs no build tooling.
- Because every component consumes tokens, adding a theme requires touching no
  component code.
- The token vocabulary must be designed carefully and early. Too few and themes
  cannot express anything; too many and it is unlearnable and we can never
  change it. It is versioned so it can grow additively.
- Once published, token names are effectively permanent. Renaming one is a
  breaking change for every theme.
- Hot reload is a small amount of extra machinery, justified entirely by theme
  author experience.
- Plugin-provided UI inherits themes automatically, which is what makes a themed
  application look coherent rather than like a patchwork.

## Alternatives considered

**A structured theme format — JSON or TOML of colour values.** Safer, since
themes could not touch internal DOM, and validatable. Rejected because it caps
what a theme can express at whatever we anticipated, and every request beyond
that becomes a feature request on us. CSS custom properties give the same
structured core with an unsupported-but-available escape hatch.

**Full CSS with no token layer** (pure Obsidian). Maximum power. Rejected because
without tokens there is no supported surface at all, every theme depends on
internal markup, and we could never refactor a component.

**A built-in visual theme editor.** Better for non-technical users. Rejected for
now as significant UI work that the token contract does not preclude adding later
— a theme editor would simply write a token file.

## Amendment — 2026-08-18: a theme provides both modes, and a builder writes one

Two things in the decision above turned out to be wrong in use.

**"A theme declares whether it provides both modes; if it provides one, mode
switching is disabled while it is active and the UI says why."** This makes
installing a theme able to take a user's dark mode away, and there is no message
that makes that acceptable. It also produced two bundled themes, `yaz-light` and
`yaz-dark`, which are not two themes — they are one theme's two halves, and
having them as separate entries meant "choose a theme" and "choose light or
dark" were the same control wearing two hats.

**A theme now provides light _and_ dark, always.** One `theme.css` with a block
per mode, selected by `data-yaz-mode` on the root; `manifest.json` declares
`"modes": ["light", "dark"]` and a manifest claiming fewer is refused at install
rather than half-applied. Choosing a theme and choosing a mode are independent,
and neither can remove the other. The bundled pair becomes one theme, `yaz`.

`system` resolves against the platform before it reaches the document, so a
stylesheet never has to express "whatever the operating system says" — which it
could only do by duplicating every rule inside a media query, in every theme.

**"A built-in visual theme editor … rejected for now as significant UI work."**
Kept as an alternative for the wrong reason: the objection was cost, and the
cost is what it is, but the argument for it is that the token contract is a
vocabulary a stranger has to learn before they can change a colour. **A builder
now ships**, editing a curated subset of the tokens with a live preview and
exporting a real bundle — the same `manifest.json` and `theme.css` a
hand-written theme has, editable by hand afterwards. It is the on-ramp to the
format, not a replacement for it, which is why it writes files rather than
storing settings.

It edits opaque colours only. `<input type="color">` cannot express the
translucent tokens — hover tints, the selection wash, the modal scrim — and
rounding them to opaque visibly breaks the surfaces they sit on. Those stay
available to anyone editing the file.

Unchanged: the token contract is still the supported API, themes are still CSS,
restyling internal selectors is still permitted and still unsupported, and the
cascade position is still fixed between core and plugin styles.
