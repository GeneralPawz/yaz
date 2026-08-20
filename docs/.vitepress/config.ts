import { defineConfig } from "vitepress";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Build the ADR sidebar from the records themselves.
 *
 * Hand-maintaining this list would put a second copy of "which ADRs exist" in
 * the repository, and the copy would be wrong the first time someone adds a
 * record and forgets. ADR-0016 makes that the whole point: anything the code or
 * the files already know is generated.
 *
 * Superseded records stay in the sidebar, marked. They are part of the history,
 * and the reasoning behind a decision we later reversed is often the most useful
 * thing in the directory.
 */
function adrSidebar() {
  return readdirSync(join(docsRoot, "adr"))
    .filter((file) => /^\d{4}-.*\.md$/.test(file))
    .sort()
    .map((file) => {
      const text = readFileSync(join(docsRoot, "adr", file), "utf8");
      const heading = /^#\s*(.+)$/m.exec(text)?.[1] ?? file;
      const status = /^-\s*\*\*Status:\*\*\s*(.+)$/m
        .exec(text)?.[1]
        ?.replace(/\*/g, "")
        .trim();

      // "0004 — Editor core: …" reduced to a sidebar-sized label.
      const [, number, title] = /^(\d{4})\s*[—-]\s*(.+)$/.exec(heading) ?? [
        ,
        "",
        heading,
      ];
      const suffix =
        status && status !== "Accepted"
          ? ` (${status.split(" ")[0].toLowerCase()})`
          : "";

      return {
        text: `${number} · ${title}${suffix}`,
        link: `/adr/${file.replace(/\.md$/, "")}`,
      };
    });
}

export default defineConfig({
  title: "yaz",
  description:
    "A modern LaTeX writing environment that turns collected ideas and sources into papers.",
  lang: "en-US",

  // Published under a repository path on GitHub Pages.
  base: "/yaz/",

  // A broken internal link should fail the build rather than ship. The
  // generated pages link into /adr/, so a renamed record must not silently
  // become a 404.
  ignoreDeadLinks: false,

  cleanUrls: true,
  lastUpdated: true,

  // Offline-capable static output with local search — no external service, so
  // the docs work behind the same restrictive networks the app has to.
  themeConfig: {
    search: { provider: "local" },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Plugins", link: "/plugins/writing-a-plugin" },
      { text: "Reference", link: "/reference/generated/capabilities" },
      { text: "Decisions", link: "/reference/generated/adr-index" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Choosing an engine", link: "/guide/engines" },
          ],
        },
      ],
      "/plugins/": [
        {
          text: "Plugin authors",
          items: [
            { text: "Writing a plugin", link: "/plugins/writing-a-plugin" },
            { text: "Capabilities", link: "/reference/generated/capabilities" },
          ],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [{ text: "Development setup", link: "/contributing/setup" }],
        },
      ],
      "/": [
        {
          text: "Reference",
          items: [
            { text: "Capabilities", link: "/reference/generated/capabilities" },
            { text: "Platforms", link: "/reference/generated/platforms" },
          ],
        },
        {
          text: "Architecture decisions",
          collapsed: false,
          items: [
            { text: "Index", link: "/reference/generated/adr-index" },
            ...adrSidebar(),
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/GeneralPawz/yaz" },
    ],

    footer: {
      message:
        'Application AGPL-3.0-or-later · <a href="https://github.com/GeneralPawz/yaz/tree/main/packages/api">@yaz/api</a> MIT · docs CC BY-SA 4.0',
      copyright: "yaz contributors",
    },

    editLink: {
      pattern: "https://github.com/GeneralPawz/yaz/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
