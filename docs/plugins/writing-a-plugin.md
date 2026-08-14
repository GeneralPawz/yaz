# Writing a plugin

A plugin is a `manifest.json` and a bundled `main.js`. No compiler, no
cross-platform build matrix, no per-architecture artefacts — which is the whole
reason yaz runs its interface in a webview rather than as a native GUI.

## The API you get is the API we use

There is no privileged tier. yaz's own Zotero bridge, Obsidian bridge and Vim
mode are **core plugins**, written against exactly the `@yaz/api` you are
reading about, with no back doors.

That is deliberate, and it is the reason to trust the API is adequate: if a core
plugin needs something that does not exist, the answer is new *public* API, never
a shortcut for first-party code. The inadequacies surface to us before they
surface to you.

## Skeleton

```ts
import { Plugin } from "@yaz/api";

export default class WordGoal extends Plugin {
  async onload() {
    this.addCommand({
      id: "show-goal",
      nameKey: "word-goal.command.show",
      callback: () => this.app.notices.show("word-goal.notice.on-track"),
    });
  }
}
```

Note `nameKey`, not a label. **User-facing strings are message keys**, resolved
against the active locale — your plugin ships its own catalogues and gets the
locale chain for free. It is also what lets the command reference generate
itself from your registration.

## Manifest

```json
{
  "id": "com.example.word-goal",
  "name": "Word Goal",
  "version": "0.1.0",
  "minAppVersion": "0.2.0",
  "author": "You",
  "description": "One sentence. Shown in the plugin list.",
  "repository": "https://github.com/you/word-goal",
  "capabilities": []
}
```

Start from
[`packages/plugin-template`](https://github.com/GeneralPawz/yaz/tree/main/packages/plugin-template),
which is MIT so that whatever you build from it is yours to license however you
like.

## Capabilities

A plugin has **no ambient authority**. `fetch`, `XMLHttpRequest`, WebSocket and
the raw IPC handle are all removed before your code runs. Anything privileged
goes through `app`, and every such call is brokered by the Rust core against the
capabilities you declared and the user granted.

Declare only what you need — the list is shown at install, and a plugin asking
for `process` to count words will be uninstalled by anyone paying attention.

See the [capability reference](/reference/generated/capabilities).

### What capabilities do not do

Stated plainly, because a vague promise here would be worse than none: **a plugin
sharing the DOM can read the open document, observe keystrokes, and draw over the
interface.** Capabilities constrain what leaves the machine and what touches the
disk. They do not isolate a plugin from the application's own UI.

So: only install plugins you trust, and expect your users to apply the same
standard to yours.

## Semantic versioning is a promise

`@yaz/api` versions independently of the application, and a breaking change to a
documented API is a major bump without exception. Every entry carries a `@since`
tag, because "which version added this" is the question plugin authors ask most.

## Distribution

Publish a GitHub release with your `manifest.json` and `main.js`. Users install
from the repository, or directly from a file — sideloading is a first-class path,
not a workaround, because it is how you test and how private plugins are shared.

An update that requests capabilities the installed version did not have is
**blocked until the user approves the new set**. Silent privilege escalation
through auto-update is the most plausible real attack, so it is closed off by
design.

See [ADR-0005](/adr/0005-extensibility-tiers) and
[ADR-0006](/adr/0006-plugin-runtime-and-capabilities).
