/**
 * The document's date, as a person means it and as LaTeX writes it.
 *
 * # Why this is not a text field
 *
 * `\date{}` takes three quite different things and looks the same for all of
 * them. `\today` is "whenever this is compiled", which is what most people
 * want and almost nobody would type. An empty argument means "no date at all",
 * which is not the same as leaving the command out — leaving it out gets you
 * today's date, and writing `\date{}` gets you none. And anything else is a
 * literal string that LaTeX prints exactly as given.
 *
 * A text field showing `\today` teaches the author a command; a text field
 * showing nothing cannot distinguish "no date" from "not set". So the ribbon
 * offers the three choices by name and this turns the choice into the source.
 *
 * # A date is written the way the document's language writes it
 *
 * A fixed date typed into `\date{}` is printed verbatim, so `2026-08-19` comes
 * out as `2026-08-19` in a German thesis. The formatting therefore follows the
 * document's own language rather than the interface's — the reader of the PDF
 * is the person it has to read correctly for.
 */

/** What the author chose. */
export type DateChoice =
  /** `\today` — resolved when the document is compiled. */
  | { kind: "today" }
  /** `\date{}` — the document deliberately shows no date. */
  | { kind: "none" }
  /** A specific day, held as `YYYY-MM-DD` so a date input can show it. */
  | { kind: "on"; iso: string }
  /**
   * Something the author wrote that this does not model — "Michaelmas Term
   * 2026", a `\DTMdate{}`, a macro of their own.
   *
   * Kept and shown as-is rather than replaced by a guess. Offering to reduce
   * it to a calendar date would quietly throw away something deliberate.
   */
  | { kind: "literal"; text: string };

/** Read the choice out of a `\date{...}` argument. */
export function readDate(argument: string | null): DateChoice {
  // No `\date` at all behaves like `\today`, which is LaTeX's own default and
  // the honest thing to show for it.
  if (argument === null) return { kind: "today" };

  const text = argument.trim();
  if (text === "") return { kind: "none" };
  if (text === "\\today") return { kind: "today" };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return { kind: "on", iso: text };

  return { kind: "literal", text };
}

/** What to put between the braces of `\date{...}`. */
export function writeDate(choice: DateChoice): string {
  switch (choice.kind) {
    case "today":
      return "\\today";
    case "none":
      return "";
    case "on":
      return choice.iso;
    case "literal":
      return choice.text;
  }
}

/**
 * A date as the document's language writes it.
 *
 * Used for the label beside the picker, so the author can see what the reader
 * will see. Falls back to the ISO form for a language this does not know,
 * which is unambiguous and obviously machine-written rather than wrong.
 */
export function formatDate(iso: string, language: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;

  const [, year, month, day] = parts as unknown as [
    string,
    string,
    string,
    string,
  ];
  const locale = LOCALES[language];
  if (!locale) return iso;

  try {
    // Constructed as UTC so that a date near midnight does not shift a day
    // depending on where the author is sitting.
    const when = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(when);
  } catch {
    return iso;
  }
}

/** The babel language names, as the platform's formatter knows them. */
const LOCALES: Record<string, string> = {
  english: "en-GB",
  ngerman: "de-DE",
  german: "de-DE",
  french: "fr-FR",
  spanish: "es-ES",
  italian: "it-IT",
};
