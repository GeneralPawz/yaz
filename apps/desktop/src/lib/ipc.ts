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
