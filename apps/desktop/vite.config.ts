import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [svelte()],

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
  },

  // Tauri surfaces these; without them the frontend cannot tell dev from
  // release, which ADR-0013 requires it to know.
  envPrefix: ["VITE_", "TAURI_"],

  clearScreen: false,
});
