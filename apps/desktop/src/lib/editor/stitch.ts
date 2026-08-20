/**
 * A document split across files, edited as one.
 *
 * [ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)
 * decides this and states the rules it has to keep. The short version: the
 * buffer holds the root document with every `\include` and `\input` expanded in
 * place, a segment map says which file each stretch of it came from, and every
 * edit is mapped back through that map to an edit in one file.
 *
 * # Everything here is a pure function
 *
 * Deliberately. The dangerous part of this feature is offset arithmetic — a map
 * that is wrong by one puts a character in the wrong chapter, and nothing says
 * so until the compile. Arithmetic that can only be observed by driving an
 * editor is arithmetic nobody checks, so reading files and applying changes
 * both happen outside: this takes the text it is given and returns what the
 * caller should write.
 *
 * # The seam
 *
 * The `\include{...}` command is not in the stitched text. It is replaced by
 * the file's content, so what is on screen is the document rather than the
 * document plus its plumbing; the seam is marked by a decoration, which costs
 * the text nothing.
 */

import { commentRanges } from "./structure";

/** One stretch of the stitched buffer, and where it came from. */
export interface Segment {
  /** Project-relative path of the file this came from. */
  file: string;
  /** Where it starts in the stitched buffer. */
  from: number;
  /** Where it ends in the stitched buffer. */
  to: number;
  /** The offset in `file` that `from` corresponds to. */
  fileFrom: number;
  /** How many files enclose this one. Zero for the root. */
  depth: number;
}

/** A file that was expanded, and where its seam sits in the buffer. */
export interface Seam {
  /** The file that was pulled in. */
  file: string;
  /** Where its content begins in the stitched buffer. */
  from: number;
  /** Where it ends. */
  to: number;
  depth: number;
}

/** The result of stitching. */
export interface Stitched {
  /** The buffer's text. */
  text: string;
  /**
   * Which file every offset belongs to, in order and without gaps.
   *
   * Total by construction: `segments[0].from` is 0, each segment's `to` is the
   * next one's `from`, and the last ends at `text.length`. Every mapping below
   * relies on that, so it is asserted by the tests rather than assumed.
   */
  segments: Segment[];
  /** The expanded files, for drawing seam markers. */
  seams: Seam[];
  /** Files that could not be read, left as their `\include` line. */
  missing: string[];
}

/** How deep `\include` chains are followed. */
const MAX_DEPTH = 8;

/** The commands that pull in another file. */
const INCLUDE = /\\(include|input|subfile)\s*\{([^}]*)\}/g;

/** Reads a project file, or returns `null` when there is no such file. */
export type ReadFile = (path: string) => string | null;

/**
 * Resolve an `\include` argument to a project path.
 *
 * LaTeX lets the extension be left off and treats the path as relative to the
 * main file's directory. Both are conventions rather than syntax, so both are
 * applied here rather than being pushed onto the caller.
 */
export function resolveInclude(argument: string, from: string): string {
  const directory = from.includes("/")
    ? from.slice(0, from.lastIndexOf("/"))
    : "";
  const raw = argument.trim();
  const joined = raw.startsWith("/")
    ? raw.slice(1)
    : directory
      ? `${directory}/${raw}`
      : raw;

  // Collapse `..` and `.`, which appear in every project that keeps its
  // chapters one directory down.
  const parts: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const path = parts.join("/");
  return path.endsWith(".tex") ? path : `${path}.tex`;
}

/** Every `\include`-like command in a text, outside comments. */
function includesIn(
  text: string,
): { from: number; to: number; argument: string }[] {
  const comments = commentRanges(text);
  const found: { from: number; to: number; argument: string }[] = [];

  for (const match of text.matchAll(INCLUDE)) {
    const at = match.index;
    // A commented-out `\include` is not part of the document, and expanding one
    // would pull a chapter the author deliberately switched off back in.
    if (comments.some((range) => at >= range.from && at < range.to)) continue;
    found.push({
      from: at,
      to: at + match[0].length,
      argument: match[2] ?? "",
    });
  }
  return found;
}

/**
 * Expand a document's includes into one text, with a map back.
 *
 * `read` is given a project-relative path and returns the file's text, or
 * `null` if there is no such file. A file that cannot be read is left as its
 * `\include` line: a document that silently loses a chapter because a path was
 * wrong is worse than one that shows a line the author can see is wrong.
 */
export function stitch(root: string, read: ReadFile): Stitched {
  const rootText = read(root);
  if (rootText === null) {
    return { text: "", segments: [], seams: [], missing: [root] };
  }

  const segments: Segment[] = [];
  const seams: Seam[] = [];
  const missing: string[] = [];
  let text = "";

  /** Expand one file into the output, recording where everything came from. */
  const expand = (
    file: string,
    source: string,
    depth: number,
    open: Set<string>,
  ) => {
    let cursor = 0;

    for (const include of includesIn(source)) {
      const path = resolveInclude(include.argument, file);
      const content = depth < MAX_DEPTH && !open.has(path) ? read(path) : null;

      if (content === null) {
        // Left in place, command and all. Also the cycle case: a file that
        // includes itself is a mistake, and hanging is not a diagnosis of it.
        if (depth < MAX_DEPTH && !open.has(path) && !missing.includes(path)) {
          missing.push(path);
        }
        continue;
      }

      // Everything up to the command belongs to this file.
      segments.push({
        file,
        from: text.length,
        to: text.length + (include.from - cursor),
        fileFrom: cursor,
        depth,
      });
      text += source.slice(cursor, include.from);

      const seamFrom = text.length;
      expand(path, content, depth + 1, new Set([...open, path]));
      seams.push({
        file: path,
        from: seamFrom,
        to: text.length,
        depth: depth + 1,
      });

      cursor = include.to;
    }

    // And whatever follows the last command.
    segments.push({
      file,
      from: text.length,
      to: text.length + (source.length - cursor),
      fileFrom: cursor,
      depth,
    });
    text += source.slice(cursor);
  };

  expand(root, rootText, 0, new Set([root]));

  // Empty segments are dropped last rather than never created: creating them
  // unconditionally keeps the expansion loop simple, and a zero-width segment
  // would make "which segment is this offset in" ambiguous at its position.
  return {
    text,
    segments: segments.filter((s) => s.to > s.from),
    seams,
    missing,
  };
}

/** Where an offset in the stitched buffer lives. */
export interface Location {
  file: string;
  /** The offset within that file. */
  offset: number;
}

/**
 * Which file an offset belongs to.
 *
 * # At a seam, the included file wins
 *
 * A seam has two edges and they pull in opposite directions. At the *start* of
 * a chapter the natural answer is that chapter; at its *end* the natural answer
 * is also that chapter. A rule that said "whichever segment ends here" gets the
 * second right and the first wrong — typing at the top of a chapter would put
 * the text in the root file, between `egin{document}` and the `\include`,
 * where it looks identical and is in the wrong file.
 *
 * So the deeper segment takes the boundary. Typing at either edge of a chapter
 * writes into the chapter, which is what the caret's position means to the
 * person who put it there.
 *
 * Between two adjacent chapters the depths are equal, and then the earlier one
 * takes it — the end of what you were typing continues what you were typing.
 */
export function locate(
  segments: readonly Segment[],
  offset: number,
): Location | null {
  const segment = segmentAt(segments, offset);
  if (!segment) return null;
  return {
    file: segment.file,
    offset: offset - segment.from + segment.fileFrom,
  };
}

/** The segment an offset belongs to, boundaries included. */
function segmentAt(
  segments: readonly Segment[],
  offset: number,
): Segment | undefined {
  let best: Segment | undefined;
  for (const segment of segments) {
    if (offset < segment.from || offset > segment.to) continue;
    if (!best || segment.depth > best.depth) best = segment;
  }
  return best;
}

/** A change, in the same shape CodeMirror describes one. */
export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** Changes to apply, grouped by the file they belong to. */
export interface MappedChanges {
  byFile: Map<string, Change[]>;
}

/** Why a change could not be mapped. */
export interface RefusedChange {
  /** Which change, by its offsets in the stitched buffer. */
  change: Change;
  reason: "spans-a-seam" | "outside-the-document";
}

/**
 * Map changes in the stitched buffer to changes in the files.
 *
 * A change that spans a seam is refused rather than guessed at: the replacement
 * text belongs to one file or the other and nothing in the document says which.
 * Refusing is a message; guessing is a corrupted chapter nobody notices until
 * the compile.
 */
export function mapChanges(
  segments: readonly Segment[],
  changes: readonly Change[],
): MappedChanges | { refused: RefusedChange[] } {
  const byFile = new Map<string, Change[]>();
  const refused: RefusedChange[] = [];

  for (const change of changes) {
    const segment = segmentFor(segments, change);
    if (!segment) {
      refused.push({
        change,
        reason: covered(segments, change)
          ? "spans-a-seam"
          : "outside-the-document",
      });
      continue;
    }

    const shift = segment.fileFrom - segment.from;
    const mapped: Change = {
      from: change.from + shift,
      to: change.to + shift,
      insert: change.insert,
    };
    byFile.set(segment.file, [...(byFile.get(segment.file) ?? []), mapped]);
  }

  return refused.length > 0 ? { refused } : { byFile };
}

/**
 * The one segment a change lies entirely within, if there is one.
 *
 * Deepest first, for the reason {@link locate} gives: a change at the edge of
 * an included file belongs to that file rather than to the one that contains
 * it. Bounds are inclusive at both ends, which is what makes a zero-width
 * insertion at a boundary land somewhere at all.
 */
function segmentFor(
  segments: readonly Segment[],
  change: Change,
): Segment | undefined {
  let best: Segment | undefined;
  for (const segment of segments) {
    if (change.from < segment.from || change.to > segment.to) continue;
    if (!best || segment.depth > best.depth) best = segment;
  }
  return best;
}

/** Whether a change lies inside the document at all, seams notwithstanding. */
function covered(segments: readonly Segment[], change: Change): boolean {
  const last = segments.at(-1);
  return (
    segments.length > 0 &&
    change.from >= segments[0]!.from &&
    change.to <= last!.to
  );
}

/**
 * Apply mapped changes to the files they belong to.
 *
 * Back to front within each file, so an earlier change does not move the
 * offsets of a later one that has not been applied yet.
 */
export function applyToFiles(
  files: ReadonlyMap<string, string>,
  mapped: MappedChanges,
): Map<string, string> {
  const out = new Map(files);

  for (const [file, changes] of mapped.byFile) {
    let text = out.get(file);
    if (text === undefined) continue;
    for (const change of [...changes].sort((a, b) => b.from - a.from)) {
      text = text.slice(0, change.from) + change.insert + text.slice(change.to);
    }
    out.set(file, text);
  }

  return out;
}

/** Every file the stitching drew from, in the order they appear. */
export function filesIn(segments: readonly Segment[]): string[] {
  const seen: string[] = [];
  for (const segment of segments) {
    if (!seen.includes(segment.file)) seen.push(segment.file);
  }
  return seen;
}
