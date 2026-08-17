/**
 * Frontend test configuration.
 *
 * This exists because `pnpm test` for the frontend was a script that echoed a
 * sentence, and CI ran it and reported success. What slipped through was an
 * editor that rebuilt CodeMirror on every keystroke — the document could only
 * be written one character per mouse click — which is about as visible as a bug
 * gets and still shipped, because nothing exercised the component.
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Components import the public API by name, exactly as a plugin does.
    alias: {
      "@yaz/api": new URL("../../packages/api/src/index.ts", import.meta.url)
        .pathname,
    },
    // Svelte components under test need the browser build, or lifecycle and
    // effects do not run.
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
