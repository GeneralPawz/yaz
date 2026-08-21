/**
 * Themes and the bundle a built one exports.
 *
 * The export is the part worth testing hardest: what comes out has to be a
 * theme yaz would install — same manifest, same selectors — or the builder
 * produces something only the builder can read, which is the opposite of the
 * point.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyAppearance,
  clearPreview,
  manifestFor,
  normaliseColour,
  previewPalette,
  resolveMode,
  stylesheetFor,
  themeId,
  type Palette,
} from "./theme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-yaz-theme");
  document.documentElement.removeAttribute("data-yaz-mode");
  document.documentElement.removeAttribute("style");
});

const palette: Palette = {
  light: { "yaz-bg-primary": "#ffffff", "yaz-text-primary": "#111111" },
  dark: { "yaz-bg-primary": "#111111", "yaz-text-primary": "#eeeeee" },
};

describe("applying a theme", () => {
  it("is two attributes on the document", () => {
    applyAppearance("midnight", "dark");
    expect(document.documentElement.dataset.yazTheme).toBe("midnight");
    expect(document.documentElement.dataset.yazMode).toBe("dark");
  });

  it("never puts `system` on the document", () => {
    // A stylesheet cannot express "whatever the operating system says" without
    // duplicating every rule inside a media query, in every theme. So it is
    // resolved before it gets there.
    applyAppearance("yaz", "system");
    expect(["light", "dark"]).toContain(
      document.documentElement.dataset.yazMode,
    );
  });

  it("resolves an explicit choice to itself", () => {
    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
  });
});

describe("the exported stylesheet", () => {
  const css = stylesheetFor("midnight", "Midnight", palette);

  it("carries both modes", () => {
    // The rule a theme has to obey. One that provided a single mode would take
    // the other away from anyone who installed it.
    expect(css).toContain('[data-yaz-theme="midnight"][data-yaz-mode="light"]');
    expect(css).toContain('[data-yaz-theme="midnight"][data-yaz-mode="dark"]');
  });

  it("writes the tokens as custom properties", () => {
    expect(css).toContain("--yaz-bg-primary: #ffffff;");
    expect(css).toContain("--yaz-bg-primary: #111111;");
  });

  it("selects on the theme's own identifier", () => {
    // Not on `:root`: two installed themes would then fight, and the loser
    // would depend on which stylesheet the browser saw last.
    expect(css).not.toContain(":root {");
  });
});

describe("the exported manifest", () => {
  it("declares both modes", () => {
    const manifest = JSON.parse(
      manifestFor("midnight", "Midnight", "Someone", "0.2.0"),
    );
    expect(manifest.modes).toEqual(["light", "dark"]);
    expect(manifest.id).toBe("midnight");
    expect(manifest.author).toBe("Someone");
  });

  it("is what the installer reads back", () => {
    // Round-trip: the folder name comes from the id, and the selectors in the
    // stylesheet come from the same id, so these cannot drift apart.
    const id = themeId("My Midnight Theme");
    const manifest = JSON.parse(
      manifestFor(id, "My Midnight Theme", "", "0.2.0"),
    );
    expect(stylesheetFor(id, "x", palette)).toContain(
      `[data-yaz-theme="${manifest.id}"]`,
    );
  });
});

describe("themeId", () => {
  it("makes a name safe for a folder and a selector", () => {
    expect(themeId("My Midnight Theme")).toBe("my-midnight-theme");
    expect(themeId("Solarized (light!)")).toBe("solarized-light");
  });

  it("never comes back empty", () => {
    // An empty id would name a folder `<themes>/` and a selector that matches
    // everything.
    expect(themeId("")).toBe("theme");
    expect(themeId("!!!")).toBe("theme");
  });
});

describe("normaliseColour", () => {
  it("passes hex through", () => {
    expect(normaliseColour("#A1B2C3")).toBe("#a1b2c3");
  });

  it("expands short hex", () => {
    expect(normaliseColour("#abc")).toBe("#aabbcc");
  });

  it("converts what a browser computes", () => {
    // `getComputedStyle` returns `rgb(...)`, and a colour input handed that
    // silently shows black — which reads as the theme being wrong rather than
    // the input.
    expect(normaliseColour("rgb(22, 24, 28)")).toBe("#16181c");
    expect(normaliseColour("rgba(97, 155, 255, 0.24)")).toBe("#619bff");
  });

  it("falls back rather than throwing", () => {
    expect(normaliseColour("color-mix(in srgb, red, blue)")).toBe("#000000");
  });
});

describe("the preview", () => {
  it("puts values on the document and takes them off again", () => {
    previewPalette({ "yaz-bg-primary": "#123456" });
    expect(
      document.documentElement.style.getPropertyValue("--yaz-bg-primary"),
    ).toBe("#123456");

    clearPreview();
    expect(
      document.documentElement.style.getPropertyValue("--yaz-bg-primary"),
    ).toBe("");
  });
});
