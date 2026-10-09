import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Backend, CheckOutput } from "./backend";

/** Subscribes to a Tauri event and returns a synchronous unsubscribe. */
function on<T>(event: string, cb: (payload: T) => void): () => void {
  let un: UnlistenFn | null = null;
  let dead = false;
  void listen<T>(event, (e) => cb(e.payload)).then((f) => {
    if (dead) f();
    else un = f;
  });
  return () => {
    dead = true;
    un?.();
  };
}

export function createTauriBackend(): Backend {
  return {
    kind: "tauri",
    listDir: (path) => invoke("fs_list_dir", { path }),
    readFile: (path) => invoke("fs_read_file", { path }),
    readBase64: (path) => invoke("fs_read_base64", { path }),
    writeFile: (path, content, lineEnding, bom) => invoke("fs_write_file", { path, content, lineEnding, bom }),
    createFile: (path) => invoke("fs_create_file", { path }),
    createDir: (path) => invoke("fs_create_dir", { path }),
    rename: (from, to) => invoke("fs_rename", { from, to }),
    copy: (from, to) => invoke("fs_copy", { from, to }),
    remove: (path, toTrash = true) => invoke("fs_delete", { path, toTrash }),
    exists: (path) => invoke("fs_exists", { path }),
    listFiles: (root) => invoke("fs_list_files", { root }),

    search: (root, options) => invoke("search_project", { root, options }),
    replace: (root, options, replacement, files) => invoke("replace_project", { root, options, replacement, files }),

    gitInfo: (root) => invoke("git_info", { root }),
    gitHeadContent: (root, rel) => invoke("git_head_content", { root, rel }),
    gitStage: (root, paths) => invoke("git_stage", { root, paths }),
    gitUnstage: (root, paths) => invoke("git_unstage", { root, paths }),
    gitDiscard: (root, paths) => invoke("git_discard", { root, paths }),
    gitCommit: (root, message) => invoke("git_commit", { root, message }),
    gitInit: (root) => invoke("git_init", { root }),

    ptySpawn: (cwd, cols, rows, shell, args) => invoke("pty_spawn", { cwd, cols, rows, shell: shell || null, args: args ?? null }),
    ptyWrite: (id, data) => invoke("pty_write", { id, data }),
    ptyResize: (id, cols, rows) => invoke("pty_resize", { id, cols, rows }),
    ptyKill: (id) => invoke("pty_kill", { id }),
    defaultShell: () => invoke("default_shell"),
    listShells: () => invoke("list_shells"),
    onData: (cb) => on<{ id: number; data: string }>("pty:data", (p) => cb(p.id, p.data)),
    onExit: (cb) => on<{ id: number; code: number | null }>("pty:exit", (p) => cb(p.id, p.code)),

    watch: (root) => invoke("watch_project", { root }),
    unwatch: () => invoke("unwatch_project"),
    onFsChange: (cb) => on<string[]>("fs:changed", cb),

    pickFolder: async () => {
      const r = await open({ directory: true, multiple: false, title: "Open Folder" });
      return typeof r === "string" ? r : null;
    },
    pickOpenFile: async () => {
      const r = await open({ directory: false, multiple: false, title: "Open File" });
      return typeof r === "string" ? r : null;
    },
    pickSaveFile: async (defaultPath) => (await save({ defaultPath, title: "Save As" })) ?? null,
    startupPath: () => invoke("startup_path"),
    sourceCheckout: () => invoke<string | null>("source_checkout").catch(() => null),
    runCheck: (cwd, command, timeoutSecs) => invoke<CheckOutput>("run_check", { cwd, command, timeoutSecs }),
    revealInExplorer: (path) => revealItemInDir(path),
    openUrl: (url) => openUrl(url),
  };
}
