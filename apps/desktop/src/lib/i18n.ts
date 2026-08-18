/**
 * Minimal message resolution.
 *
 * ADR-0011 requires that no user-facing string is ever hardcoded, starting from
 * the first commit — the whole point being that localisation is not
 * retrofittable. The full ICU/Fluent runtime with locale chains and plural
 * selection is phase 3 work, but the *contract* has to exist now, or phase 2 UI
 * accrues literals that someone has to hunt down later.
 *
 * So this parses the simple `key = value` subset of the `.ftl` catalogues and
 * resolves `{ $param }` placeholders. Multi-line selectors (plurals) are skipped
 * rather than half-parsed; asking for one yields its key, which is visible and
 * obviously wrong rather than subtly mistranslated.
 *
 * # Falling back rather than failing
 *
 * A key the active locale does not have falls through to `en-US`, which is the
 * source of truth. A translation is never complete at the moment it lands, and
 * an interface with an English sentence in it is usable where one with a raw
 * `settings-appearance-build` is not.
 *
 * TODO(phase-3): replace with the real Fluent runtime — the full locale chain
 * (de-AT → de-DE → en-US), plural categories, and plugin-supplied catalogues.
 */

import enUS from "../../../../locales/en-US.ftl?raw";
import deDE from "../../../../locales/de-DE.ftl?raw";

import { active } from "./i18n-state.svelte";

type Params = Record<string, string | number>;

function parse(source: string): Map<string, string> {
  const messages = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    // Comments, blank lines, and continuation/selector lines (which start with
    // whitespace) are all skipped.
    if (!line || /^\s/.test(line) || line.startsWith("#")) continue;
    const match = /^([a-zA-Z][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key && value) messages.set(key, value);
  }
  return messages;
}

/** The locale that every other one falls back to. */
const SOURCE_LOCALE = "en-US";

const catalogues = new Map<string, Map<string, string>>([
  [SOURCE_LOCALE, parse(enUS)],
  ["de-DE", parse(deDE)],
]);

/** A language the interface can be shown in. */
export interface LocaleInfo {
  code: string;
  /**
   * The language's name in that language.
   *
   * Endonyms, because a list of languages is read by people looking for their
   * own: someone who cannot read the current interface can still find
   * "Deutsch", and could not find "German".
   */
  name: string;
}

/** Every language the interface can be shown in. */
export const availableLocales: readonly LocaleInfo[] = [
  { code: "en-US", name: "English" },
  { code: "de-DE", name: "Deutsch" },
];

/** The active interface locale. */
export function locale(): string {
  return active.locale;
}

/**
 * Change the interface language.
 *
 * An unknown locale is ignored rather than applied: a settings file carried
 * from a newer version naming a language this build does not have should leave
 * the interface in English, not empty.
 */
export function setLocale(code: string): void {
  if (catalogues.has(code)) active.locale = code;
}

/**
 * Resolve a message key.
 *
 * Returns the key itself when no catalogue has it, which makes a missing
 * message visible in the interface instead of rendering as an empty string.
 */
export function t(key: string, params?: Params): string {
  const template =
    catalogues.get(active.locale)?.get(key) ??
    catalogues.get(SOURCE_LOCALE)?.get(key);
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{\s*\$(\w+)\s*\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
