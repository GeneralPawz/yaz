// Conventional Commits — see docs/adr/0012-versioning-and-changelog.md.
// Enforced in a git hook AND in CI, because hooks can be skipped.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        // Rust crates
        "core",
        "latex",
        "compile",
        "plugin",
        "zotero",
        "obsidian",
        "app",
        // Frontend and packages
        "ui",
        "editor",
        "api",
        "template",
        // Cross-cutting
        "themes",
        "i18n",
        "docs",
        "ci",
        "deps",
        "release",
      ],
    ],
    // Changelog entries are user-facing prose. Make them readable.
    "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [0], // BREAKING CHANGE footers need room
  },
};
