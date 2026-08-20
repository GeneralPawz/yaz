# Contributing to yaz

Thank you for considering it. This document is short; the reasoning behind most
of what it asks for lives in [`docs/adr/`](docs/adr/).

## Before you start

**Read the relevant ADR.** Most surprising things in this codebase are
deliberate and recorded. If a change contradicts an accepted ADR, that is not
automatically wrong — but it needs a _new ADR_ superseding the old one, in the
same pull request, rather than a quiet change.

The ones worth knowing early:

- [0004](docs/adr/0004-editor-core-codemirror-single-buffer.md) — why there is
  one editor buffer and visual mode is decorations
- [0005](docs/adr/0005-extensibility-tiers.md) — what is core, what is a plugin
- [0006](docs/adr/0006-plugin-runtime-and-capabilities.md) — the security model
- [0014](docs/adr/0014-target-platforms-and-arm64.md) — the ARM64 policy
- [0015](docs/adr/0015-performance-budgets.md) — the performance budgets

## Setup

See [docs/contributing/setup.md](docs/contributing/setup.md). Note that a
contributor working only on Rust does not need a Node toolchain, and vice versa.

## The rules that CI enforces

These are not style preferences; each has an ADR behind it and each fails the
build.

| Rule                                                 | Why                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Conventional Commits**                             | Drives versioning and the changelog — [0012](docs/adr/0012-versioning-and-changelog.md) |
| **No hardcoded user-facing strings**                 | Localisation is not retrofittable — [0011](docs/adr/0011-localisation.md)               |
| **No literal colours in components**                 | Themes work through tokens — [0010](docs/adr/0010-theming.md)                           |
| **No `margin-left` etc.; use logical properties**    | RTL layouts — [0011](docs/adr/0011-localisation.md)                                     |
| **`#![deny(missing_docs)]` on public Rust items**    | The reference is generated — [0016](docs/adr/0016-documentation-strategy.md)            |
| **Plugins may not import internal frontend modules** | Keeps the plugin API honest — [0005](docs/adr/0005-extensibility-tiers.md)              |
| **Performance budgets**                              | A regression fails the PR — [0015](docs/adr/0015-performance-budgets.md)                |
| **Native ARM64 for every dependency**                | No emulated fallbacks — [0014](docs/adr/0014-target-platforms-and-arm64.md)             |

## Commit messages

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`.
Scopes are listed in `commitlint.config.mjs`.

**Your commit message becomes user-facing changelog text.** `fix: bug` is not
acceptable. Write what changed for the person using the application.

Breaking changes take a `!` or a `BREAKING CHANGE:` footer. For anything in
`packages/api`, the footer must include a migration note — plugin authors read
it.

We squash-merge, so the **pull request title** is the commit that reaches `main`.

## Pull requests

- One logical change. A refactor and a feature in one pull request is two pull
  requests wearing a coat.
- Documentation ships with the code. A new command or setting needs its
  description string; the reference page generates itself from there.
- Tests for behaviour, not for coverage.
- If it touches the capability broker in `yaz-plugin`, it needs adversarial tests
  — path traversal and symlink escape at minimum. That code is a sandbox
  boundary.

## Sign-off

Contributions are made under the licence of the files they touch (see
[ADR-0018](docs/adr/0018-licensing.md)). There is no CLA and no copyright
assignment. Certify the [DCO](https://developercertificate.org/) with:

```bash
git commit -s
```

## Adding a plugin API

If you are adding to `@yaz/api`, remember it is a public, semver-stable contract
that people build on and that we cannot casually change. It needs: a doc comment
saying what it guarantees and which capability it requires, a `@since` tag, a
runnable example, and a broker implementation on the Rust side if it is
privileged.

The bar for adding is deliberately higher than the bar for adding to core.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).
