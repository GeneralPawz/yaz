# Writing a plugin

A plugin is a `manifest.json` and a class. yaz's own Zotero, Obsidian and
formats plugins are written exactly this way, against exactly this API, with no
privileged access — which is the point of them
([ADR-0005](../adr/0005-extensibility-tiers.md)). If something you need is not
here, that is a gap in the API rather than a reason to reach around it, and it
is worth reporting.

## The shortest possible plugin

```
my-plugin/
  manifest.json
  src/main.ts
```

```json
{
  "id": "com.example.my-plugin",
  "name": "My plugin",
  "version": "0.1.0",
  "minAppVersion": "0.2.0",
  "author": "You",
  "description": "One sentence about what it does.",
  "capabilities": []
}
```

```ts
import { Plugin } from "@yaz/api";

export default class MyPlugin extends Plugin {
  onload(): void {
    this.addCommand({
      id: "say-hello",
      nameKey: "my-plugin-say-hello",
      callback: () => this.app.notices.show("my-plugin-hello"),
    });
  }
}
```

Note `nameKey` rather than a label. **No user-facing string is ever hardcoded**
— everything is a message key resolved against the active locale
([ADR-0011](../adr/0011-localisation.md)), and lint rejects a literal.

## The developer loop

Point yaz at the directory and reload. That is the whole loop.

1. **Settings → Plugins → Development plugin**, choose the directory.
2. Edit.
3. **Reload plugins**.

There is no commit, no push, no tag and no release in that list, deliberately.
A plugin loaded this way is read from disk exactly as it is and **is never
updated** — the copy on disk is the one you are editing, and an update that
overwrote it would destroy your work
([ADR-0021](../adr/0021-plugin-distribution.md)).

The manifest is parsed when you choose the directory, so a path that is not a
plugin is refused while you are still looking at the dialog rather than
silently doing nothing.

## Capabilities

A plugin declares what it needs; the Rust process decides whether it gets it.

```json
"capabilities": [{ "kind": "zotero" }, { "kind": "fs-project" }]
```

There is **no unbrokered path**. The frontend has no filesystem access of its
own, so neither does a plugin, and every privileged call is checked in the Rust
process before it does any work
([ADR-0006](../adr/0006-plugin-runtime-and-capabilities.md)). A plugin that
declares nothing can still register commands, contribute formats and edit the
buffer — which covers a surprising number of useful plugins.

`fs-project` is scoped to the open project. It is not "read the disk".

## Contributing a text format

yaz opens every text file with line numbers, wrapping, Vim and search whether
or not any plugin is installed. A format plugin adds what the file *is*:

```ts
this.registerFormat({
  id: "rust",
  extensions: ["rs"],
  nameKey: "format-rust",
  load: async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { rust } = await import("@codemirror/legacy-modes/mode/rust");
    return StreamLanguage.define(rust);
  },
});
```

`load` runs the first time a file of that format is opened and never before.
That is why it is a function: handing the language over at registration would
put it in the bundle for every user who never opens the format.

A contributed format cannot take an extension the application owns — `.tex`
stays LaTeX's — and a format whose plugin is switched off falls back to plain
text rather than to an error. See
[`yaz-formats`](https://github.com/texyaz/yaz-formats) for the
worked example; it is about sixty lines.

## Publishing, and how updates reach people

Put it in a repository, and say so in the manifest:

```json
"updates": {
  "source": "github",
  "repository": "you/my-plugin",
  "channel": "release"
}
```

| Field | Meaning |
| --- | --- |
| `source` | Where updates come from. `github` today. |
| `repository` | Read according to `source`. For GitHub, `owner/name`. |
| `channel` | `release` (default), `prerelease`, or `manual` for never. |

There is no registry to submit to and nothing to wait for. yaz asks the
repository, not us.

Three things are checked before an update is taken, and each prevents a failure
that reports as *the application* being broken rather than the plugin:

- **the id must match** — an id changing mid-update is either a mistake or an
  attempt to become a plugin somebody already trusted;
- **the version must be newer** — so a rollback is a deliberate act rather than
  something a mis-tagged release does by itself;
- **`minAppVersion` must be satisfied** — or the plugin installs, loads, and
  then fails against an API that is not there.

`minAppVersion` is enforced, not advisory. Set it to the version that first had
the API you use.

## Versioning

Your plugin's version is yours. It has nothing to do with yaz's, and a plugin
does not need a new release when the application gets one — that independence
is most of the reason plugins are separate repositories at all.

## What a plugin cannot do

Worth knowing before you plan around it:

- **Reach the filesystem or the network directly.** Everything goes through the
  broker, and what the broker allows is what the manifest declared.
- **Import anything internal to yaz.** `@yaz/api` is the contract; lint enforces
  that even our own plugins import nothing else.
- **Depend on the editor being CodeMirror.** The API deliberately types editor
  extensions loosely, so that a later editor core is a change to yaz rather
  than a break for every plugin.
- **Put a literal string in front of a user.** Message keys, always.

## The three to read

All public, all written against this API, all about as small as they look:

- [`yaz-formats`](https://github.com/texyaz/yaz-formats) —
  contributing languages; the simplest of the three, and no capabilities.
- [`yaz-obsidian`](https://github.com/texyaz/yaz-obsidian) — one
  command, one capability, and a picker.
- [`yaz-zotero`](https://github.com/texyaz/yaz-zotero) — the
  demanding one: two capabilities, a library to search, and a bibliography to
  write into.
