# 0012 — Semantic versioning and changelog automation

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Three things in this project version independently and are consumed by different
audiences:

- **The application**, consumed by users, and by the updater ([0013](0013-update-distribution.md)).
- **`@yaz/api`**, the plugin API, consumed by plugin authors, who need to know
  precisely when something they depend on changed.
- **Plugins and themes**, versioned by their authors, declaring `minAppVersion`.

Hand-written changelogs decay: they are written at release time from memory,
they omit whatever seemed unimportant to the person writing them, and they never
say clearly whether an update is safe. For an application with a third-party API,
"is this breaking?" must be answerable mechanically.

## Decision

**Conventional Commits, enforced in CI, driving automated semantic versioning and
changelog generation via release-please.**

### Commits

`<type>(<scope>): <description>`, with `feat`, `fix`, `perf`, `refactor`,
`docs`, `test`, `build`, `ci`, `chore`. Breaking changes are marked `!` or a
`BREAKING CHANGE:` footer. Scopes match the workspace: `core`, `latex`,
`compile`, `plugin`, `zotero`, `obsidian`, `api`, `ui`, `docs`.

Enforced by commitlint in a git hook *and* in CI, because a hook can be skipped.

### Versioning

- The application follows semver. Before 1.0, breaking changes bump the minor
  version, per semver's 0.x provision.
- **`@yaz/api` versions independently** and its semver contract is strict and
  public: a breaking change to a documented plugin API is a major bump, without
  exception. Plugin authors depend on this being trustworthy.
- The application declares the `@yaz/api` version it implements. A plugin
  declares the `minAppVersion` it requires. The runtime refuses to load a plugin
  requiring a newer API and says so clearly.
- Plugins and themes are versioned by their authors; we only read their manifests.

### Release flow

1. Conventional commits land on `main`.
2. release-please maintains an open release pull request with the computed
   version bump and generated `CHANGELOG.md` entries.
3. Merging that pull request tags the release.
4. The tag triggers the build and publish workflow ([0013](0013-update-distribution.md)).

**Version numbers are never hand-edited.** `Cargo.toml`, `package.json`, and
`tauri.conf.json` versions are all maintained by release-please, so they cannot
drift apart.

### Changelog

Generated from commits, grouped by type, with `feat`, `fix`, and `perf` shown to
users and the rest available. Every entry links its commit and pull request. A
`BREAKING CHANGE` footer is rendered prominently and, for `@yaz/api`, is expected
to include a migration note — that footer is what a plugin author reads.

## Consequences

- Releasing is merging a pull request. Low ceremony means we release often, which
  is what makes small, reviewable changelogs possible.
- Breaking changes are mechanically detectable rather than a judgement call at
  release time.
- Every contributor must write commit messages in a specific format. This is real
  friction and it is enforced, because unenforced conventions are not conventions.
- Squash-merge is required so that the pull request title is the commit message
  that reaches `main` — otherwise messy branch history pollutes the changelog.
- Commit messages become user-facing text. Reviewers must read them as such,
  which is a genuine change in review habits.
- The generated changelog is only as good as the descriptions. A `fix: bug` entry
  is worthless, and review is the only defence.
- Independent `@yaz/api` versioning adds a coordination step to any release that
  touches it, and prevents the plugin ecosystem from being broken silently.

## Alternatives considered

**Hand-written changelog (keep-a-changelog).** Better prose, curated for humans.
Rejected because it depends on discipline at exactly the moment discipline is
scarcest, and it cannot mechanically answer whether a release is breaking.

**`git-cliff` alone.** Excellent changelog generation from conventional commits,
Rust-native. Rejected as insufficient by itself: it generates the changelog but
does not manage version bumps across a mixed Rust/Node monorepo or automate the
release pull request. release-please does the whole flow.

**`cargo-dist` / `dist` for the whole release.** Strong cross-platform Rust
release tooling. Rejected as the top-level driver because this is a Tauri
application, not a set of Rust binaries — Tauri's bundler owns installer
generation and updater signing. Used, if at all, underneath that.

**No conventional commits; infer versions manually.** Rejected: it puts the
question "did we break the plugin API" back into someone's memory.
