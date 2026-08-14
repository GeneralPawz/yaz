# Core plugins

Bundled with the application, toggleable, maintained by us — and **written
strictly against the public `@yaz/api`, with no privileged access whatsoever**.

That last part is the whole point. Shipping the Zotero bridge, the Obsidian
bridge and Vim mode as *plugins* means the plugin API is exercised by demanding,
real features from the start, and its inadequacies surface to us before they
surface to an external author.

**The rule: a core plugin that needs an API which does not exist yet gets the API
added to core as public API — never a private back door.** A pull request that
adds a shortcut for a first-party plugin is the failure mode
[ADR-0005](../docs/adr/0005-extensibility-tiers.md) exists to prevent.

Structurally these are identical to community plugins: `manifest.json` plus a
bundled `main.js`. Start from [`packages/plugin-template`](../packages/plugin-template).

Planned, in roughly the order they arrive:

| Plugin | Phase |
| --- | --- |
| `vim` | 4 |
| `zotero` | 5 |
| `obsidian` | 5 |
| `bibliography`, `outline`, `synctex` | 5 |
| `templates`, `export`, `git`, `spellcheck`, `tables`, `figures`, `snippets`, `stats` | 6 |

The directory is empty until the plugin runtime lands in phase 3.
