#!/usr/bin/env node
/**
 * Generates the reference pages that restate facts already present in the code.
 *
 * ADR-0016 draws the line: documentation that **restates** something the code
 * already knows must be generated, because a hand-maintained copy is wrong
 * within a month; documentation that **explains intent** must be written, because
 * nothing can derive it. This script owns the first category.
 *
 * ## Why static extraction rather than `--dump-docs`
 *
 * ADR-0016 describes the eventual mechanism: the application exposes a
 * `--dump-docs` mode emitting its registries as JSON. That is still the target,
 * but two things are true today. The command, settings and keymap registries do
 * not exist yet — they arrive with the plugin runtime in phase 3 — and invoking
 * the binary would make the docs build depend on a Rust build, which is a poor
 * trade while the only registries are enums.
 *
 * So this reads the sources that *are* the registry. The principle ADR-0016
 * cares about is intact: there is exactly one copy of each fact, and it lives in
 * the code. Swap the extraction for `--dump-docs` when there is something to
 * dump.
 *
 * Generated pages are never hand-edited. CI fails if regenerating produces a
 * diff, which is what stops someone "fixing" a page that would be silently
 * overwritten on the next build.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "docs", "reference", "generated");

const BANNER = `<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->
`;

/** Messages from the source catalogue, so descriptions are not duplicated here. */
function loadMessages() {
  const source = readFileSync(join(root, "locales", "en-US.ftl"), "utf8");
  const messages = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([a-zA-Z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (match) messages.set(match[1], match[2]);
  }
  return messages;
}

/**
 * The capability vocabulary, read from the enum that defines it.
 *
 * Two facts are extracted and they live in different places, deliberately: the
 * identifier and sensitivity come from `capability.rs`, and the human
 * description comes from the message catalogue, because it is user-facing text
 * and therefore translatable (ADR-0011).
 */
function generateCapabilities(messages) {
  const source = readFileSync(
    join(root, "crates", "yaz-plugin", "src", "capability.rs"),
    "utf8",
  );

  // `Capability::Variant { .. } => "id",` inside fn id()
  const ids = [
    ...source.matchAll(/Capability::(\w+)\s*(?:\{[^}]*\})?\s*=>\s*"([^"]+)"/g),
  ].map(([, variant, id]) => ({ variant, id }));

  // The `is_sensitive` body names the variants that warrant extra emphasis.
  const sensitiveBlock =
    /fn is_sensitive[\s\S]*?matches!\(([\s\S]*?)\)\s*\}/.exec(source);
  const sensitive = new Set(
    sensitiveBlock
      ? [...sensitiveBlock[1].matchAll(/Capability::(\w+)/g)].map((m) => m[1])
      : [],
  );

  const rows = ids.map(({ variant, id }) => {
    const key = `capability-${id.replace(/:/g, "-")}-description`;
    const raw = messages.get(key) ?? "_(no description in the catalogue)_";
    // Catalogue entries carry Fluent placeholders — `{ $hosts }` is filled with
    // the actual host list in the install dialog. In a reference page there is
    // no plugin to fill them, so render what the placeholder stands for rather
    // than leaking the interpolation syntax.
    const description = raw.replace(
      /\{\s*\$(\w+)\s*\}/g,
      (_, name) => `the ${name} it declares`,
    );
    return `| \`${id}\` | ${description} | ${sensitive.has(variant) ? "yes" : "no"} |`;
  });

  return `${BANNER}
# Capability reference

Every privileged thing a plugin can do. A plugin declares these in its
\`manifest.json\`; the user grants them at install and can revoke any of them
individually afterwards.

**The security boundary is the Rust process, not the JavaScript context.** These
constrain what leaves your machine and what touches your disk. They do *not*
isolate a plugin from the application's interface — a plugin sharing the DOM can
read the open document. That is by design and is stated plainly in
[the security policy](https://github.com/GeneralPawz/yaz/blob/main/SECURITY.md).

| Capability | What granting it allows | Sensitive |
| --- | --- | :---: |
${rows.join("\n")}

"Sensitive" ones are emphasised in the install dialog. Network access is limited
to explicitly declared hosts — a wildcard is rejected at manifest validation,
because a capability that grants "the internet" is not a capability.

See [ADR-0006](/adr/0006-plugin-runtime-and-capabilities).
`;
}

/** The shipping platform matrix, read from the CI build matrix that proves it. */
function generatePlatforms() {
  const workflow = readFileSync(
    join(root, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const targets = [
    ...workflow.matchAll(/- name:\s*(\S+)\s*\n\s*runner:\s*(\S+)/g),
  ].map(([, name, runner]) => ({ name, runner }));

  const rows = targets.map(({ name, runner }) => {
    const [os, arch] = name.split("-");
    const native = runner.includes("arm") === (arch === "aarch64");
    return `| ${os} | \`${arch}\` | \`${runner}\` | ${native ? "native" : "**cross**"} |`;
  });

  return `${BANNER}
# Supported platforms

Generated from the CI build matrix, so this cannot claim support for something
that is not actually built and tested.

| OS | Architecture | CI runner | Build |
| --- | --- | --- | --- |
${rows.join("\n")}

ARM64 is **tier 1**, not best-effort: every one of these is built and tested on a
runner of its own architecture, never cross-compiled and never under emulation.
A dependency without a native \`aarch64\` path is a blocker rather than a caveat,
and performance budgets are measured on ARM64 as well as x86_64 — a budget met
only on x86_64 is not met.

See [ADR-0014](/adr/0014-target-platforms-and-arm64).
`;
}

/** The ADR index, read from the records themselves. */
function generateAdrIndex() {
  const dir = join(root, "docs", "adr");
  const entries = readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const title = /^#\s*(.+)$/m.exec(text)?.[1] ?? file;
      const status =
        /^-\s*\*\*Status:\*\*\s*(.+)$/m.exec(text)?.[1]?.replace(/\*/g, "") ??
        "?";
      return { slug: file.replace(/\.md$/, ""), title, status: status.trim() };
    });

  const rows = entries.map(
    (e) => `| [${e.title}](/adr/${e.slug}) | ${e.status} |`,
  );

  return `${BANNER}
# Architecture decisions

Every decision that is expensive to reverse, and the reasoning behind it. These
are published rather than kept internal: a plugin author asking why the API is
shaped a particular way should be able to read the answer.

Records are append-only. A reversed decision is superseded by a new record
rather than edited, because the history of a decision we later changed is more
useful than a tidy directory.

| Decision | Status |
| --- | --- |
${rows.join("\n")}
`;
}

const messages = loadMessages();
mkdirSync(outDir, { recursive: true });

const pages = {
  "capabilities.md": generateCapabilities(messages),
  "platforms.md": generatePlatforms(),
  "adr-index.md": generateAdrIndex(),
};

for (const [name, content] of Object.entries(pages)) {
  writeFileSync(join(outDir, name), content, "utf8");
  console.log(`generated docs/reference/generated/${name}`);
}
