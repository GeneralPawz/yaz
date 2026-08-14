/**
 * Minimal message resolution.
 *
 * ADR-0011 requires that no user-facing string is ever hardcoded, starting from
 * the first commit — the whole point being that localisation is not
 * retrofittable. The full ICU/Fluent runtime with locale chains and plural
 * selection is phase 3 work, but the *contract* has to exist now, or phase 2 UI
 * accrues literals that someone has to hunt down later.
 *
 * So this parses the simple `key = value` subset of `locales/en-US.ftl` and
 * resolves `{ $param }` placeholders. Multi-line selectors (plurals) are skipped
 * rather than half-parsed; asking for one yields its key, which is visible and
 * obviously wrong rather than subtly mistranslated.
 *
 * TODO(phase-3): replace with the real Fluent runtime — locale chain
 * (de-AT → de → en-US), plural categories, and plugin-supplied catalogues.
 */

import enUS from "../../../../locales/en-US.ftl?raw";

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

const catalogue = parse(enUS);

/** The active interface locale. Fixed until the locale chain lands in phase 3. */
export const locale = "en-US";

/**
 * Resolve a message key.
 *
 * Returns the key itself when absent, which makes a missing message visible in
 * the interface instead of rendering as an empty string.
 */
export function t(key: string, params?: Params): string {
  const template = catalogue.get(key);
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{\s*\$(\w+)\s*\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
