#!/usr/bin/env node
/**
 * Enforce that plugins use only the public API.
 *
 * ADR-0005's whole argument rests on this: core plugins are shipped as plugins
 * so that the public API is exercised by demanding real features before an
 * external author meets it. A core plugin that reached into the application's
 * internals would still work, still ship, and prove nothing — and the failure is
 * invisible, because the plugin behaves perfectly.
 *
 * So a plugin may import:
 *   - `@yaz/api`
 *   - paths relative to itself
 *
 * and nothing else. Not `../../apps/desktop/...`, not a third-party package that
 * the application happens to bundle, not Tauri's own API — that last one would
 * bypass the capability broker entirely (ADR-0006).
 *
 * Run by `pnpm lint`, which CI runs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(root, "plugins");

/** Imports a plugin is allowed to name. */
const ALLOWED = new Set(["@yaz/api"]);

/** Every `.ts` file under a directory. */
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // `plugins/` may hold only a README before any plugin exists.
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(walk(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

// Matches static imports, `export ... from`, and dynamic `import()`. A plugin
// reaching for an internal module by any of these routes is the same problem.
const SPECIFIER =
  /(?:^|\s)(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gs;

const violations = [];

for (const file of walk(pluginsDir)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    // Relative to the plugin's own sources is fine.
    if (specifier.startsWith("./")) continue;
    // `../` is not: it is how a plugin walks out of its own directory.
    if (ALLOWED.has(specifier)) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    violations.push({
      file: relative(root, file).replaceAll("\\", "/"),
      line,
      specifier,
    });
  }
}

if (violations.length > 0) {
  console.error("Plugins may import only @yaz/api and their own files.\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`      imports ${JSON.stringify(v.specifier)}`);
  }
  console.error(
    "\nIf a plugin needs something the public API does not expose, the answer is",
  );
  console.error(
    "new public API in packages/api — never a private route. See ADR-0005.",
  );
  process.exit(1);
}

const count = walk(pluginsDir).length;
console.log(`plugin imports: ${count} file(s) checked, all use only @yaz/api`);
