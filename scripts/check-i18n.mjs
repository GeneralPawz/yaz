#!/usr/bin/env node
/**
 * Verifies that every message key referenced in code exists in the source
 * catalogue.
 *
 * ADR-0011 says localisation is not retrofittable and that enforcement must be
 * mechanical — "without the rule, this ADR is a wish". This is that rule. A key
 * referenced in code but missing from `locales/en-US.ftl` fails the build.
 *
 * It checks both sides of the IPC boundary, because Rust-originated messages
 * (compile diagnostics, filesystem errors, capability descriptions) are exactly
 * the ones a user most needs in their own language, and are the easiest to
 * forget.
 *
 * Not yet enforced, deliberately: unused catalogue entries are reported as a
 * warning rather than an error, since a key can legitimately land before its
 * caller.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalogue = join(root, "locales", "en-US.ftl");

/** Keys defined in the source catalogue. */
function definedKeys() {
  const source = readFileSync(catalogue, "utf8");
  const keys = new Set();
  for (const line of source.split(/\r?\n/)) {
    // Message identifiers start at column 0; indented lines are continuations
    // or selector variants.
    const match = /^([a-zA-Z][\w-]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "target" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* walk(full, exts);
    } else if (exts.includes(extname(full))) {
      yield full;
    }
  }
}

/** Shape of a message key: kebab-case, at least two segments. */
const KEY = String.raw`[a-z][a-z0-9]*(?:-[a-z0-9]+)+`;

/**
 * Keys referenced from code, with the file and line that referenced them.
 *
 * Matched at **call sites**, across the whole file text rather than line by
 * line. Two earlier approaches both failed:
 *
 * - Line-by-line call-site matching missed every Rust key whose literal rustfmt
 *   put on its own line, which is most of them. A false *unused* warning is
 *   harmless; the same blind spot hiding a genuinely missing key is not.
 * - Matching any kebab string sharing a catalogue prefix caught those, but also
 *   flagged CSS class names — `editor-pane`, `pdf-pane` — as missing messages.
 *
 * Whitespace-tolerant patterns anchored to the calls that actually resolve
 * messages get the recall without the noise.
 */
function referencedKeys() {
  const found = new Map();

  const note = (key, file, text, index) => {
    const line = text.slice(0, index).split(/\r?\n/).length;
    const where = `${relative(root, file)}:${line}`;
    if (!found.has(key)) found.set(key, []);
    if (!found.get(key).includes(where)) found.get(key).push(where);
  };

  const collect = (file, text, pattern) => {
    for (const m of text.matchAll(pattern)) note(m[1], file, text, m.index);
  };

  // Frontend and plugins: t("key") / t('key'), argument possibly wrapped.
  for (const dir of ["apps", "plugins", "packages"]) {
    for (const file of walk(join(root, dir), [".ts", ".svelte"])) {
      const text = readFileSync(file, "utf8");
      collect(file, text, new RegExp(String.raw`\bt\(\s*["'](${KEY})["']`, "gs"));
    }
  }

  // Rust: explicit error construction, plus match arms inside the *_key()
  // functions that exist precisely to return message keys.
  for (const file of walk(join(root, "crates"), [".rs"])) {
    const text = readFileSync(file, "utf8");
    collect(file, text, new RegExp(String.raw`CommandError::new\(\s*"(${KEY})"`, "gs"));
    if (/fn\s+\w*_key\s*\(/.test(text)) {
      collect(file, text, new RegExp(String.raw`=>\s*"(${KEY})"`, "gs"));
    }
  }

  return found;
}

const defined = definedKeys();
const referenced = referencedKeys();

const missing = [...referenced].filter(([key]) => !defined.has(key));
const unused = [...defined].filter((key) => !referenced.has(key));

if (unused.length > 0) {
  console.warn(`\n${unused.length} catalogue entries are not referenced yet:`);
  for (const key of unused) console.warn(`  ${key}`);
}

if (missing.length > 0) {
  console.error(`\n${missing.length} message keys are used in code but missing from locales/en-US.ftl:\n`);
  for (const [key, places] of missing) {
    console.error(`  ${key}`);
    for (const place of places) console.error(`      ${place}`);
  }
  console.error("\nAdd them to locales/en-US.ftl. See docs/adr/0011-localisation.md.\n");
  process.exit(1);
}

console.log(
  `i18n: ${referenced.size} referenced keys, all present in the catalogue (${defined.size} defined).`,
);
