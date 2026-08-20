# Plugins

Each of these is **its own repository**, present here as a git submodule
([ADR-0021](../docs/adr/0021-plugin-distribution.md)):

| Directory | Repository | What it does |
| --- | --- | --- |
| `zotero` | [texyaz/yaz-plugin-zotero](https://github.com/texyaz/yaz-plugin-zotero) | Cite from Zotero, quote highlighted passages |
| `obsidian` | [texyaz/yaz-plugin-obsidian](https://github.com/texyaz/yaz-plugin-obsidian) | Bring a vault note in, translated to LaTeX |
| `formats` | [texyaz/yaz-plugin-formats](https://github.com/texyaz/yaz-plugin-formats) | Markdown, TOML, YAML and BibTeX highlighting |
| `learn` | [texyaz/yaz-learn](https://github.com/texyaz/yaz-learn) | Capture the application, for documenting it |

The first three ship enabled in a new installation. They are what the application is
*for*, and an editor that arrives unable to do any of it until the user goes
looking for a plugin list is an editor that arrives broken.

## Clone with them

```sh
git clone --recurse-submodules git@github.com:texyaz/yaz.git
# already cloned?
git submodule update --init --recursive
```

Without them the Rust build fails at `include_str!` with the missing path in
the error. That is deliberate: a build that quietly produced an application
missing half its features would be worse.

## They are not privileged

Bundled does not mean privileged. Each is loaded through the same runtime and
refused by the same capability broker as anything installed later
([ADR-0006](../docs/adr/0006-plugin-runtime-and-capabilities.md)), each can be
switched off, and each is written strictly against the public `@yaz/api`.

**The rule: a plugin that needs an API which does not exist yet gets the API
added as *public* API — never a private back door.** A change that adds a
shortcut for a first-party plugin is the failure mode
[ADR-0005](../docs/adr/0005-extensibility-tiers.md) exists to prevent. The
formats plugin is the worked example: it needed a way to contribute a language,
so `Plugin.registerFormat` exists for everyone.

## Writing one

See [writing a plugin](../docs/plugins/writing-a-plugin.md). The short version:
a `manifest.json`, a class extending `Plugin`, and a directory you point yaz at
while you work on it — no commit, no push, no release.
