/**
 * Starter plugin.
 *
 * This is exactly the API a core plugin gets — there is no privileged tier
 * ([ADR-0005]). If something you need is missing here, the answer is new public
 * API, never a back door.
 *
 * [ADR-0005]: https://generalpawz.github.io/yaz/adr/0005-extensibility-tiers
 */

import { Plugin } from "@yaz/api";

export default class MyPlugin extends Plugin {
  async onload(): Promise<void> {
    // Commands take a message key, never a literal string: catalogues are how
    // your plugin gets translated, and the command reference in the docs is
    // generated from this registration.
    this.addCommand({
      id: "say-hello",
      nameKey: "my-plugin.command.say-hello",
      callback: () => {
        this.app.notices.show("my-plugin.notice.hello");
      },
    });
  }

  onunload(): void {
    // Anything registered through `add*` is cleaned up for you. Use this only
    // for resources the API does not know about.
  }
}
