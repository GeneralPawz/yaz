/**
 * Applying a theme, and the vocabulary the theme builder edits.
 *
 * # A theme is one thing that provides two modes
 *
 * Not two themes. [ADR-0010](https://generalpawz.github.io/yaz/adr/0010-theming)
 * requires every theme to supply light *and* dark, so choosing a theme and
 * choosing a mode are independent choices and neither can take the other away.
 *
 * Which means applying a theme is two attributes on the root element and
 * nothing else: `data-yaz-theme` picks the palette, `data-yaz-mode` picks which
 * half of it. The stylesheet is already loaded; there is no reflow, no flash,
 * and no second copy of anything.
 *
 * `system` never reaches the document. It is resolved against the platform
 * first, because a stylesheet cannot express "whatever the operating system
 * says" without duplicating every rule inside a media query.
 */

/** What the user chose. */
export type ColourMode = "system" | "light" | "dark";

/** What the document is actually showing. */
export type ResolvedMode = "light" | "dark";

/** The theme compiled into the application. */
export const BUNDLED_THEME = "yaz";

/** Every mode, in the order the settings offer them. */
export const COLOUR_MODES: readonly ColourMode[] = ["system", "light", "dark"];

/** What the platform is asking for. */
export function systemMode(): ResolvedMode {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The mode the document should show for a choice. */
export function resolveMode(mode: ColourMode): ResolvedMode {
  return mode === "system" ? systemMode() : mode;
}

/** Put a theme and a mode on the document. */
export function applyAppearance(theme: string, mode: ColourMode): void {
  const root = document.documentElement;
  root.dataset.yazTheme = theme;
  root.dataset.yazMode = resolveMode(mode);
}

/**
 * Follow the platform while the choice is `system`.
 *
 * Returns the unsubscribe. Without this, choosing "system" would follow the
 * platform once — at startup — and then stay wherever it landed when the
 * machine switched at sunset.
 */
export function watchSystemMode(onchange: () => void): () => void {
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => {};
  query.addEventListener("change", onchange);
  return () => query.removeEventListener("change", onchange);
}

/**
 * A stylesheet for an installed theme, held in one element.
 *
 * After the bundled styles and before any plugin's, which is the cascade
 * position ADR-0010 fixes: a plugin styles its own interface in terms of the
 * tokens and inherits whatever theme is active.
 */
export function applyStylesheet(css: string): void {
  let element = document.querySelector<HTMLStyleElement>("style#yaz-theme");
  if (!element) {
    element = document.createElement("style");
    element.id = "yaz-theme";
    document.head.append(element);
  }
  element.textContent = css;
}

/** One editable colour. */
export interface TokenField {
  /** The custom property, without the leading dashes. */
  token: string;
  labelKey: string;
}

/** A group of them, as the builder lays them out. */
export interface TokenGroup {
  titleKey: string;
  fields: TokenField[];
}

/**
 * What the theme builder edits.
 *
 * A deliberate subset of the contract, not all of it. The full vocabulary is
 * around fifty properties, most of which are derived from these — a builder
 * offering every one is a form nobody finishes, and a theme that sets every one
 * cannot inherit an improvement to the defaults. Anything not here stays
 * whatever the token contract says, which is what a theme file would do too.
 *
 * Only opaque colours: `<input type="color">` cannot express the translucent
 * tokens (`--yaz-bg-hover`, the selection tint, the modal scrim), and rounding
 * them to opaque would visibly break the surfaces they sit on. A theme author
 * editing the file by hand still has them.
 */
export const THEME_TOKENS: readonly TokenGroup[] = [
  {
    titleKey: "theme-group-surfaces",
    fields: [
      { token: "yaz-bg-primary", labelKey: "theme-token-bg-primary" },
      { token: "yaz-bg-secondary", labelKey: "theme-token-bg-secondary" },
      { token: "yaz-bg-tertiary", labelKey: "theme-token-bg-tertiary" },
      { token: "yaz-bg-overlay", labelKey: "theme-token-bg-overlay" },
    ],
  },
  {
    titleKey: "theme-group-text",
    fields: [
      { token: "yaz-text-primary", labelKey: "theme-token-text-primary" },
      { token: "yaz-text-secondary", labelKey: "theme-token-text-secondary" },
      { token: "yaz-text-muted", labelKey: "theme-token-text-muted" },
    ],
  },
  {
    titleKey: "theme-group-accent",
    fields: [
      { token: "yaz-accent", labelKey: "theme-token-accent" },
      { token: "yaz-accent-hover", labelKey: "theme-token-accent-hover" },
      { token: "yaz-text-on-accent", labelKey: "theme-token-text-on-accent" },
    ],
  },
  {
    titleKey: "theme-group-state",
    fields: [
      { token: "yaz-success", labelKey: "theme-token-success" },
      { token: "yaz-warning", labelKey: "theme-token-warning" },
      { token: "yaz-error", labelKey: "theme-token-error" },
    ],
  },
  {
    titleKey: "theme-group-borders",
    fields: [
      { token: "yaz-border", labelKey: "theme-token-border" },
      { token: "yaz-border-strong", labelKey: "theme-token-border-strong" },
    ],
  },
  {
    titleKey: "theme-group-editor",
    fields: [
      { token: "yaz-editor-bg", labelKey: "theme-token-editor-bg" },
      {
        token: "yaz-editor-gutter-bg",
        labelKey: "theme-token-editor-gutter-bg",
      },
      { token: "yaz-editor-cursor", labelKey: "theme-token-editor-cursor" },
    ],
  },
  {
    titleKey: "theme-group-syntax",
    fields: [
      { token: "yaz-syntax-command", labelKey: "theme-token-syntax-command" },
      {
        token: "yaz-syntax-environment",
        labelKey: "theme-token-syntax-environment",
      },
      { token: "yaz-syntax-math", labelKey: "theme-token-syntax-math" },
      { token: "yaz-syntax-comment", labelKey: "theme-token-syntax-comment" },
      { token: "yaz-syntax-string", labelKey: "theme-token-syntax-string" },
      {
        token: "yaz-syntax-reference",
        labelKey: "theme-token-syntax-reference",
      },
    ],
  },
  {
    titleKey: "theme-group-headings",
    fields: [
      { token: "yaz-heading-0", labelKey: "theme-token-heading-0" },
      { token: "yaz-heading-1", labelKey: "theme-token-heading-1" },
      { token: "yaz-heading-2", labelKey: "theme-token-heading-2" },
      { token: "yaz-heading-3", labelKey: "theme-token-heading-3" },
      { token: "yaz-heading-4", labelKey: "theme-token-heading-4" },
    ],
  },
  {
    titleKey: "theme-group-pdf",
    fields: [{ token: "yaz-pdf-bg", labelKey: "theme-token-pdf-bg" }],
  },
];

/** Every token the builder edits, flattened. */
export function editableTokens(): string[] {
  return THEME_TOKENS.flatMap((group) =>
    group.fields.map((field) => field.token),
  );
}

/** Values for both modes. */
export type Palette = Record<ResolvedMode, Record<string, string>>;

/**
 * Read the theme's own values for both modes.
 *
 * The document is switched to each mode in turn and the computed values are
 * read back, which is the only way to see what a mode looks like without
 * parsing the stylesheet — and parsing it would mean reimplementing the
 * cascade. The original mode is restored before anything is painted, because
 * the whole read happens inside one synchronous frame.
 */
export function readPalette(): Palette {
  const root = document.documentElement;
  const before = root.dataset.yazMode;
  const palette: Palette = { light: {}, dark: {} };

  for (const mode of ["light", "dark"] as ResolvedMode[]) {
    root.dataset.yazMode = mode;
    const computed = getComputedStyle(root);
    for (const token of editableTokens()) {
      palette[mode][token] = normaliseColour(
        computed.getPropertyValue(`--${token}`).trim(),
      );
    }
  }

  if (before) root.dataset.yazMode = before;
  else delete root.dataset.yazMode;
  return palette;
}

/**
 * A colour a `<input type="color">` will accept.
 *
 * It takes `#rrggbb` and nothing else — handed `rgb(22, 24, 28)` it silently
 * shows black, which looks like the theme rather than like the input.
 */
export function normaliseColour(value: string): string {
  const text = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(text) ?? [];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) {
    const hex = rgb
      .slice(1, 4)
      .map((part) => Math.round(Number(part)).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  return "#000000";
}

/** Preview a palette by setting the tokens directly on the document. */
export function previewPalette(values: Record<string, string>): void {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(values)) {
    root.style.setProperty(`--${token}`, value);
  }
}

/** Take the preview back off. */
export function clearPreview(): void {
  const root = document.documentElement;
  for (const token of editableTokens()) {
    root.style.removeProperty(`--${token}`);
  }
}

/** Render a palette as the `theme.css` of a bundle. */
export function stylesheetFor(
  id: string,
  name: string,
  palette: Palette,
): string {
  const block = (mode: ResolvedMode) => {
    const rules = Object.entries(palette[mode])
      .map(([token, value]) => `  --${token}: ${value};`)
      .join("\n");
    return `[data-yaz-theme="${id}"][data-yaz-mode="${mode}"] {\n${rules}\n}`;
  };

  return [
    `/*`,
    ` * ${name} — a yaz theme.`,
    ` *`,
    ` * Both modes, because a theme provides both. Anything not set here keeps`,
    ` * whatever themes/tokens.css says, so this file can stay short and still`,
    ` * inherit improvements to the defaults.`,
    ` */`,
    "",
    block("light"),
    "",
    block("dark"),
    "",
  ].join("\n");
}

/** Render the manifest of a bundle. */
export function manifestFor(
  id: string,
  name: string,
  author: string,
  appVersion: string,
): string {
  return `${JSON.stringify(
    {
      id,
      name,
      version: "1.0.0",
      minAppVersion: appVersion,
      author,
      description: "",
      modes: ["light", "dark"],
      tokensVersion: 2,
    },
    null,
    2,
  )}\n`;
}

/**
 * A folder name from a theme's name.
 *
 * The identifier is what the folder is called and what the stylesheet selects
 * on, so it has to survive a filesystem and a CSS attribute selector.
 */
export function themeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "theme";
}
