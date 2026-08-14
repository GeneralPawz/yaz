# 0011 — Localisation from the first commit

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Retrofitting localisation is one of the most reliably painful refactors in
application development: every literal string in every component must be found
and replaced, and the ones in error paths and dialogs — exactly the ones users
most need in their own language — are the ones that get missed.

The audience makes this more than a nicety. Academic writing is international,
and a substantial share of LaTeX users are not writing in English. A tool for
writing papers in any language that only speaks English about itself is an odd
artefact.

There is also a domain subtlety: the **interface** language and the **document**
language are independent. A German researcher may write in English, and needs
German menus with English spellchecking, `\usepackage[english]{babel}`, and
English quotation marks. Conflating them would be wrong.

## Decision

**Localisation is present from the first commit. A hardcoded user-facing string
is a build failure, not a code review comment.**

- **Format:** ICU MessageFormat via Fluent-style catalogues, one file per locale
  in `locales/`. ICU because plurals and gender are not optional in the languages
  we care about — a naïve `{count} items` is wrong in Polish, Russian, and Arabic.
- **`en-US` is the source of truth.** Keys are defined there; other locales are
  translations of it. A key missing in a locale falls back through the locale
  chain (`de-AT` → `de` → `en-US`) rather than rendering a raw key.
- **Enforcement is mechanical:** an ESLint rule and a Clippy lint reject literal
  user-facing strings, and CI fails on a key referenced in code but absent from
  `en-US`. The rule is the decision; without it this ADR is a wish.
- **Both sides are localised.** Rust-originated messages — compile diagnostics,
  filesystem errors, plugin failures — carry a message key and parameters across
  IPC, and are rendered in the frontend. Rust does not format user-facing prose.
- **Plugins are localisable** through the same runtime. A plugin ships its own
  catalogues and gets the app's locale and fallback behaviour.
- **Locale-correct formatting** for dates, numbers, and lists comes from `Intl`,
  not from hand-rolled formatting.
- **Interface locale and document locale are separate settings.** Document locale
  drives spellcheck dictionary, `babel`/`polyglossia` defaults, quotation marks,
  and hyphenation. Interface locale drives nothing about the document.
- **RTL is a layout requirement, not a translation one.** The interface is
  built with logical CSS properties (`margin-inline-start`, not `margin-left`)
  from the start, so Arabic and Hebrew interfaces are a matter of a `dir`
  attribute rather than a rewrite. This is nearly free now and expensive later.
- We ship `en-US` at launch and add locales as contributors provide them. The
  machinery, not the catalogue count, is what has to exist early.

## Consequences

- No retrofit, ever. This is the entire point and it is worth the friction.
- Contributors can add a language without touching application code.
- Every string costs a key. Developer friction is real; the lint makes it
  immediate and cheap rather than deferred and expensive.
- Key naming needs a convention from the start (`settings.editor.vim.label`), or
  the catalogue becomes unnavigable at scale.
- RTL-correct CSS constrains how components are written and needs review
  attention, since a `margin-left` slips through easily.
- Plurals and interpolation mean strings cannot be concatenated in code. Sentence
  fragments assembled at runtime are untranslatable, so full sentences are
  parameterised messages.
- Translation contributions need review by someone who speaks the language; we
  cannot verify them ourselves.

## Alternatives considered

**Add localisation after 1.0.** The common path. Rejected — it is the expensive
path, and the whole cost difference is front-loaded discipline we can simply pay
now.

**Plain key-value JSON (i18next-style) without ICU.** Simpler and more familiar.
Rejected on plurals: languages with more than two plural forms are precisely the
ones we most want to support, and bolting a plural system on later means
rewriting the catalogue format.

**`gettext` / `.po`.** Mature tooling and translators know it. Rejected because
its JavaScript story is weaker, and keying on the English source string means
every English copy edit invalidates translations.

**Localise the frontend only, leave Rust messages in English.** Considerably less
work. Rejected because compile errors and file errors are where a user most needs
their own language, and it would permanently split the message catalogue.
