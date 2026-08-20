import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [svelte()],

  resolve: {
    /*
     * What the application lends to a plugin it bundles.
     *
     * Each plugin is its own repository now (ADR-0021), so its dependencies
     * are declared and installed in its own tree — which is right, and which
     * is why they cannot be found from here when the application compiles the
     * plugin's *source* into itself.
     *
     * The two are reconciled by saying so explicitly rather than by hoisting.
     * A plugin reaching for something not on this list fails to build here,
     * which is the same answer it would get from a user who installed it, and
     * the list is short enough to read.
     */
    alias: {
      "@yaz/api": fileURLToPath(
        new URL("../../packages/api/src/index.ts", import.meta.url),
      ),
      // The editor packages, resolved from this application's `node_modules`
      // because a bundled plugin's directory has none of its own.
      "@codemirror/legacy-modes": fileURLToPath(
        new URL("./node_modules/@codemirror/legacy-modes", import.meta.url),
      ),
      "@codemirror/language": fileURLToPath(
        new URL("./node_modules/@codemirror/language", import.meta.url),
      ),
    },
    // One copy of the editor's state and view, or a plugin's language and the
    // editor's would be talking to different instances of CodeMirror.
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language"],
  },

  // Tauri drives this dev server; the port is fixed because tauri.conf.json
  // points at it. Failing loudly beats silently moving to 5174 and leaving the
  // window blank.
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // themes/ and locales/ live at the repo root because both Rust and
      // TypeScript consume them (ADR-0017), so Vite must be allowed to read
      // outside the app directory.
      allow: [repoRoot],
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The webview is always current, so there is no legacy browser to serve.
    target: "esnext",
    sourcemap: true,
    // Never inline a font as a `data:` URI.
    //
    // The content security policy in tauri.conf.json is `default-src 'self'`
    // with no `font-src`, so a `data:` font is refused by the webview. Vite
    // inlines any asset under 4 kB by default, and three of KaTeX's twenty font
    // files are under it — the ones that draw large brackets and integral
    // signs. The result would be a formula that renders with the wrong
    // delimiters and no error anywhere.
    assetsInlineLimit: (file) =>
      /\.(woff2?|ttf|eot)$/i.test(file) ? false : undefined,
  },

  // Tauri surfaces these; without them the frontend cannot tell dev from
  // release, which ADR-0013 requires it to know.
  envPrefix: ["VITE_", "TAURI_"],

  clearScreen: false,
});
