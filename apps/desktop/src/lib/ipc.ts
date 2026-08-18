/**
 * Typed wrappers over the Tauri command surface.
 *
 * Everything privileged lives behind these calls: the Rust process is the
 * security boundary (ADR-0006), and it owns the filesystem, compilation and
 * indexing. The editor buffer deliberately does *not* round-trip through here —
 * putting IPC on the keystroke path would break the latency budget in ADR-0015.
 */

import { invoke } from "@tauri-apps/api/core";

/** A file inside the open project. */
export interface ProjectFile {
  /** Path relative to the project root, using forward slashes. */
  relativePath: string;
  /** True for the file the compiler is pointed at. */
  isEntry: boolean;
}

/** The open project, as the backend sees it. */
export interface ProjectInfo {
  root: string;
  entry: string;
  files: ProjectFile[];
}

/** A diagnostic parsed out of the engine log. */
export interface CompileDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  file: string | null;
  line: number | null;
}

/** The outcome of a compile. */
export interface CompileResult {
  /**
   * Whether a usable PDF exists. Not the inverse of "has errors" — LaTeX
   * frequently emits both a diagnostic storm and a perfectly good document.
   */
  succeeded: boolean;
  /** Absolute path to the PDF, when one was produced. */
  pdfPath: string | null;
  /** Absolute path to the SyncTeX database, which inverse search reads. */
  synctexPath: string | null;
  diagnostics: CompileDiagnostic[];
  /** Which engine ran, e.g. `tectonic` or `system:pdflatex`. */
  engineId: string;
  elapsedMs: number;
}

/** Open a directory as a project and list the files worth showing. */
export function openProject(root: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("open_project", { root });
}

/** Read a project-relative file as text. */
export function readFile(root: string, relativePath: string): Promise<string> {
  return invoke<string>("read_file", { root, relativePath });
}

/** Write a project-relative file. */
export function writeFile(
  root: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  return invoke<void>("write_file", { root, relativePath, contents });
}

/** Compile the project's entry document. */
export function compile(root: string): Promise<CompileResult> {
  return invoke<CompileResult>("compile_project", { root });
}

/** An engine the user could pick, and whether they actually can. */
export interface EngineInfo {
  /** Stable identifier, e.g. `tectonic` or `system:xelatex`. */
  id: string;
  /** Display label. Engine binary names are not translated. */
  label: string;
  available: boolean;
  /** Message key explaining why not, when unavailable. */
  unavailableReasonKey: string | null;
}

/** Per-project settings, as persisted in `yaz.toml`. */
export interface ProjectSettings {
  engineId: string | null;
  entry: string | null;
  /** The stored pane arrangement, or null for a project not yet arranged. */
  workspace: string | null;
}

/**
 * Every engine yaz knows about, available or not.
 *
 * Unavailable ones are listed rather than hidden, because "Tectonic is not in
 * this build" is actionable and its silent absence is not.
 */
export function listEngines(): Promise<EngineInfo[]> {
  return invoke<EngineInfo[]>("list_engines");
}

/** Read the project's persisted settings. */
export function getProjectSettings(root: string): Promise<ProjectSettings> {
  return invoke<ProjectSettings>("get_project_settings", { root });
}

/** Persist the engine choice, writing `yaz.toml` into the project. */
export function setProjectEngine(
  root: string,
  engineId: string,
): Promise<void> {
  return invoke<void>("set_project_engine", { root, engineId });
}

/**
 * Tell the backend the UI has mounted, and get milliseconds since process start.
 *
 * "The window appeared" is not "the application is usable", and only the second
 * is what ADR-0015 budgets — measured from outside the process, window creation
 * reports ~90 ms while nothing is yet on screen.
 */
export function reportReady(): Promise<number> {
  return invoke<number>("report_ready");
}

/** Read a produced artefact as bytes — used to hand the PDF to pdf.js. */
/** Where in the source a point in the PDF came from. */
export interface SourceLocation {
  /** Project-relative when `inProject`, absolute otherwise. */
  path: string;
  inProject: boolean;
  /** One-based. */
  line: number;
}

/**
 * Inverse search: which source line produced a point in the PDF.
 *
 * `x` and `y` are PDF points from the top left of the page. Resolves to `null`
 * when the database has nothing to say, which is what a click on a blank part
 * of a page is.
 */
export async function locateInSource(
  root: string,
  synctexPath: string,
  page: number,
  x: number,
  y: number,
): Promise<SourceLocation | null> {
  return invoke<SourceLocation | null>("locate_in_source", {
    root,
    synctexPath,
    page,
    x,
    y,
  });
}

export async function readArtefact(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_artefact", { path });
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// The brokered plugin surface.
//
// Every one of these takes a `pluginId` and is refused by the capability broker
// in the Rust process before it does any work (ADR-0006). They are the only way
// a plugin reaches Zotero — there is no unbrokered path, which is what makes the
// Zotero bridge a genuine test of the plugin API rather than a privileged
// insider (ADR-0005).
// ---------------------------------------------------------------------------

/** Which Zotero source is answering, and whether it is current. */
export interface ZoteroStatus {
  source: "better-bibtex" | "local-api" | "exported-bib" | "sqlite" | "none";
  sourceKey: string;
  isLive: boolean;
  keysAreAuthoritative: boolean;
  dataDir: string | null;
  detail: string | null;
  /**
   * What probing the live source found, whatever the outcome.
   *
   * Separate from `source` because "Zotero is running but its local API is
   * switched off" is fixable in half a minute, and invisible if the user is
   * only told the library is being read offline.
   */
  liveStatusKey: string;
  /** Whether a live source was tried and then demoted after failing. */
  wasDemoted: boolean;
  /**
   * Whether Zotero is running and answering.
   *
   * Separate from `isLive`: queries read a copy of the database, because that
   * is far faster and covers group libraries too. So the source is offline
   * while the data is current, and this is what says so.
   */
  zoteroRunning: boolean;
  /** Libraries the live API reported — personal plus groups. */
  libraryCount: number;
}

/** A library item. */
export interface ZoteroItem {
  key: string;
  citationKey: string | null;
  itemType: string;
  title: string;
  creators: string[];
  year: number | null;
  container: string | null;
}

/** A passage a reader marked in an attachment. */
export interface ZoteroAnnotation {
  key: string;
  itemKey: string;
  kind: "highlight" | "note" | "image" | "ink" | "underline" | "other";
  kindKey: string;
  text: string;
  comment: string | null;
  color: string | null;
  /** Null when the attachment has no pagination. */
  pageLabel: string | null;
  isQuotable: boolean;
}

/** The outcome of ensuring an item is citable from this project. */
export interface CitationKey {
  key: string;
  added: boolean;
  bibliography: string;
  isAuthoritative: boolean;
}

/** Which source is serving library queries. */
export function zoteroStatus(pluginId: string): Promise<ZoteroStatus> {
  return invoke<ZoteroStatus>("plugin_zotero_status", { pluginId });
}

/** Search the library. An empty query lists recent items. */
export function zoteroSearch(
  pluginId: string,
  query: string,
  limit = 50,
): Promise<ZoteroItem[]> {
  return invoke<ZoteroItem[]>("plugin_zotero_search", {
    pluginId,
    query,
    limit,
  });
}

/** Every passage a reader marked in an item. */
export function zoteroAnnotations(
  pluginId: string,
  itemKey: string,
): Promise<ZoteroAnnotation[]> {
  return invoke<ZoteroAnnotation[]>("plugin_zotero_annotations", {
    pluginId,
    itemKey,
  });
}

/** Ensure an item is in the project bibliography and return its citation key. */
export function zoteroEnsureInBibliography(
  pluginId: string,
  root: string,
  itemKey: string,
  bibliography?: string,
): Promise<CitationKey> {
  return invoke<CitationKey>("plugin_zotero_ensure_in_bibliography", {
    pluginId,
    root,
    itemKey,
    bibliography: bibliography ?? null,
  });
}

/** Re-probe the Zotero sources, e.g. after the user starts Zotero. */
export function zoteroReconnect(pluginId: string): Promise<void> {
  return invoke<void>("plugin_zotero_reconnect", { pluginId });
}

/** A bundled core plugin, as the Rust side reports it. */
export interface CorePlugin {
  id: string;
  name: string;
  description: string;
  /** Capability identifiers its manifest declares. */
  capabilities: string[];
}

/**
 * Load the bundled core plugins and report what was granted.
 *
 * Note what is missing: there is no way to *request* a capability from here.
 * The Rust side reads each plugin's manifest and grants from that, because a
 * capability list supplied by the webview would make the broker decorative.
 */
export function pluginList(): Promise<CorePlugin[]> {
  return invoke<CorePlugin[]>("plugin_list");
}

/** Rescope plugin filesystem capabilities to the open project. */
export function pluginSetProject(root: string | null): Promise<void> {
  return invoke<void>("plugin_set_project", { root });
}

/**
 * Point the Zotero bridge at a specific data directory, or `null` to rediscover.
 *
 * Needed because a machine can hold several Zotero profiles pointing at
 * different libraries, and picking the wrong one does not fail — it succeeds
 * against an empty database and looks like "Zotero isn't set up".
 */
export function zoteroSetDataDir(
  pluginId: string,
  path: string | null,
): Promise<ZoteroStatus> {
  return invoke<ZoteroStatus>("plugin_set_zotero_data_dir", { pluginId, path });
}

/** Persist the pane arrangement for a project. */
export function setProjectWorkspace(
  root: string,
  workspace: string,
): Promise<void> {
  return invoke<void>("set_project_workspace", { root, workspace });
}

/** A project opened before. */
export interface RecentProject {
  /** Folder name, which is what a menu shows. */
  name: string;
  /** Full path, used to reopen and as the tooltip. */
  root: string;
}

/**
 * Projects opened before, most recent first.
 *
 * Folders that have since gone are filtered out by the backend: a menu entry
 * that always fails is worse than one that is not there.
 */
export function recentProjects(): Promise<RecentProject[]> {
  return invoke<RecentProject[]>("recent_projects");
}

// ---------------------------------------------------------------------------
// Version control.
//
// Switching it off is a settings line, never a deletion: there is deliberately
// no command that removes a repository. See crates/yaz-app/src/vcs_commands.rs.
// ---------------------------------------------------------------------------

/** One recorded version. */
export interface Commit {
  id: string;
  shortId: string;
  summary: string;
  author: string;
  /** ISO-8601, formatted by the backend. */
  timestamp: string;
}

/** A version-control backend the user could choose. */
export interface VcsBackend {
  id: string;
  labelKey: string;
  available: boolean;
}

/** Whether a project is being recorded, and the state of its history. */
export interface VcsStatus {
  /** Whether yaz is recording versions for this project. */
  enabled: boolean;
  backend: string;
  /** Whether that backend works on this machine. */
  available: boolean;
  /** Whether the project has a history at all. */
  initialised: boolean;
  /** Whether anything differs from the last recorded version. */
  dirty: boolean;
  head: Commit | null;
}

/** Every backend, whether or not it works here. */
export function vcsBackends(): Promise<VcsBackend[]> {
  return invoke<VcsBackend[]>("vcs_backends");
}

/** Whether a project is being recorded. */
export function vcsStatus(root: string): Promise<VcsStatus> {
  return invoke<VcsStatus>("vcs_status", { root });
}

/** Start recording versions, creating the repository if there is none. */
export function vcsEnable(root: string, backend: string): Promise<VcsStatus> {
  return invoke<VcsStatus>("vcs_enable", { root, backend });
}

/** Stop recording. Leaves the repository and every version untouched. */
export function vcsDisable(root: string): Promise<VcsStatus> {
  return invoke<VcsStatus>("vcs_disable", { root });
}

/**
 * Record a version.
 *
 * Omit `message` to have one generated from what changed. A message the author
 * wrote always wins; the backend never overrules it.
 */
export function vcsCommit(
  root: string,
  message?: string,
): Promise<Commit | null> {
  return invoke<Commit | null>("vcs_commit", {
    root,
    message: message ?? null,
  });
}

/** Recorded versions, most recent first. */
export function vcsHistory(root: string): Promise<Commit[]> {
  return invoke<Commit[]>("vcs_history", { root });
}

/** Put the project back to a recorded version. */
export function vcsRestore(root: string, commit: string): Promise<void> {
  return invoke<void>("vcs_restore", { root, commit });
}

// ---------------------------------------------------------------------------
// Appearance: themes, colour mode, interface language.

/** A theme that can be chosen. */
export interface ThemeInfo {
  id: string;
  /** The author's own name for it, so it is data rather than a message key. */
  name: string;
  author: string;
  version: string;
  description: string;
  /** Whether it ships with the application. */
  bundled: boolean;
}

/** What the interface looks like and speaks. */
export interface Appearance {
  theme: string;
  colourMode: "system" | "light" | "dark";
  interfaceLocale: string;
}

export async function getAppearance(): Promise<Appearance> {
  return invoke<Appearance>("get_appearance");
}

export async function setAppearance(appearance: Appearance): Promise<void> {
  return invoke("set_appearance", { appearance });
}

export async function listThemes(): Promise<ThemeInfo[]> {
  return invoke<ThemeInfo[]>("list_themes");
}

/** The stylesheet of an installed theme; empty for the bundled one. */
export async function themeStylesheet(id: string): Promise<string> {
  return invoke<string>("theme_stylesheet", { id });
}

/** Write a theme bundle into a folder. Resolves to where it was written. */
export async function exportTheme(
  directory: string,
  manifest: string,
  css: string,
): Promise<string> {
  return invoke<string>("export_theme", { directory, manifest, css });
}

/** Write a theme bundle into the themes folder, ready to be chosen. */
export async function saveTheme(
  manifest: string,
  css: string,
): Promise<ThemeInfo> {
  return invoke<ThemeInfo>("save_theme", { manifest, css });
}

/** Copy a theme bundle into the themes folder. */
export async function installTheme(source: string): Promise<ThemeInfo> {
  return invoke<ThemeInfo>("install_theme", { source });
}
