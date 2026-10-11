/**
 * Flow Icons (thang-nm) as a Nox file icon theme. Flow Icons is a paid icon
 * set whose terms forbid redistributing it, so it is not shipped with Nox:
 * each computer installs its own licensed copy once (from VS Code's copy, or
 * a folder) into Nox's data folder, and Nox reads it from there — VS Code is
 * not needed afterwards. One theme, four styles: Dim, Deep, Dawn and You.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { dirname, join, sepOf } from "@/lib/path";
import { detectLanguage } from "@/editor/languages";
import type { IconSpec } from "./iconThemes";

export const FLOW_VARIANTS = [
  { id: "dim", label: "Dim" },
  { id: "deep", label: "Deep" },
  { id: "dawn", label: "Dawn" },
  { id: "you", label: "You" },
] as const;
export type FlowVariant = (typeof FLOW_VARIANTS)[number]["id"];

type Status = "unknown" | "checking" | "missing" | "ready";

/** `version` bumps when icons finish loading (or the UI turns light / dark), so icons re-render. */
export const useFlowIcons = create<{ status: Status; version: number }>(() => ({ status: "unknown", version: 0 }));

let bumpTimer: ReturnType<typeof setTimeout> | undefined;
function bump() {
  // Many icons load at once: one re-render for the batch.
  bumpTimer ??= setTimeout(() => {
    bumpTimer = undefined;
    useFlowIcons.setState((s) => ({ version: s.version + 1 }));
  }, 16);
}

/* ---------------- files ---------------- */

/** "./a/../b/c.svg" against a folder. */
export function resolvePath(dir: string, rel: string): string {
  const sep = sepOf(dir);
  const out = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (const part of rel.split(/[\\/]/)) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join(sep);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await backend().readFile(path)).content.replace(/^﻿/, ""));
}

async function tauriPath(which: "homeDir" | "appDataDir"): Promise<string | null> {
  try {
    if (backend().kind !== "tauri") return null;
    const path = await import("@tauri-apps/api/path");
    return await path[which]();
  } catch {
    return null;
  }
}

/** Where Flow Icons is installed: Nox's own data folder. */
export async function installDir(): Promise<string | null> {
  const data = await tauriPath("appDataDir");
  return data ? join(data, "icon-themes", "flow-icons") : null;
}

interface Pkg {
  name?: string;
  publisher?: string;
  version?: string;
  contributes?: { iconThemes?: Array<{ id?: string; path?: string }> };
}

/** The theme file of a style inside a Flow Icons folder. */
function themeFile(dir: string, pkg: Pkg, variant: FlowVariant): string {
  const entry = pkg.contributes?.iconThemes?.find((t) => t.id === `flow-${variant}`);
  return resolvePath(dir, entry?.path ?? `./${variant}.json`);
}

/**
 * Checks a folder holds the full Flow Icons (not the demo icons the
 * extension ships before a license key is entered). Returns its version.
 */
export async function checkFlowFolder(dir: string): Promise<string> {
  const pkg = (await readJson(join(dir, "package.json")).catch(() => null)) as Pkg | null;
  if (!pkg || pkg.publisher !== "thang-nm" || pkg.name !== "flow-icons") throw new Error("This folder isn't Flow Icons (expected the thang-nm.flow-icons extension folder).");
  const file = themeFile(dir, pkg, "dim");
  const theme = parseTheme(await readJson(file).catch(() => ({})), file);
  const sample = [...theme.paths.values()].filter(Boolean).slice(0, 400);
  if (sample.length < 300) throw new Error("This Flow Icons copy only has the demo icons — enter your license key in VS Code once to download the full set.");
  const present = await Promise.all([sample[0], sample[150], sample[299]].map((p) => backend().exists(p)));
  if (present.includes(false)) throw new Error("Some Flow Icons files are missing from this folder.");
  return pkg.version ?? "";
}

const EDITORS = [".vscode/extensions", ".vscode-insiders/extensions", ".cursor/extensions", ".vscode-oss/extensions", ".windsurf/extensions"];

/** A licensed Flow Icons in VS Code (or Cursor…) on this computer, to install from in one click. */
export async function findInEditors(): Promise<string | null> {
  const home = await tauriPath("homeDir");
  if (!home) return null;
  const found: Array<{ dir: string; version: number[] }> = [];
  for (const rel of EDITORS) {
    const entries = await backend()
      .listDir(join(home, rel))
      .catch(() => []);
    for (const e of entries) {
      const m = /^thang-nm\.flow-icons-(\d+(?:\.\d+)*)/i.exec(e.name);
      if (e.isDir && m) found.push({ dir: e.path, version: m[1].split(".").map(Number) });
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) if ((a.version[i] ?? 0) !== (b.version[i] ?? 0)) return (b.version[i] ?? 0) - (a.version[i] ?? 0);
    return 0;
  });
  for (const f of found) if (await checkFlowFolder(f.dir).then(() => true, () => false)) return f.dir;
  return null;
}

/** Copies Flow Icons from `from` into Nox's data folder. */
export async function installFlowIcons(from: string): Promise<void> {
  await checkFlowFolder(from);
  const dest = await installDir();
  if (!dest) throw new Error("Installing needs the desktop app");
  if (await backend().exists(dest)) await backend().remove(dest, false);
  await backend().copy(from, dest);
  resetFlowIcons();
  await checkInstalled();
}

/** Deletes the installed copy. */
export async function uninstallFlowIcons(): Promise<void> {
  const dest = await installDir();
  if (dest && (await backend().exists(dest))) await backend().remove(dest, false);
  resetFlowIcons();
  useFlowIcons.setState({ status: "missing" });
}

let pkgCache: Pkg | null = null;

export async function checkInstalled(): Promise<boolean> {
  if (useFlowIcons.getState().status === "checking") return false;
  useFlowIcons.setState({ status: "checking" });
  const dir = await installDir();
  pkgCache = dir ? ((await readJson(join(dir, "package.json")).catch(() => null)) as Pkg | null) : null;
  const ok = !!pkgCache && pkgCache.name === "flow-icons";
  useFlowIcons.setState({ status: ok ? "ready" : "missing" });
  bump();
  return ok;
}

/* ---------------- the theme file ---------------- */

interface Section {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions: Map<string, string>;
  fileNames: Map<string, string>;
  folderNames: Map<string, string>;
  folderNamesExpanded: Map<string, string>;
  languageIds: Map<string, string>;
}

export interface LoadedTheme {
  /** Icon id → absolute file path. */
  paths: Map<string, string>;
  main: Section;
  light: Section | null;
}

type RawSection = Partial<Record<"file" | "folder" | "folderExpanded", string>> & Partial<Record<"fileExtensions" | "fileNames" | "folderNames" | "folderNamesExpanded" | "languageIds", Record<string, string>>>;

const lowerMap = (o: Record<string, string> | undefined) => new Map(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
const section = (s: RawSection): Section => ({
  file: s.file,
  folder: s.folder,
  folderExpanded: s.folderExpanded,
  fileExtensions: lowerMap(s.fileExtensions),
  fileNames: lowerMap(s.fileNames),
  folderNames: lowerMap(s.folderNames),
  folderNamesExpanded: lowerMap(s.folderNamesExpanded),
  languageIds: lowerMap(s.languageIds),
});

/** Parses an icon theme file (VS Code's format); `file` locates the icons. */
export function parseTheme(json: unknown, file: string): LoadedTheme {
  const t = json as RawSection & { iconDefinitions?: Record<string, { iconPath?: string }>; light?: RawSection };
  const base = dirname(file);
  const paths = new Map<string, string>();
  for (const [id, def] of Object.entries(t.iconDefinitions ?? {})) paths.set(id, def.iconPath ? resolvePath(base, def.iconPath) : "");
  return { paths, main: section(t), light: t.light ? section(t.light) : null };
}

// Our language ids → VS Code's, for the language-based icons.
const VS_LANG: Record<string, string> = { tsx: "typescriptreact", jsx: "javascriptreact", shell: "shellscript", ini: "properties" };

const isLight = () => typeof document !== "undefined" && document.documentElement.dataset.themeKind === "light";

/** The icon id VS Code would pick for a file or folder. */
export function pickIcon(t: LoadedTheme, name: string, isDir: boolean, open: boolean, light = isLight()): string | undefined {
  const sections = light && t.light ? [t.light, t.main] : [t.main];
  const lower = name.toLowerCase();
  const first = (get: (s: Section) => string | undefined) => {
    for (const s of sections) {
      const v = get(s);
      if (v) return v;
    }
    return undefined;
  };
  if (isDir) {
    return (
      (open ? first((s) => s.folderNamesExpanded.get(lower)) : undefined) ??
      first((s) => s.folderNames.get(lower)) ??
      (open ? first((s) => s.folderExpanded) : undefined) ??
      first((s) => s.folder)
    );
  }
  const byName = first((s) => s.fileNames.get(lower));
  if (byName) return byName;
  // "a.test.ts": "test.ts" before "ts".
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const hit = first((s) => s.fileExtensions.get(parts.slice(i).join(".")));
    if (hit) return hit;
  }
  const lang = detectLanguage(name);
  return first((s) => s.languageIds.get(VS_LANG[lang] ?? lang)) ?? first((s) => s.file);
}

/* ---------------- icons ---------------- */

/** File path → data URL ("" while loading, null when it can't be read). */
const images = new Map<string, string | null>();

function image(path: string): string | null {
  const have = images.get(path);
  if (have !== undefined) return have;
  images.set(path, "");
  backend()
    .readFile(path)
    .then((f) => images.set(path, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.content)}`))
    .catch(() => images.set(path, null))
    .finally(bump);
  return "";
}

const loaded = new Map<FlowVariant, LoadedTheme | null | "loading">();

async function load(variant: FlowVariant) {
  const dir = await installDir();
  try {
    if (!dir || !pkgCache) throw new Error("not installed");
    const file = themeFile(dir, pkgCache, variant);
    loaded.set(variant, parseTheme(await readJson(file), file));
  } catch {
    loaded.set(variant, null);
  }
  bump();
}

function resetFlowIcons() {
  loaded.clear();
  images.clear();
}

let variant: FlowVariant = "dim";
/** The style picked in settings. */
export function setFlowVariant(v: FlowVariant) {
  if (v === variant) return;
  variant = v;
  bump();
}

let watching = false;
function start() {
  if (watching) return;
  watching = true;
  void checkInstalled();
  // Light / dark UI themes pick different icons.
  if (typeof MutationObserver !== "undefined") new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-kind"] });
}

const BLANK: IconSpec = { type: "img", src: "" };

/**
 * The Flow icon for a file or folder; `null` when Flow Icons isn't installed
 * (the caller shows its own icons then).
 */
export function flowIcon(name: string, isDir: boolean, open: boolean): IconSpec | null {
  start();
  const status = useFlowIcons.getState().status;
  if (status === "missing") return null;
  if (status !== "ready") return BLANK;
  const t = loaded.get(variant);
  if (t === undefined) {
    loaded.set(variant, "loading");
    void load(variant);
  }
  if (t === undefined || t === "loading") return BLANK;
  if (t === null) return null;
  const icon = pickIcon(t, name, isDir, open);
  const path = icon ? t.paths.get(icon) : undefined;
  const src = path ? image(path) : null;
  return src === null ? null : { type: "img", src };
}
