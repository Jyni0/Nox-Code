/**
 * Project symbol index: definitions from every source file in the folder,
 * built in the background when a folder opens and kept fresh from the file
 * watcher and from saves. Open buffers always use their live text.
 */
import type { Text } from "@codemirror/state";
import { backend } from "@/lib/backend";
import { join, samePath } from "@/lib/path";
import { detectLanguage } from "@/editor/languages";
import { docHub } from "@/editor/docHub";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { extractSymbols, familyOf, type CodeSymbol } from "./symbols";

export interface IndexedSymbol extends CodeSymbol {
  path: string;
  langId: string;
}

const MAX_FILES = 6000;
const MAX_SIZE = 512 * 1024;
/** Languages worth indexing (data formats would only add noise). */
const SKIP = new Set(["plaintext", "json", "markdown", "diff", "xml", "yaml", "toml", "ini"]);

const files = new Map<string, IndexedSymbol[]>();
const byName = new Map<string, IndexedSymbol[]>();
let indexedRoot: string | null = null;
let building: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<() => void>();

export const indexStatus = { files: 0, symbols: 0, ready: false };

function addToName(list: IndexedSymbol[]) {
  for (const s of list) {
    const arr = byName.get(s.name);
    if (arr) arr.push(s);
    else byName.set(s.name, [s]);
  }
}

function removeFromName(list: IndexedSymbol[]) {
  for (const s of list) {
    const arr = byName.get(s.name);
    if (!arr) continue;
    const next = arr.filter((x) => x !== s);
    if (next.length) byName.set(s.name, next);
    else byName.delete(s.name);
  }
}

function setFile(path: string, langId: string, text: string | null) {
  const old = files.get(path);
  if (old) {
    removeFromName(old);
    indexStatus.symbols -= old.length;
  }
  if (text === null) {
    files.delete(path);
    return;
  }
  const list = extractSymbols(text, langId).map((s) => ({ ...s, path, langId }));
  files.set(path, list);
  addToName(list);
  indexStatus.symbols += list.length;
  indexStatus.files = files.size;
}

async function indexFile(path: string): Promise<void> {
  const langId = detectLanguage(path.split(/[\\/]/).pop() ?? path);
  if (SKIP.has(langId)) return;
  try {
    const f = await backend().readFile(path);
    if (f.binary || f.size > MAX_SIZE) return setFile(path, langId, null);
    setFile(path, langId, f.content);
  } catch {
    setFile(path, langId, null);
  }
}

const idle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Starts (or reuses) the background build for the open folder. */
export function ensureIndex(): Promise<void> {
  const root = useWorkspace.getState().root;
  if (!root) return Promise.resolve();
  if (indexedRoot && samePath(indexedRoot, root) && building) return building;
  resetIndex();
  indexedRoot = root;
  const gen = generation;
  building = (async () => {
    const list = await useWorkspace.getState().getFileList().catch(() => [] as string[]);
    const todo = list.filter((rel) => !SKIP.has(detectLanguage(rel.split("/").pop() ?? rel))).slice(0, MAX_FILES);
    for (let i = 0; i < todo.length; i += 16) {
      if (gen !== generation) return;
      await Promise.all(todo.slice(i, i + 16).map((rel) => indexFile(join(root, rel))));
      await idle();
    }
    if (gen !== generation) return;
    indexStatus.ready = true;
    listeners.forEach((l) => l());
  })();
  return building;
}

export function resetIndex() {
  generation++;
  files.clear();
  byName.clear();
  indexedRoot = null;
  building = null;
  indexStatus.files = 0;
  indexStatus.symbols = 0;
  indexStatus.ready = false;
}

let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Watcher / save notifications. */
export function reindexPaths(paths: string[]) {
  if (!indexedRoot) return;
  for (const p of paths) if (p !== ".git") pending.add(p);
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    const batch = [...pending];
    pending = new Set();
    for (const p of batch) {
      const exists = await backend().exists(p).catch(() => false);
      if (!exists) {
        const langId = detectLanguage(p.split(/[\\/]/).pop() ?? p);
        setFile(p, langId, null);
      } else await indexFile(p);
    }
  }, 300);
}

export function onIndexReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* ---------------- live documents ---------------- */

const docCache = new WeakMap<Text, { langId: string; symbols: CodeSymbol[] }>();

/** Symbols of a live document, cached per document version. */
export function docSymbols(doc: Text, langId: string): CodeSymbol[] {
  const hit = docCache.get(doc);
  if (hit && hit.langId === langId) return hit.symbols;
  const symbols = extractSymbols(doc.toString(), langId);
  docCache.set(doc, { langId, symbols });
  return symbols;
}

/** Paths of open buffers → their live documents (unsaved edits count). */
function openDocs(): Map<string, { doc: Text; langId: string }> {
  const out = new Map<string, { doc: Text; langId: string }>();
  for (const b of Object.values(useEditor.getState().buffers)) {
    if (!b.path) continue;
    try {
      out.set(b.path, { doc: docHub.doc(b.id), langId: b.langId });
    } catch {
      /* not loaded */
    }
  }
  return out;
}

const compatible = (a: string, b: string) => familyOf(a) === familyOf(b) || (a === "html" && familyOf(b) === "js") || (b === "html" && familyOf(a) === "js");

/** Definitions named `name` anywhere in the project (current file excluded). */
/** First use after a folder opened without the subscription seeing it. */
function kick() {
  if (!building && useWorkspace.getState().root) void ensureIndex();
}

export function findInProject(name: string, langId: string, exceptPath: string | null): IndexedSymbol[] {
  kick();
  const live = openDocs();
  const out: IndexedSymbol[] = [];
  for (const [path, d] of live) {
    if (exceptPath && samePath(path, exceptPath)) continue;
    if (!compatible(d.langId, langId)) continue;
    for (const s of docSymbols(d.doc, d.langId)) if (s.name === name) out.push({ ...s, path, langId: d.langId });
  }
  for (const s of byName.get(name) ?? []) {
    if (exceptPath && samePath(s.path, exceptPath)) continue;
    if (live.has(s.path) || !compatible(s.langId, langId)) continue;
    out.push(s);
  }
  // Types and functions before variables; then shorter paths (closer to the root).
  const rank = (s: IndexedSymbol) => (s.kind === "variable" || s.kind === "property" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length);
}

/** Symbols for completion from other files of the same language family. */
export function projectSymbols(langId: string, exceptPath: string | null, limit = 4000): IndexedSymbol[] {
  kick();
  const out: IndexedSymbol[] = [];
  const seen = new Set<string>();
  for (const [path, list] of files) {
    if (exceptPath && samePath(path, exceptPath)) continue;
    for (const s of list) {
      if (!compatible(s.langId, langId) || s.kind === "variable") continue;
      // Locals in other files are noise; top-level and member names are not.
      const key = s.name + "|" + s.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Follow the open folder: drop the old index, build the new one once the window is up.
let startTimer: ReturnType<typeof setTimeout> | undefined;
useWorkspace.subscribe((s, p) => {
  if (s.root === p.root) return;
  resetIndex();
  clearTimeout(startTimer);
  if (s.root) startTimer = setTimeout(() => void ensureIndex(), 1500);
});
