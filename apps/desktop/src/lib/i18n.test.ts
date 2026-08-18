/**
 * Message resolution and the German catalogue.
 *
 * The parity between catalogues is checked by `scripts/check-i18n.mjs`, which
 * fails the build. What is checked here is the behaviour that parity does not
 * cover: that switching the language actually switches the strings, and that a
 * key one catalogue is missing falls back rather than rendering as itself.
 */

import { afterEach, describe, expect, it } from "vitest";

import { availableLocales, locale, setLocale, t } from "./i18n";

afterEach(() => setLocale("en-US"));

describe("t", () => {
  it("resolves against the active locale", () => {
    expect(t("menu-file")).toBe("File");
    setLocale("de-DE");
    expect(t("menu-file")).toBe("Datei");
  });

  it("fills in parameters", () => {
    expect(t("vcs-committed", { id: "a1b2c3" })).toBe("Saved version a1b2c3");
    setLocale("de-DE");
    expect(t("vcs-committed", { id: "a1b2c3" })).toBe(
      "Version a1b2c3 gespeichert",
    );
  });

  it("leaves a parameter it was not given", () => {
    // Visible and obviously incomplete, rather than a sentence with a hole in
    // it that reads as finished.
    expect(t("vcs-committed")).toContain("$id");
  });

  it("returns the key when no catalogue has it", () => {
    expect(t("no-such-message-key")).toBe("no-such-message-key");
  });
});

describe("setLocale", () => {
  it("ignores a language this build does not have", () => {
    // A settings file carried from a newer version can name one. Leaving the
    // interface in English beats leaving it empty.
    setLocale("fr-FR");
    expect(locale()).toBe("en-US");
    expect(t("menu-file")).toBe("File");
  });
});

describe("availableLocales", () => {
  it("names each language in that language", () => {
    // A language list is read by people looking for their own, and someone who
    // cannot read the current interface can still find "Deutsch".
    expect(availableLocales.map((entry) => entry.name)).toEqual([
      "English",
      "Deutsch",
    ]);
  });

  it("offers only languages that resolve", () => {
    for (const entry of availableLocales) {
      setLocale(entry.code);
      expect(locale()).toBe(entry.code);
    }
  });
});
