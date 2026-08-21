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
import enUS from "../../../../locales/en-US.ftl?raw";
import deDE from "../../../../locales/de-DE.ftl?raw";

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

describe("every message in the catalogues", () => {
  /**
   * Keys whose value is written on the following lines instead of after the
   * `=`.
   *
   * The parser here reads the `key = value` subset and skips continuation
   * lines by design, so a value written that way resolves to its own key and
   * the interface shows `listing-empty-contents` where a sentence should be.
   * It costs nothing to write the sentence on one line, and this is what says
   * so — a translator has no way to know otherwise, and the string looks fine
   * in the catalogue.
   */
  function blockValued(source: string): string[] {
    const found: string[] = [];
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      const match = /^([a-zA-Z][\w-]*)\s*=\s*(.*)$/.exec(line);
      if (!match || match[2]!.trim() !== "") return;
      // A plural selector is a different thing and is knowingly not resolved
      // until the real Fluent runtime lands (ADR-0011, phase 3).
      if ((lines[index + 1] ?? "").includes("->")) return;
      found.push(match[1]!);
    });

    return found;
  }

  it("is written where the parser can read it", () => {
    expect(blockValued(enUS)).toEqual([]);
    expect(blockValued(deDE)).toEqual([]);
  });

  it("resolves to something other than its own name", () => {
    // The same failure seen from the other side, and the one a reader would
    // actually notice.
    for (const source of [enUS, deDE]) {
      for (const key of blockValued(source)) {
        expect(t(key)).not.toBe(key);
      }
    }
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
