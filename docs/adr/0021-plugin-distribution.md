# 0021 — Plugins are their own repositories, released and updated on their own

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** —
- **Superseded by:** —

## Context

[ADR-0005](0005-extensibility-tiers.md) put plugins in three tiers and made the
first-party ones *structurally identical* to community ones, so that the plugin
API is exercised by demanding real features before anyone outside meets it.
Structurally identical has so far meant identical inside one repository, which
tests the API and nothing else. It does not test that a plugin can be written,
released and updated by somebody who does not have commit access to yaz.

That is the part most likely to be wrong, because it is the part nobody
exercises until an outsider tries it. A plugin that only ever ships by being
committed into the application's own tree has no version of its own, no release
of its own, and no way to reach a user between application releases — and none
of those absences are visible from inside the monorepo.

There is also a plainer problem. The application is now in an organisation with
the plugins beside it, and a user who wants the Zotero bridge fixed should not
have to wait for a yaz release to get the fix.

## Decision

**Each non-core plugin is its own repository, released on its own, and present
in the application's tree as a submodule.**

- `texyaz/yaz-zotero`, `texyaz/yaz-obsidian`,
  `texyaz/yaz-formats` — public, each with its own version, its own
  releases and its own README.
- They appear under `plugins/` in `texyaz/yaz` as git submodules, so the
  application's tree still shows what it bundles and a clone with
  `--recurse-submodules` still builds everything.
- The submodule pin is the version the application *ships*. It is not the
  version a user ends up with, because a plugin updates itself between
  application releases.

### The manifest describes its own updates

A plugin's `manifest.json` says where its updates come from and how eagerly to
take them, rather than the application holding a list of plugins it knows:

```json
{
  "id": "com.yaz.zotero",
  "version": "0.2.0",
  "minAppVersion": "0.2.0",
  "updates": {
    "source": "github",
    "repository": "texyaz/yaz-zotero",
    "channel": "release"
  }
}
```

This is Obsidian's shape, and deliberately so: it is a shape plugin authors
already know, it needs no registry to exist before the first plugin can ship,
and a plugin hosted somewhere we have never heard of is a `source` we have not
written yet rather than a plugin we have forbidden.

**`minAppVersion` is enforced, not advisory.** An update whose `minAppVersion`
exceeds the running application is not offered — the alternative is a plugin
that loads and then fails against an API it expected, which reports as the
application being broken.

### What is bundled, and what that means

The three plugins above ship enabled in a new installation. They are what the
application is *for* — citing from Zotero, reading an Obsidian vault, opening
the file formats a project is made of — and an editor that arrives unable to do
any of it until the user finds a plugin list is an editor that arrives broken.

Bundled does not mean privileged. Each is still loaded through the same runtime
and refused by the same capability broker
([ADR-0006](0006-plugin-runtime-and-capabilities.md)), and each can be switched
off. The only difference between a bundled plugin and an installed one is which
directory it was read from.

### Two ways in, and the developer does not go through GitHub

There are two sources of plugin code, and they are different mechanisms
because they answer different questions:

- **Bundled and installed plugins** are read from disk, updated from their
  `updates` source when the user asks.
- **A development plugin is a path.** yaz reads it from wherever it is, reloads
  it on request, and never updates it — because the version on disk is the one
  the developer is editing, and an update button that overwrote it would
  destroy work.

The developer loop is therefore: build to a directory, point yaz at that
directory once, and reload. Not: commit, push, tag, release, click update. A
loop that goes through GitHub is a loop nobody uses, and a plugin API whose
authors avoid its own workflow will be an API nobody can report problems about.

## Consequences

**The submodule pin and the installed version can disagree, and that is
correct.** A user who has taken an update has a newer plugin than the one the
application shipped. The alternative — refusing to run a plugin newer than the
pin — would make the update mechanism pointless.

**A clone without `--recurse-submodules` builds an application with no
plugins.** That is a worse first experience than it sounds, so the build fails
loudly with the command to fix it rather than quietly producing an application
missing its features.

**Three repositories are three sets of CI, three release processes and three
changelogs.** Accepted, because the cost is the thing being tested: if
maintaining a plugin repository is unreasonable for us with commit access to
everything, it is unreasonable for an outside author, and better to find that
out on our own plugins.

**A plugin can now break itself for its users without a yaz release.** Which is
the point, and is also why `minAppVersion` is enforced and why an update that
fails to load is rolled back to the version that was working rather than left
in place.

## Alternatives considered

**Keep them in the monorepo and ship them with the application.** Simplest, and
what exists today. Rejected because it leaves the whole distribution half of
the plugin story untested until an outsider tries it, and because a fix to a
bridge should not wait for an application release.

**A registry the application queries.** What a mature ecosystem needs and what
this cannot justify yet: a registry has to be built, hosted and moderated
before the first plugin can ship through it. The manifest naming its own source
needs none of that, and a registry can be added later as another `source`
without invalidating anything already published.

**Copy the plugin sources in with a script rather than submodules.** Avoids
everyone's least favourite git feature. Rejected because a copy has no commit
to pin, so "which version of the plugin does this build of yaz contain" stops
having an answer — which is exactly the question a bug report needs.
