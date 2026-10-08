/**
 * Everything the UI needs from the outside world. In the desktop app it is
 * the Rust core over Tauri IPC; in a plain browser (dev preview, tests, E2E)
 * an in-memory demo project stands in, so the whole editor works anywhere.
 */
import type { DirEntry, FileContent, GitInfo, ReplaceResult, SearchOptions, SearchResult, ShellProfile } from "./types";

export interface PtyEvents {
  onData(cb: (id: number, data: string) => void): () => void;
  onExit(cb: (id: number, code: number | null) => void): () => void;
}

export interface Backend extends PtyEvents {
  readonly kind: "tauri" | "memory";

  listDir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<FileContent>;
  readBase64(path: string): Promise<string>;
  writeFile(path: string, content: string, lineEnding?: string, bom?: boolean): Promise<void>;
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string, toTrash?: boolean): Promise<void>;
  exists(path: string): Promise<boolean>;
  listFiles(root: string): Promise<string[]>;

  search(root: string, options: SearchOptions): Promise<SearchResult>;
  replace(root: string, options: SearchOptions, replacement: string, files?: string[]): Promise<ReplaceResult>;

  gitInfo(root: string): Promise<GitInfo>;
  gitHeadContent(root: string, rel: string): Promise<string | null>;
  gitStage(root: string, paths: string[]): Promise<void>;
  gitUnstage(root: string, paths: string[]): Promise<void>;
  gitDiscard(root: string, paths: string[]): Promise<void>;
  gitCommit(root: string, message: string): Promise<void>;
  gitInit(root: string): Promise<void>;

  /** `shell` alone is a command line ("bash --login"); with `args` it is the program. */
  ptySpawn(cwd: string, cols: number, rows: number, shell?: string, args?: string[]): Promise<number>;
  ptyWrite(id: number, data: string): Promise<void>;
  ptyResize(id: number, cols: number, rows: number): Promise<void>;
  ptyKill(id: number): Promise<void>;
  defaultShell(): Promise<string>;
  /** Installed shells for the "new terminal" menu, the system default first. */
  listShells(): Promise<ShellProfile[]>;

  watch(root: string): Promise<void>;
  unwatch(): Promise<void>;
  onFsChange(cb: (paths: string[]) => void): () => void;

  pickFolder(): Promise<string | null>;
  pickSaveFile(defaultPath?: string): Promise<string | null>;
  pickOpenFile(): Promise<string | null>;
  startupPath(): Promise<string | null>;
  /** The git checkout the app was built from, if it is on this machine. */
  sourceCheckout(): Promise<string | null>;
  revealInExplorer(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let instance: Backend | null = null;

export async function initBackend(): Promise<Backend> {
  if (instance) return instance;
  if (inTauri) {
    const { createTauriBackend } = await import("./tauriBackend");
    instance = createTauriBackend();
  } else {
    const { createMemoryBackend } = await import("./memoryBackend");
    instance = createMemoryBackend();
  }
  return instance;
}

export function backend(): Backend {
  if (!instance) throw new Error("Backend used before initBackend()");
  return instance;
}

/** Tests inject their own backend. */
export function setBackend(b: Backend | null) {
  instance = b;
}
