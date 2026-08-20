# Plugins

Each of these is **its own repository**, present here as a git submodule
([ADR-0021](../docs/adr/0021-plugin-distribution.md)):

| Directory        | Repository                                                                | What it does                                           |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `zotero`         | [texyaz/yaz-zotero](https://github.com/texyaz/yaz-zotero)                 | Cite from Zotero, quote highlighted passages           |
| `obsidian`       | [texyaz/yaz-obsidian](https://github.com/texyaz/yaz-obsidian)             | Bring a vault note in, translated to LaTeX             |
| `formats`        | [texyaz/yaz-formats](https://github.com/texyaz/yaz-formats)               | Markdown, TOML, YAML and BibTeX highlighting           |
| `latex-packages` | [texyaz/yaz-latex-packages](https://github.com/texyaz/yaz-latex-packages) | Preview support for what the common LaTeX packages add |
| `learn`          | [texyaz/yaz-learn](https://github.com/texyaz/yaz-learn)                   | Capture the application, for documenting it            |

All but `learn` ship enabled in a new installation. They are what the
application is _for_, and an editor that arrives unable to do any of it until
the user goes looking for a plugin list is an editor that arrives broken.

`latex-packages` earns that place for a different reason than the others. yaz
knows **LaTeX itself** — the kernel and the standard classes — and stops there;
everything a `\usepackage` adds is that plugin's. The test is not "does a real
thesis use it" (a real thesis uses `\gls` 561 times) but _does
`\documentclass{article}` alone define it_. Drawing the line anywhere else
means the list of packages yaz knows grows inside the application forever.

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
added as _public_ API — never a private back door.** A change that adds a
shortcut for a first-party plugin is the failure mode
[ADR-0005](../docs/adr/0005-extensibility-tiers.md) exists to prevent. The
formats plugin is the worked example: it needed a way to contribute a language,
so `Plugin.registerFormat` exists for everyone, and `latex-packages` needed a
way to say what a command means, so `Plugin.registerLatexVocabulary` does.

## Writing one

See [writing a plugin](../docs/plugins/writing-a-plugin.md). The short version:
a `manifest.json`, a class extending `Plugin`, and a directory you point yaz at
while you work on it — no commit, no push, no release.
