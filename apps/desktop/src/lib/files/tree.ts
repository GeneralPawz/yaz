/**
 * The project's files, as a tree.
 *
 * # Why the tree is built here rather than sent
 *
 * The scan returns a flat list of paths, which is what a walk produces and
 * what a filter operates on. A tree is a *view* of that list: which folders
 * are open, what is hidden, what is dimmed — all of it changes as the user
 * clicks, and none of it is worth a round trip to the filesystem.
 *
 * So the list crosses once and the shape is worked out here, where the
 * switches are.
 */

/** What a file is, as the scan classified it. */
export type FileKind =
  "tex" | "bib" | "style" | "pdf" | "image" | "build" | "other";

/** One entry from the scan. */
export interface ProjectFile {
  relativePath: string;
  isEntry: boolean;
  kind: FileKind;
}

/** A file in the tree. */
export interface FileNode {
  type: "file";
  /** What to show. */
  name: string;
  /** The path the editor opens. */
  path: string;
  isEntry: boolean;
  kind: FileKind;
  /** How deep, for indenting. */
  depth: number;
  /** Whether it is inside a dotted folder, or is one itself. */
  hidden: boolean;
}

/** A folder in the tree. */
export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  depth: number;
  hidden: boolean;
  children: Node[];
}

export type Node = FileNode | FolderNode;

/** What the file list is currently showing. */
export interface Filters {
  /** Whether folders whose name starts with a dot appear at all. */
  showHidden: boolean;
  /** Whether formats yaz has no particular use for appear. */
  showOther: boolean;
  /** Whether what a compile produced appears. */
  showBuild: boolean;
}

/** Everything shown, which is what a fresh project starts with. */
export const ALL_VISIBLE: Filters = {
  showHidden: false,
  showOther: true,
  showBuild: true,
};

/** Whether a path lies inside a dotted folder, or is one. */
function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Build the tree, applying the filters.
 *
 * A folder left with nothing in it after filtering is dropped too — a project
 * whose `output/` is hidden should not still show an `output` folder that
 * opens onto nothing.
 */
export function buildTree(
  files: readonly ProjectFile[],
  filters: Filters,
): Node[] {
  const roots: Node[] = [];
  const folders = new Map<string, FolderNode>();

  const wanted = files.filter((file) => {
    if (!filters.showHidden && isHidden(file.relativePath)) return false;
    if (!filters.showBuild && file.kind === "build") return false;
    if (!filters.showOther && file.kind === "other") return false;
    return true;
  });

  /** The folder at a path, creating it and its parents as needed. */
  const folderAt = (path: string): FolderNode | null => {
    if (path === "") return null;
    const existing = folders.get(path);
    if (existing) return existing;

    const cut = path.lastIndexOf("/");
    const parent = cut === -1 ? null : folderAt(path.slice(0, cut));
    const node: FolderNode = {
      type: "folder",
      name: cut === -1 ? path : path.slice(cut + 1),
      path,
      depth: parent ? parent.depth + 1 : 0,
      hidden: isHidden(path),
      children: [],
    };
    folders.set(path, node);
    (parent ? parent.children : roots).push(node);
    return node;
  };

  for (const file of wanted) {
    const cut = file.relativePath.lastIndexOf("/");
    const parent =
      cut === -1 ? null : folderAt(file.relativePath.slice(0, cut));
    const node: FileNode = {
      type: "file",
      name: cut === -1 ? file.relativePath : file.relativePath.slice(cut + 1),
      path: file.relativePath,
      isEntry: file.isEntry,
      kind: file.kind,
      depth: parent ? parent.depth + 1 : 0,
      hidden: isHidden(file.relativePath),
    };
    (parent ? parent.children : roots).push(node);
  }

  sort(roots);
  return roots;
}

/**
 * Folders before files, then by name.
 *
 * How every file manager does it, and the reason is navigational: folders are
 * where you go next and files are where you stop, so the things you might open
 * to keep looking are gathered at the top.
 */
function sort(nodes: Node[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  for (const node of nodes) {
    if (node.type === "folder") sort(node.children);
  }
}

/**
 * The tree flattened to the rows actually on screen.
 *
 * A closed folder contributes itself and nothing beneath it. Flattening rather
 * than rendering recursively keeps the markup one loop, which is what makes
 * keyboard navigation and virtualisation possible later without rewriting it.
 */
export function visibleRows(
  nodes: readonly Node[],
  open: ReadonlySet<string>,
): Node[] {
  const rows: Node[] = [];
  const walk = (list: readonly Node[]) => {
    for (const node of list) {
      rows.push(node);
      if (node.type === "folder" && open.has(node.path)) walk(node.children);
    }
  };
  walk(nodes);
  return rows;
}

/**
 * The folders to open so a project reads as its author left it.
 *
 * Every folder on the way to the entry document, and nothing else. Opening
 * everything buries the file that matters in a project with an `images/` of
 * two hundred; opening nothing means the first thing anyone does is click
 * three times to find where they were.
 */
export function initiallyOpen(files: readonly ProjectFile[]): Set<string> {
  const entry = files.find((file) => file.isEntry);
  const open = new Set<string>();
  if (!entry) return open;

  const segments = entry.relativePath.split("/");
  segments.pop();
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    open.add(path);
  }
  return open;
}
