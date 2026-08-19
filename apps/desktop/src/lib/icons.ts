/**
 * The drawings, in one place.
 *
 * Shared rather than copied, because the menus and the ribbon show the same
 * commands and a command has to look the same in both. Two copies of a path
 * means the day someone improves the save icon it improves in one of them, and
 * the difference is invisible until a user notices two save buttons that are
 * not the same shape.
 *
 * # Named ideas, not named pictures
 *
 * `folder` is "open", wherever opening happens. That is what makes a ribbon
 * scannable: the eye learns one mark and finds it again, rather than learning
 * a mark per menu entry.
 *
 * # Inline paths rather than an icon font
 *
 * A font is a network request, a licence and a flash of missing glyphs, for a
 * couple of dozen shapes that between them are smaller than the request would
 * have been.
 */

/** Every icon there is. */
export type IconName =
  | "folder"
  | "clock"
  | "save"
  | "play"
  | "close"
  | "undo"
  | "redo"
  | "search"
  | "settings"
  | "text"
  | "list"
  | "layout"
  | "numbers"
  | "plug"
  | "wrench"
  | "book"
  | "bug"
  | "info"
  | "branch"
  | "page"
  | "wrap"
  | "columns"
  | "person"
  | "calendar"
  | "heading"
  | "globe"
  | "code";

/**
 * SVG path data on a 16-unit grid.
 *
 * Typed against {@link IconName} rather than inferred from it, so a name
 * without a drawing is a compile error — the check runs in the direction that
 * catches the mistake anyone actually makes.
 */
export const ICONS: Record<IconName, string> = {
  folder: "M2 4.5h4l1.2 1.5H14v6.5H2z",
  clock: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2.2 1.3",
  save: "M3 3h7.5L13 5.5V13H3zM5.5 3v3.5h5V3M5.5 13V9h5v4",
  play: "M5 3.5l7 4.5-7 4.5z",
  close: "M4 4l8 8M12 4l-8 8",
  undo: "M6 5.5H10a3 3 0 010 6H6M6 5.5L8.5 3M6 5.5L8.5 8",
  redo: "M10 5.5H6a3 3 0 000 6h4M10 5.5L7.5 3M10 5.5L7.5 8",
  search: "M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.5 10.5L14 14",
  settings:
    "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5l1 1.8 2-.5.4 2 1.8 1-1 1.7 1 1.7-1.8 1-.4 2-2-.5-1 1.8-1-1.8-2 .5-.4-2-1.8-1 1-1.7-1-1.7 1.8-1 .4-2 2 .5z",
  text: "M3 4h10M3 8h10M3 12h6",
  list: "M6 4h8M6 8h8M6 12h8M3 4h.01M3 8h.01M3 12h.01",
  layout: "M2.5 3h11v10h-11zM6.5 3v10M6.5 8h7",
  numbers: "M3 4h1v4M3 8h2M9 4h4M9 8h4M9 12h4M3 11h2v3H3z",
  plug: "M6 2v4M10 2v4M4.5 6h7v2.5a3.5 3.5 0 01-7 0zM8 12v2",
  wrench: "M11 2.5a3 3 0 00-3.9 3.9L2.5 11l2.5 2.5 4.6-4.6A3 3 0 0011 2.5z",
  book: "M3 3h4.5a1.5 1.5 0 011.5 1.5V13a1.5 1.5 0 00-1.5-1.5H3zM13 3H8.5A1.5 1.5 0 007 4.5V13a1.5 1.5 0 011.5-1.5H13z",
  bug: "M5 6a3 3 0 016 0v3a3 3 0 01-6 0zM5 7H2.5M11 7h2.5M5 10H3M11 10h2M6 4L4.5 2.5M10 4l1.5-1.5",
  info: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 7v4M8 5h.01",
  branch:
    "M5 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 6.5v3M11 6.5c0 2-2 3-6 3",
  /** A sheet of paper with a margin, for the page view and the paper size. */
  page: "M3.5 1.5h9v13h-9zM5.5 4.5h5M5.5 7h5M5.5 9.5h3",
  /** A line that comes back round. */
  wrap: "M3 4h10M3 8h7a2.5 2.5 0 010 5H8M8 11l-2 2 2 2",
  /** Two columns, for the ribbon standing on its side. */
  columns: "M2.5 2.5h4v11h-4zM9.5 2.5h4v11h-4z",
  person: "M8 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 14a5 5 0 0110 0",
  calendar: "M2.5 4h11v9.5h-11zM2.5 6.5h11M5.5 2.5v3M10.5 2.5v3",
  /** A large A over a small one. */
  heading: "M2 13l3.5-9 3.5 9M3.2 10.2h4.6M11 13l2-5 2 5M11.8 11.5h2.4",
  globe:
    "M8 2a6 6 0 100 12A6 6 0 008 2zM2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12",
  code: "M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4",
};
