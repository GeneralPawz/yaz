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
export function writeFile(root: string, relativePath: string, contents: string): Promise<void> {
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
  /**
   * The source language this engine compiles.
   *
   * The engines are **not** interchangeable. Tectonic and the system engines are
   * two ways to typeset the same `.tex`; Typst is a different language whose
   * projects are `.typ`. Picking one whose language does not match the project
   * is refused by the backend, so the picker groups by this rather than
   * presenting a flat list.
   */
  language: "latex" | "typst";
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
export function setProjectEngine(root: string, engineId: string): Promise<void> {
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
