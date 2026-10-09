/**
 * Project problems: the project's own checkers — tsc, cargo check, go vet,
 * ruff / pyflakes — run in the background when a folder opens and after
 * saves. Their errors show in the editor (next to the syntax errors) and in
 * the status bar.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { dirname, join, relative, samePath } from "@/lib/path";
import { useWorkspace } from "@/stores/workspace";
import { parseJsonc } from "@/stores/project";

export type Severity = "error" | "warning" | "info";

export interface Problem {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based; 0 when the tool gives no column. */
  col: number;
  severity: Severity;
  message: string;
  source: string;
}

interface Checker {
  id: string;
  name: string;
  /** Languages whose saves re-run it. */
  langs: string[];
  /** Directory the command runs in (paths in its output are relative to it). */
  cwd: string;
  /** Command lines, tried in order; the first one that exists is used. */
  commands: string[];
  /** Output that means this command line can't work right now: try the next one (and don't remember it). */
  fallbackIf?: RegExp;
  parse(out: string, cwd: string): Problem[];
}

interface ProblemsState {
  problems: Problem[];
  /** Checker ids running right now. */
  running: string[];
  /** Checkers found for the open folder (names, for the status bar tooltip). */
  checkers: string[];
  /** A checker that could not start (tool missing), by name → reason. */
  unavailable: Record<string, string>;
  version: number;
}

export const useProblems = create<ProblemsState>(() => ({ problems: [], running: [], checkers: [], unavailable: {}, version: 0 }));

const listeners = new Set<() => void>();
export function onProblemsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function problemsFor(path: string | null): Problem[] {
  if (!path) return [];
  return useProblems.getState().problems.filter((p) => samePath(p.path, path));
}

/* ---------------- output parsing ---------------- */

const abs = (cwd: string, p: string) => (/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(p) ? p : join(cwd, p.replace(/^\.[\\/]/, "")));

function severityOf(word: string | undefined, message: string): Severity {
  const w = (word ?? "").toLowerCase();
  if (w.startsWith("warn")) return "warning";
  if (w === "note" || w === "info" || w === "help") return "info";
  if (!w && /^warning\b/i.test(message)) return "warning";
  return "error";
}

/** `file(12,5): error TS2304: Cannot find name 'x'.` */
export function parseTsc(out: string, cwd: string): Problem[] {
  const res: Problem[] = [];
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/gm;
  let m: RegExpExecArray | null;
  let last: Problem | null = null;
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    re.lastIndex = 0;
    if ((m = re.exec(line))) {
      last = { path: abs(cwd, m[1]), line: +m[2], col: +m[3], severity: severityOf(m[4], m[6]), message: `${m[6]} (${m[5]})`, source: "tsc" };
      res.push(last);
    } else if (last && /^\s{2,}\S/.test(line)) {
      // Continuation lines of a long message.
      last.message += "\n" + line.trim();
    } else last = null;
  }
  return res;
}

/**
 * `dotnet build`: `File.cs(5,10): error CS1002: ; expected [app.csproj]`.
 * The summary repeats every line, and MSBuild's own errors (a locked bin
 * folder while the app runs…) are about the build, not the code.
 */
export function parseMsbuild(out: string, cwd: string): Problem[] {
  const res: Problem[] = [];
  const seen = new Set<string>();
  const re = /^\s*(.+?\.(?:cs|vb|fs|fsx|razor|cshtml|xaml))\((\d+),(\d+)(?:,\d+,\d+)?\): (error|warning) ([A-Z]+\d+): (.*?)(?: \[[^\]]*\])?\s*$/i;
  for (const line of out.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m || seen.has(line.trim())) continue;
    seen.add(line.trim());
    res.push({ path: abs(cwd, m[1]), line: +m[2], col: +m[3], severity: severityOf(m[4], m[6]), message: `${m[6]} (${m[5]})`, source: "dotnet" });
  }
  return res;
}

/** `path:line:col: severity: message` and the shorter variants most tools print. */
export function parseGeneric(out: string, cwd: string, source: string): Problem[] {
  const res: Problem[] = [];
  const re = /^\s*(?:-->\s*)?((?:[A-Za-z]:)?[^:\s][^:]*?\.[\w]+):(\d+)(?::(\d+))?:?\s*(?:(error|warning|warn|note|info|help)(?:\[([\w-]+)\])?:\s*)?(.+)$/i;
  for (const line of out.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const message = m[6].trim();
    if (!message) continue;
    res.push({
      path: abs(cwd, m[1]),
      line: +m[2],
      col: m[3] ? +m[3] : 0,
      severity: severityOf(m[4], message),
      message: m[5] ? `${message} [${m[5]}]` : message,
      source,
    });
  }
  return res;
}

/* ---------------- detection ---------------- */

const exists = (p: string) =>
  backend()
    .exists(p)
    .catch(() => false);

async function readJsonc(p: string): Promise<Record<string, unknown> | null> {
  try {
    const f = await backend().readFile(p);
    return parseJsonc(f.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** tsconfig.json, or the configs it references when it only lists references (Vite's layout). */
async function tsProjects(root: string): Promise<string[]> {
  const main = join(root, "tsconfig.json");
  const cfg = await readJsonc(main);
  if (!cfg) return (await exists(join(root, "jsconfig.json"))) ? ["jsconfig.json"] : [];
  const refs = Array.isArray(cfg.references) ? (cfg.references as Array<{ path?: string }>) : [];
  const onlyRefs = Array.isArray(cfg.files) && (cfg.files as unknown[]).length === 0 && !cfg.include && refs.length > 0;
  if (!onlyRefs) return ["tsconfig.json"];
  const out: string[] = [];
  for (const r of refs) {
    if (!r.path) continue;
    const p = r.path.endsWith(".json") ? r.path : join(r.path, "tsconfig.json");
    if (await exists(join(root, p))) out.push(p.replace(/^\.\//, ""));
  }
  return out;
}

async function detect(root: string, files: string[]): Promise<Checker[]> {
  const found: Checker[] = [];
  // TypeScript, with the project's own compiler.
  const projects = await tsProjects(root);
  if (projects.length && (await exists(join(root, "node_modules", "typescript", "bin", "tsc")))) {
    for (const p of projects)
      found.push({
        id: "tsc:" + p,
        name: projects.length > 1 ? `TypeScript (${p})` : "TypeScript",
        langs: ["typescript", "tsx", "javascript", "jsx"],
        cwd: root,
        // Incremental: only what changed is checked again (≈1.5s instead of ≈5s on a mid-size app).
        commands: [`node node_modules/typescript/bin/tsc --noEmit --pretty false -p ${p} --incremental --tsBuildInfoFile node_modules/.cache/nox/${p.replace(/[\\/.]/g, "_")}.tsbuildinfo`],
        parse: parseTsc,
      });
  }
  // Rust crates at the root or one level down (src-tauri/…).
  const crates = files.filter((f) => f === "Cargo.toml" || /^[^/]+\/Cargo\.toml$/.test(f));
  const crateDirs = crates.map((f) => (f === "Cargo.toml" ? root : join(root, dirname(f))));
  for (const dir of crateDirs.includes(root) ? [root] : crateDirs) {
    found.push({
      id: "cargo:" + dir,
      name: "Rust" + (dir === root ? "" : ` (${relative(root, dir)})`),
      langs: ["rust"],
      cwd: dir,
      commands: ["cargo check --message-format=short --quiet"],
      parse: (out, cwd) => parseGeneric(out, cwd, "cargo"),
    });
  }
  // .NET: the solution if there is one (it builds every project), else each project.
  const solutions = files.filter((f) => /^[^/]+\.slnx?$/i.test(f));
  const dotnetProjects = solutions.length ? solutions.slice(0, 1) : files.filter((f) => /\.(cs|vb|fs)proj$/i.test(f) && f.split("/").length <= 3).slice(0, 6);
  for (const p of dotnetProjects) {
    found.push({
      id: "dotnet:" + p,
      name: dotnetProjects.length > 1 ? `.NET (${p})` : ".NET",
      langs: ["csharp"],
      cwd: root,
      // Its own output folder (obj/nox): building into bin/ while the app runs
      // waits ~10s on locked files. Restore only when it's needed.
      commands: ["--no-restore ", ""].map((r) => `dotnet build "${p}" ${r}--nologo -v q -clp:NoSummary -p:BaseOutputPath=obj/nox/ -p:CopyRetryCount=0`),
      fallbackIf: /NETSDK1004|NETSDK1005|NETSDK1047|project\.assets\.json/,
      parse: parseMsbuild,
    });
  }
  if (files.includes("go.mod")) {
    found.push({ id: "go", name: "Go", langs: ["go"], cwd: root, commands: ["go vet ./..."], parse: (out, cwd) => parseGeneric(out, cwd, "go") });
  }
  if (files.some((f) => f.endsWith(".py"))) {
    found.push({
      id: "python",
      name: "Python",
      langs: ["python"],
      cwd: root,
      commands: ["ruff check --output-format=concise --no-fix --quiet .", "python -m pyflakes .", "python3 -m pyflakes ."],
      parse: (out, cwd) => parseGeneric(out, cwd, "python").filter((p) => !/^Found \d+ error/.test(p.message)),
    });
  }
  return found;
}

/* ---------------- running ---------------- */

let checkers: Checker[] = [];
let detectedFor: string | null = null;
const inFlight = new Map<string, Promise<void>>();
const again = new Set<string>();
/** Which command line works, per checker (found on its first run). */
const working = new Map<string, string>();
/** Checkers whose next run must use their last (full) command line, e.g. with a restore. */
const fullRun = new Set<string>();

/** Output that means the program itself is missing, not that the code has errors. */
const MISSING = /is not recognized as an internal or external command|command not found|No module named|was not found|not found$/im;

function publish(id: string, list: Problem[]) {
  const keep = useProblems.getState().problems.filter((p) => (p as Problem & { checker?: string }).checker !== id);
  const tagged = list.map((p) => Object.assign(p, { checker: id }));
  useProblems.setState((s) => ({ problems: [...keep, ...tagged], version: s.version + 1 }));
  listeners.forEach((l) => l());
}

async function runChecker(c: Checker): Promise<void> {
  if (inFlight.has(c.id)) {
    again.add(c.id);
    return inFlight.get(c.id);
  }
  const job = (async () => {
    useProblems.setState((s) => ({ running: [...s.running, c.id] }));
    try {
      const known = working.get(c.id);
      const full = fullRun.delete(c.id);
      const lines = full ? c.commands.slice(-1) : known ? [known, ...c.commands.slice(c.commands.indexOf(known) + 1)] : c.commands;
      let fellBack = full;
      for (const line of lines) {
        const out = await backend().runCheck(c.cwd, line, 300);
        const text = out.stdout + "\n" + out.stderr;
        const missing = out.code === 127 || out.code === 9009 || (out.code !== 0 && MISSING.test(out.stderr) && !c.parse(text, c.cwd).length);
        if (missing) continue;
        if (out.code !== 0 && c.fallbackIf?.test(text)) {
          fellBack = true;
          continue;
        }
        // A fallback (a restore…) fixes things for next time: keep trying the fast line first.
        if (!fellBack) working.set(c.id, line);
        if (out.timedOut) break;
        publish(c.id, c.parse(text, c.cwd));
        useProblems.setState((s) => {
          const unavailable = { ...s.unavailable };
          delete unavailable[c.name];
          return { unavailable };
        });
        return;
      }
      useProblems.setState((s) => ({ unavailable: { ...s.unavailable, [c.name]: `${c.commands[0].split(" ")[0]} was not found` } }));
    } catch (e) {
      useProblems.setState((s) => ({ unavailable: { ...s.unavailable, [c.name]: String(e) } }));
    } finally {
      useProblems.setState((s) => ({ running: s.running.filter((x) => x !== c.id) }));
      inFlight.delete(c.id);
      if (again.delete(c.id)) void runChecker(c);
    }
  })();
  inFlight.set(c.id, job);
  return job;
}

let enabled = () => true;
let startTimer: ReturnType<typeof setTimeout> | undefined;
/** The editor extension decides whether project checks run. */
export function setProblemsEnabled(fn: () => boolean) {
  enabled = fn;
}

async function ensureDetected(): Promise<Checker[]> {
  const root = useWorkspace.getState().root;
  if (!root) return [];
  if (detectedFor && samePath(detectedFor, root)) return checkers;
  detectedFor = root;
  const files = await useWorkspace
    .getState()
    .getFileList()
    .catch(() => [] as string[]);
  checkers = await detect(root, files);
  useProblems.setState({ checkers: checkers.map((c) => c.name) });
  return checkers;
}

/**
 * Runs every checker for the open folder (or only those for `langId`).
 * `redetect` looks for tools again (after `npm install`, a new Cargo.toml…).
 */
export async function runChecks(langId?: string, redetect = false): Promise<void> {
  if (!enabled()) return;
  if (redetect) {
    detectedFor = null;
    working.clear();
  }
  const list = await ensureDetected();
  await Promise.all(list.filter((c) => !langId || c.langs.includes(langId)).map(runChecker));
}

/** First use with a folder already open: check it once. */
export function ensureChecksStarted() {
  if (!detectedFor && useWorkspace.getState().root && !startTimer) startTimer = setTimeout(() => void runChecks(), 1500);
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** After a save: re-run the checkers that cover this language, debounced. */
export function onSaved(langId: string, path?: string | null) {
  // A project file changed (new package…): restore before the next .NET build.
  if (path && /\.(csproj|vbproj|fsproj|slnx?|props|targets)$/i.test(path)) {
    for (const c of checkers) if (c.id.startsWith("dotnet:")) fullRun.add(c.id);
    langId = "csharp";
  }
  clearTimeout(saveTimers.get(langId));
  saveTimers.set(
    langId,
    setTimeout(() => void runChecks(langId), 250),
  );
}

// A new folder: forget the old problems, check the new one once it is up.
useWorkspace.subscribe((s, p) => {
  if (s.root === p.root) return;
  detectedFor = null;
  checkers = [];
  working.clear();
  useProblems.setState((st) => ({ problems: [], running: [], checkers: [], unavailable: {}, version: st.version + 1 }));
  listeners.forEach((l) => l());
  clearTimeout(startTimer);
  if (s.root) startTimer = setTimeout(() => void runChecks(), 2500);
});
