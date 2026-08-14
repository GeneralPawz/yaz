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

/** Which engines this build can actually run. */
export function availableEngines(): Promise<string[]> {
  return invoke<string[]>("available_engines");
}

/** Read a produced artefact as bytes — used to hand the PDF to pdf.js. */
export async function readArtefact(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_artefact", { path });
  return new Uint8Array(bytes);
}
