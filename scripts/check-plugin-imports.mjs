#!/usr/bin/env node
/**
 * Enforce that plugins reach the application only through the public API.
 *
 * ADR-0005's whole argument rests on this: core plugins are shipped as plugins
 * so that the public API is exercised by demanding real features before an
 * external author meets it. A core plugin that reached into the application's
 * internals would still work, still ship, and prove nothing — and the failure
 * is invisible, because the plugin behaves perfectly.
 *
 * # What is banned, and why each one
 *
 * - **`../` and anything under `apps/`, `crates/`, `packages/`** — reaching
 *   into the application's own source. The thing this check exists for.
 * - **`@yaz/*` other than `@yaz/api`** — the same, by package name.
 * - **`@tauri-apps/*`** — that route bypasses the capability broker entirely,
 *   which is ADR-0006's entire security boundary.
 * - **`node:*`** — a plugin runs in the webview. An import that resolves at a
 *   bundler's whim and not at runtime is worse than one that fails outright.
 * - **A package the plugin does not declare** — the subtle one. A plugin that
 *   imports something only because the *application* happens to have it in
 *   `node_modules` works here and breaks the moment someone installs it on its
 *   own, which under ADR-0021 is how everyone but us gets it.
 *
 * # What is allowed
 *
 * `@yaz/api`, the plugin's own files, and any package the plugin's own
 * `package.json` declares. That last one is not a loosening: under ADR-0021 a
 * plugin is its own repository with its own dependencies, and `registerFormat`
 * cannot even be called without naming CodeMirror, because a language *is* a
 * CodeMirror extension. Banning declared dependencies would ban the public API
 * from being usable.
 *
 * Run by `pnpm lint`, which CI runs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(root, "plugins");

/** Every `.ts` file under a directory. */
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // `plugins/` may hold only a README before any plugin exists, and a
    // submodule that was never initialised is an empty directory.
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

/** Every directory directly under `plugins/` that holds a plugin. */
function pluginRoots() {
  try {
    return readdirSync(pluginsDir)
      .map((entry) => join(pluginsDir, entry))
      .filter((path) => statSync(path).isDirectory());
  } catch {
    return [];
  }
}

/** What a plugin declares it depends on, by package name. */
function declaredBy(pluginRoot) {
  const manifest = join(pluginRoot, "package.json");
  if (!existsSync(manifest)) return new Set();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    return new Set();
  }
  return new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
    ...Object.keys(parsed.peerDependencies ?? {}),
  ]);
}

/** `@codemirror/legacy-modes/mode/toml` → `@codemirror/legacy-modes`. */
function packageOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Why this specifier is refused, or `null` if it is fine.
 *
 * The reason is carried through to the message: a plugin author who trips this
 * needs to know which of five different rules they met.
 */
function refuse(specifier, declared) {
  if (specifier.startsWith("./")) return null;
  if (specifier === "@yaz/api") return null;

  if (specifier.startsWith("../")) {
    return "walks out of the plugin's own directory";
  }
  if (/^(?:\.{0,2}\/)?(?:apps|crates|packages)\//.test(specifier)) {
    return "reaches into the application's source";
  }
  if (specifier.startsWith("node:")) {
    return "is a Node built-in; a plugin runs in the webview";
  }

  const pkg = packageOf(specifier);
  if (pkg === "@tauri-apps" || pkg.startsWith("@tauri-apps/")) {
    return "bypasses the capability broker (ADR-0006)";
  }
  if (pkg.startsWith("@yaz/")) {
    return "is one of yaz's own packages; only @yaz/api is public";
  }
  if (!declared.has(pkg)) {
    return `is not in the plugin's own package.json; it would resolve only because the application has it`;
  }
  return null;
}

// Matches static imports, `export ... from`, and dynamic `import()`. A plugin
// reaching for an internal module by any of these routes is the same problem.
const SPECIFIER =
  /(?:^|\s)(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gs;

const violations = [];
let checked = 0;

for (const pluginRoot of pluginRoots()) {
  const declared = declaredBy(pluginRoot);
  for (const file of walk(pluginRoot)) {
    checked += 1;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const reason = refuse(specifier, declared);
      if (!reason) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      violations.push({
        file: relative(root, file).replaceAll("\\", "/"),
        line,
        specifier,
        reason,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    "A plugin may import @yaz/api, its own files, and what it declares.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`      ${JSON.stringify(v.specifier)} ${v.reason}`);
  }
  console.error(
    "\nIf a plugin needs something the public API does not expose, the answer is",
  );
  console.error(
    "new public API in packages/api — never a private route. See ADR-0005.",
  );
  process.exit(1);
}

console.log(`plugin imports: ${checked} file(s) checked, none reach inside`);
