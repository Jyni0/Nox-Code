import { create } from "zustand";
import { backend } from "@/lib/backend";
import type { DirEntry, GitFile, GitInfo } from "@/lib/types";
import { basename, dirname, isInside, join, relative, samePath } from "@/lib/path";
import { useSettings } from "./settings";
import { errorMessage, toast } from "./ui";

export interface PendingEdit {
  /** Folder the new entry goes in. */
  parent: string;
  kind: "file" | "folder";
}

interface WorkspaceState {
  root: string | null;
  children: Record<string, DirEntry[]>;
  expanded: Record<string, boolean>;
  selected: string | null;
  git: GitInfo | null;
  /** rel path → status, plus folders that contain changes ("•"). */
  gitDecorations: Record<string, GitFile | "dirty-folder">;
  fileList: string[] | null;
  creating: PendingEdit | null;
  renaming: string | null;
  loading: boolean;

  openFolder(path: string): Promise<void>;
  closeFolder(): Promise<void>;
  loadDir(path: string): Promise<void>;
  toggleDir(path: string, open?: boolean): Promise<void>;
  revealPath(path: string): Promise<void>;
  collapseAll(): void;
  select(path: string | null): void;
  refreshPaths(paths: string[]): Promise<void>;
  refreshTree(): Promise<void>;
  refreshGit(): Promise<void>;
  getFileList(force?: boolean): Promise<string[]>;
  startCreate(kind: "file" | "folder", parent?: string): void;
  startRename(path: string | null): void;
  cancelEdit(): void;
}

function decorate(info: GitInfo | null): WorkspaceState["gitDecorations"] {
  const out: WorkspaceState["gitDecorations"] = {};
  if (!info?.isRepo) return out;
  for (const f of info.files) {
    out[f.path] = f;
    let d = f.path;
    while (d.includes("/")) {
      d = d.slice(0, d.lastIndexOf("/"));
      if (!out[d]) out[d] = "dirty-folder";
    }
  }
  return out;
}

let gitTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  children: {},
  expanded: {},
  selected: null,
  git: null,
  gitDecorations: {},
  fileList: null,
  creating: null,
  renaming: null,
  loading: false,

  async openFolder(path) {
    const b = backend();
    set({ root: path, children: {}, expanded: { [path]: true }, selected: null, git: null, gitDecorations: {}, fileList: null, loading: true });
    useSettings.getState().pushRecent(path);
    try {
      await get().loadDir(path);
    } catch (e) {
      toast(`Cannot open folder: ${errorMessage(e)}`, "error");
      set({ root: null, loading: false });
      useSettings.getState().removeRecent(path);
      return;
    }
    set({ loading: false });
    void get().refreshGit();
    b.watch(path).catch(() => {});
  },

  async closeFolder() {
    await backend().unwatch().catch(() => {});
    set({ root: null, children: {}, expanded: {}, selected: null, git: null, gitDecorations: {}, fileList: null });
  },

  async loadDir(path) {
    const entries = await backend().listDir(path);
    set((s) => ({ children: { ...s.children, [path]: entries } }));
  },

  async toggleDir(path, open) {
    const isOpen = !!get().expanded[path];
    const next = open ?? !isOpen;
    set((s) => ({ expanded: { ...s.expanded, [path]: next } }));
    if (next && !get().children[path]) {
      try {
        await get().loadDir(path);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    }
  },

  async revealPath(path) {
    const root = get().root;
    if (!root || !isInside(root, path)) return;
    const chain: string[] = [];
    let d = dirname(path);
    while (d && isInside(root, d) && !samePath(d, root)) {
      chain.unshift(d);
      d = dirname(d);
    }
    for (const dir of chain) await get().toggleDir(dir, true);
    set({ selected: path });
  },

  collapseAll: () => set((s) => ({ expanded: s.root ? { [s.root]: true } : {} })),
  select: (path) => set({ selected: path }),

  /** Re-lists the folders that contain changed paths (from the watcher or our own ops). */
  async refreshPaths(paths) {
    const { root, children } = get();
    if (!root) return;
    if (paths.some((p) => p === ".git")) {
      void get().refreshGit();
    }
    const dirs = new Set<string>();
    for (const p of paths) {
      if (p === ".git" || !isInside(root, p)) continue;
      const parent = dirname(p);
      if (children[parent]) dirs.add(parent);
      if (children[p]) dirs.add(p);
    }
    await Promise.all([...dirs].map((d) => get().loadDir(d).catch(() => set((s) => {
      const next = { ...s.children };
      delete next[d];
      return { children: next };
    }))));
    set({ fileList: null });
    if (gitTimer) clearTimeout(gitTimer);
    gitTimer = setTimeout(() => void get().refreshGit(), 400);
  },

  async refreshTree() {
    const { children } = get();
    await Promise.all(Object.keys(children).map((d) => get().loadDir(d).catch(() => {})));
    set({ fileList: null });
    void get().refreshGit();
  },

  async refreshGit() {
    const root = get().root;
    if (!root) return;
    try {
      const info = await backend().gitInfo(root);
      if (get().root === root) set({ git: info, gitDecorations: decorate(info) });
    } catch {
      set({ git: null, gitDecorations: {} });
    }
  },

  async getFileList(force) {
    const { root, fileList } = get();
    if (!root) return [];
    if (fileList && !force) return fileList;
    const list = await backend().listFiles(root);
    if (get().root === root) set({ fileList: list });
    return list;
  },

  startCreate(kind, parent) {
    const { root, selected, children } = get();
    if (!root) return;
    let dir = parent ?? root;
    if (!parent && selected) {
      // Inside the selected folder, or next to the selected file.
      const isDir = Object.values(children).some((list) => list.some((e) => e.path === selected && e.isDir));
      dir = isDir ? selected : dirname(selected);
    }
    if (!samePath(dir, root)) void get().toggleDir(dir, true);
    set({ creating: { parent: dir, kind }, renaming: null });
  },
  startRename: (path) => set({ renaming: path, creating: null }),
  cancelEdit: () => set({ creating: null, renaming: null }),
}));

export const rootName = (root: string | null) => (root ? basename(root) : "No folder");

export function relPath(path: string): string {
  const root = useWorkspace.getState().root;
  return (root && relative(root, path)) || basename(path);
}

/** Unique "name copy", "name copy 2"… next to `path`. */
export async function uniqueSibling(path: string, suffix = " copy"): Promise<string> {
  const dir = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 100; i++) {
    const candidate = join(dir, `${stem}${suffix}${i > 1 ? " " + i : ""}${ext}`);
    if (!(await backend().exists(candidate))) return candidate;
  }
  return join(dir, `${stem}${suffix} ${Date.now()}${ext}`);
}
