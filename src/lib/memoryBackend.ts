/**
 * In-memory stand-in for the Rust core: a demo project, a fake git
 * repository and a toy shell. Used by the browser build, unit tests and E2E.
 */
import type { Backend } from "./backend";
import type { DirEntry, FileContent, GitFile, GitStatus, SearchFile, SearchOptions } from "./types";
import { DEMO_FILES, DEMO_ROOT, DEMO_WORKING_CHANGES } from "./demoProject";
import { basename, dirname, join, relative } from "./path";
import { matchesAny, splitGlobs } from "./glob";

type Node = { kind: "dir" } | { kind: "file"; content: string };

export interface MemoryOptions {
  root?: string;
  files?: Record<string, string>;
  working?: Record<string, string | null>;
}

export function buildSearchRegExp(o: SearchOptions): RegExp {
  if (!o.query) throw new Error("Empty search query");
  const base = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const src = o.wholeWord ? `\\b(?:${base})\\b` : base;
  try {
    return new RegExp(src, o.caseSensitive ? "gm" : "gim");
  } catch (e) {
    throw new Error(`Invalid search pattern: ${(e as Error).message}`);
  }
}

export function createMemoryBackend(opts: MemoryOptions = {}): Backend & { fs: Map<string, Node> } {
  const root = opts.root ?? DEMO_ROOT;
  const fs = new Map<string, Node>();
  const head = new Map<string, string>();
  const index = new Map<string, string>();
  const fsListeners = new Set<(paths: string[]) => void>();

  const abs = (rel: string) => join(root, rel);
  const ensureDir = (dir: string) => {
    let d = dir;
    const chain: string[] = [];
    while (d && !fs.has(d)) {
      chain.push(d);
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
    chain.forEach((c) => fs.set(c, { kind: "dir" }));
  };
  const putFile = (path: string, content: string) => {
    ensureDir(dirname(path));
    fs.set(path, { kind: "file", content });
  };

  ensureDir(root);
  const files = opts.files ?? DEMO_FILES;
  for (const [rel, content] of Object.entries(files)) {
    putFile(abs(rel), content);
    head.set(rel, content);
    index.set(rel, content);
  }
  for (const [rel, content] of Object.entries(opts.working ?? (opts.files ? {} : DEMO_WORKING_CHANGES))) {
    if (content === null) fs.delete(abs(rel));
    else putFile(abs(rel), content);
  }

  const emit = (paths: string[]) => fsListeners.forEach((l) => l(paths));
  const get = (path: string) => {
    const n = fs.get(path);
    if (!n) throw new Error(`'${basename(path)}' does not exist`);
    return n;
  };
  const children = (dir: string) =>
    [...fs.keys()].filter((p) => p !== dir && dirname(p) === dir);
  const workFiles = () => {
    const out = new Map<string, string>();
    for (const [p, n] of fs) {
      if (n.kind !== "file") continue;
      const rel = relative(root, p);
      if (rel !== null && rel !== "") out.set(rel, n.content);
    }
    return out;
  };

  /* ---------- toy shell ---------- */
  const ptyData = new Set<(id: number, d: string) => void>();
  const ptyExit = new Set<(id: number, c: number | null) => void>();
  const shells = new Map<number, { cwd: string; line: string }>();
  let nextPty = 1;
  const send = (id: number, d: string) => ptyData.forEach((l) => l(id, d));
  const prompt = (id: number) => {
    const s = shells.get(id)!;
    const rel = relative(dirname(root), s.cwd) ?? s.cwd;
    send(id, `\x1b[38;5;45mnox\x1b[0m@\x1b[38;5;141mdemo\x1b[0m \x1b[2m${rel}\x1b[0m $ `);
  };
  const runCommand = (id: number, input: string) => {
    const s = shells.get(id)!;
    const [cmd, ...args] = input.trim().split(/\s+/);
    const resolve = (p?: string) => (!p || p === "." ? s.cwd : p.startsWith("/") ? p : p === ".." ? dirname(s.cwd) : join(s.cwd, p));
    const out = (t: string) => send(id, t.replace(/\n/g, "\r\n") + "\r\n");
    switch (cmd) {
      case undefined:
      case "":
        break;
      case "help":
        out("Demo shell — the desktop app runs your real shell.\nCommands: ls, cd, pwd, cat, echo, tree, clear, date, whoami, nox, exit");
        break;
      case "ls": {
        const dir = resolve(args[0]);
        const names = children(dir).sort().map((p) => (fs.get(p)?.kind === "dir" ? `\x1b[38;5;75m${basename(p)}/\x1b[0m` : basename(p)));
        out(names.join("  "));
        break;
      }
      case "cd": {
        const dir = resolve(args[0] ?? root);
        if (fs.get(dir)?.kind === "dir") s.cwd = dir;
        else out(`cd: no such directory: ${args[0]}`);
        break;
      }
      case "pwd":
        out(s.cwd);
        break;
      case "cat": {
        const n = fs.get(resolve(args[0]));
        out(n?.kind === "file" ? n.content.trimEnd() : `cat: ${args[0] ?? ""}: no such file`);
        break;
      }
      case "echo":
        out(args.join(" "));
        break;
      case "tree": {
        const walk = (d: string, pre: string): string[] =>
          children(d).sort().flatMap((p) => {
            const line = `${pre}${basename(p)}`;
            return fs.get(p)?.kind === "dir" ? [line + "/", ...walk(p, pre + "  ")] : [line];
          });
        out(walk(s.cwd, "").join("\n"));
        break;
      }
      case "clear":
        send(id, "\x1b[2J\x1b[3J\x1b[H");
        break;
      case "date":
        out(new Date().toString());
        break;
      case "whoami":
        out("astronaut");
        break;
      case "nox":
        out("\x1b[38;5;45m   ☾  nox code\x1b[0m\n   a code editor for the night shift · v0.2.0");
        break;
      case "exit":
        shells.delete(id);
        ptyExit.forEach((l) => l(id, 0));
        return;
      default:
        out(`${cmd}: command not found (try 'help')`);
    }
    prompt(id);
  };

  /* ---------- git ---------- */
  const statusOf = (rel: string, work: Map<string, string>): GitFile | null => {
    const h = head.get(rel);
    const i = index.get(rel);
    const w = work.get(rel);
    if (h === undefined && i === undefined) return w === undefined ? null : { path: rel, status: "?", staged: false, unstaged: true };
    const x: GitStatus | " " = h === undefined ? "A" : i === undefined ? "D" : h !== i ? "M" : " ";
    const y: GitStatus | " " = i === undefined ? " " : w === undefined ? "D" : w !== i ? "M" : " ";
    if (x === " " && y === " ") return null;
    return { path: rel, status: (x !== " " ? x : y) as GitStatus, staged: x !== " ", unstaged: y !== " " };
  };

  const self: Backend & { fs: Map<string, Node> } = {
    kind: "memory",
    fs,
    async listDir(path) {
      if (get(path).kind !== "dir") throw new Error("Not a folder");
      const entries: DirEntry[] = children(path).map((p) => {
        const n = fs.get(p)!;
        return { name: basename(p), path: p, isDir: n.kind === "dir", isSymlink: false, size: n.kind === "file" ? n.content.length : 0 };
      });
      return entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    },
    async readFile(path): Promise<FileContent> {
      const n = get(path);
      if (n.kind !== "file") throw new Error("Cannot open a folder as a file");
      return { content: n.content, binary: false, size: n.content.length, lineEnding: n.content.includes("\r\n") ? "CRLF" : "LF", bom: false };
    },
    async readBase64(path) {
      const n = get(path);
      if (n.kind !== "file") throw new Error("Not a file");
      return btoa(unescape(encodeURIComponent(n.content)));
    },
    async writeFile(path, content, lineEnding = "LF") {
      const lf = content.replace(/\r\n/g, "\n");
      putFile(path, lineEnding === "CRLF" ? lf.replace(/\n/g, "\r\n") : lf);
      emit([path]);
    },
    async createFile(path) {
      if (fs.has(path)) throw new Error(`'${basename(path)}' already exists`);
      putFile(path, "");
      emit([path]);
    },
    async createDir(path) {
      if (fs.has(path)) throw new Error(`'${basename(path)}' already exists`);
      ensureDir(path);
      emit([path]);
    },
    async rename(from, to) {
      get(from);
      if (fs.has(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`'${basename(to)}' already exists`);
      const moved = [...fs.entries()].filter(([p]) => p === from || p.startsWith(from + "/"));
      moved.forEach(([p]) => fs.delete(p));
      ensureDir(dirname(to));
      moved.forEach(([p, n]) => fs.set(to + p.slice(from.length), n));
      emit([from, to]);
    },
    async copy(from, to) {
      get(from);
      if (fs.has(to)) throw new Error(`'${basename(to)}' already exists`);
      const items = [...fs.entries()].filter(([p]) => p === from || p.startsWith(from + "/"));
      ensureDir(dirname(to));
      items.forEach(([p, n]) => fs.set(to + p.slice(from.length), { ...n }));
      emit([to]);
    },
    async remove(path) {
      [...fs.keys()].filter((p) => p === path || p.startsWith(path + "/")).forEach((p) => fs.delete(p));
      emit([path]);
    },
    async exists(path) {
      return fs.has(path);
    },
    async listFiles(r) {
      const ignored = splitGlobs(["node_modules", "dist", ...(fs.get(join(r, ".gitignore")) as { content?: string } | undefined)?.content?.split("\n") ?? []].join(","));
      return [...fs.entries()]
        .filter(([, n]) => n.kind === "file")
        .map(([p]) => relative(r, p))
        .filter((rel): rel is string => !!rel && !matchesAny(rel, ignored))
        .sort();
    },

    async search(r, o) {
      const re = buildSearchRegExp(o);
      const inc = splitGlobs(o.include);
      const exc = splitGlobs(o.exclude);
      const max = o.maxResults || 5000;
      const out: SearchFile[] = [];
      let total = 0;
      let truncated = false;
      for (const rel of await self.listFiles(r)) {
        if (inc.length && !matchesAny(rel, inc)) continue;
        if (exc.length && matchesAny(rel, exc)) continue;
        const n = fs.get(join(r, rel));
        if (n?.kind !== "file") continue;
        const matches: SearchFile["matches"] = [];
        n.content.split("\n").forEach((raw, li) => {
          const line = raw.replace(/\r$/, "");
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) && total + matches.length < max) {
            if (!m[0]) {
              re.lastIndex++;
              continue;
            }
            matches.push({ line: li + 1, col: m.index, len: m[0].length, preview: line.slice(0, 400) });
          }
        });
        if (matches.length) {
          out.push({ path: join(r, rel), rel, matches });
          total += matches.length;
          if (total >= max) {
            truncated = true;
            break;
          }
        }
      }
      return { files: out, totalMatches: total, truncated };
    },
    async replace(r, o, replacement, only) {
      const re = buildSearchRegExp(o);
      const res = await self.search(r, { ...o, maxResults: 1e9 });
      let replacements = 0;
      let filesChanged = 0;
      for (const f of res.files) {
        if (only && !only.includes(f.path)) continue;
        const n = fs.get(f.path) as { kind: "file"; content: string };
        re.lastIndex = 0;
        const next = o.regex ? n.content.replace(re, replacement) : n.content.replace(re, () => replacement);
        replacements += f.matches.length;
        filesChanged++;
        n.content = next;
      }
      emit(res.files.map((f) => f.path));
      return { filesChanged, replacements };
    },

    async gitInfo(r) {
      if (r !== root) return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
      const work = workFiles();
      const all = new Set([...head.keys(), ...index.keys(), ...work.keys()]);
      const filesOut = [...all].sort().map((rel) => statusOf(rel, work)).filter((f): f is GitFile => !!f);
      return { isRepo: true, branch: "main", ahead: 1, behind: 0, files: filesOut };
    },
    async gitHeadContent(_r, rel) {
      return head.get(rel) ?? null;
    },
    async gitStage(_r, paths) {
      const work = workFiles();
      for (const p of paths) {
        const w = work.get(p);
        if (w === undefined) index.delete(p);
        else index.set(p, w);
      }
    },
    async gitUnstage(_r, paths) {
      for (const p of paths) {
        const h = head.get(p);
        if (h === undefined) index.delete(p);
        else index.set(p, h);
      }
    },
    async gitDiscard(_r, paths) {
      for (const p of paths) {
        const i = index.get(p);
        if (i !== undefined) putFile(abs(p), i);
      }
      emit(paths.map(abs));
    },
    async gitCommit(_r, message) {
      if (!message.trim()) throw new Error("Commit message is empty");
      const staged = [...new Set([...head.keys(), ...index.keys()])].filter((p) => head.get(p) !== index.get(p));
      if (!staged.length) throw new Error("Nothing to commit");
      head.clear();
      index.forEach((v, k) => head.set(k, v));
    },
    async gitInit() {},

    async ptySpawn(cwd) {
      const id = nextPty++;
      shells.set(id, { cwd: fs.get(cwd)?.kind === "dir" ? cwd : root, line: "" });
      setTimeout(() => {
        send(id, "\x1b[2mNox Code demo shell — type 'help'. The desktop app runs your real shell.\x1b[0m\r\n");
        prompt(id);
      }, 30);
      return id;
    },
    async ptyWrite(id, data) {
      const s = shells.get(id);
      if (!s) throw new Error("Terminal is closed");
      for (const ch of data) {
        if (ch === "\r") {
          send(id, "\r\n");
          const line = s.line;
          s.line = "";
          runCommand(id, line);
        } else if (ch === "\x7f" || ch === "\b") {
          if (s.line) {
            s.line = s.line.slice(0, -1);
            send(id, "\b \b");
          }
        } else if (ch === "\x03") {
          s.line = "";
          send(id, "^C\r\n");
          prompt(id);
        } else if (ch >= " ") {
          s.line += ch;
          send(id, ch);
        }
      }
    },
    async ptyResize() {},
    async ptyKill(id) {
      shells.delete(id);
    },
    async defaultShell() {
      return "demo-shell";
    },
    async listShells() {
      // The browser preview has one toy shell; the names show what the desktop menu looks like.
      return [
        { id: "demo", name: "Demo Shell", program: "demo-shell", args: [] },
        { id: "demo-bash", name: "Bash (demo)", program: "bash", args: [] },
      ];
    },
    onData(cb) {
      ptyData.add(cb);
      return () => ptyData.delete(cb);
    },
    onExit(cb) {
      ptyExit.add(cb);
      return () => ptyExit.delete(cb);
    },

    async watch() {},
    async unwatch() {},
    onFsChange(cb) {
      fsListeners.add(cb);
      return () => fsListeners.delete(cb);
    },

    async pickFolder() {
      return root;
    },
    async pickOpenFile() {
      return null;
    },
    async pickSaveFile(defaultPath) {
      const name = window.prompt("Save as (path inside the demo project):", defaultPath ? basename(defaultPath) : "untitled.txt");
      return name ? join(root, name) : null;
    },
    async startupPath() {
      return root;
    },
    async sourceCheckout() {
      return null;
    },
    async revealInExplorer() {},
    async openUrl(url) {
      window.open(url, "_blank", "noreferrer");
    },
  };
  return self;
}
