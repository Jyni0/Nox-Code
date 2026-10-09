/**
 * VS Code icon themes (Flow Icons, Material Icon Theme, …) used straight
 * from the extensions installed on this machine. Nothing is copied into Nox:
 * the theme file is read from the extension's folder, and each icon is
 * loaded the first time it is shown.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { dirname, join, sepOf } from "@/lib/path";
import { detectLanguage } from "@/editor/languages";
import type { IconSpec, IconTheme } from "./iconThemes";

export interface VsIconThemeRef {
  /** "vsc:<publisher.name>/<theme id>": the icon theme id in settings. */
  id: string;
  label: string;
  /** publisher.name: finds the extension again after it updates. */
  extension: string;
  version: string;
  /** The extension's folder. */
  dir: string;
  /** Theme file, relative to `dir`. */
  path: string;
  /** Where it was found: "VS Code", "Cursor"… or "Folder". */
  source: string;
}

/** Bumped whenever icons finish loading (or the theme turns light / dark), so icons re-render. */
export const useVsIcons = create<{ version: number }>(() => ({ version: 0 }));

let bumpTimer: ReturnType<typeof setTimeout> | undefined;
function bump() {
  // Many icons load at once: one re-render for the batch.
  bumpTimer ??= setTimeout(() => {
    bumpTimer = undefined;
    useVsIcons.setState((s) => ({ version: s.version + 1 }));
  }, 16);
}

/* ---------------- finding themes ---------------- */

const newer = (a: string, b: string) => {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

const EDITORS: Array<[string, string]> = [
  ["VS Code", ".vscode/extensions"],
  ["VS Code Insiders", ".vscode-insiders/extensions"],
  ["Cursor", ".cursor/extensions"],
  ["VSCodium", ".vscode-oss/extensions"],
  ["Windsurf", ".windsurf/extensions"],
];

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
  // Theme files are JSON with comments now and then.
  const text = (await backend().readFile(path)).content.replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s) => s ?? "").replace(/,(\s*[}\]])/g, "$1"));
  }
}

interface Pkg {
  name?: string;
  publisher?: string;
  version?: string;
  displayName?: string;
  contributes?: { iconThemes?: Array<{ id?: string; label?: string; path?: string }> };
}

/** The icon themes an extension folder contributes (none when it isn't one). */
export async function readExtension(dir: string, source: string): Promise<VsIconThemeRef[]> {
  const pkg = (await readJson(join(dir, "package.json")).catch(() => null)) as Pkg | null;
  const themes = pkg?.contributes?.iconThemes;
  if (!pkg || !Array.isArray(themes)) return [];
  const extension = `${pkg.publisher ?? "local"}.${pkg.name ?? "theme"}`.toLowerCase();
  // Labels like "%theme.label%" live in package.nls.json.
  let nls: Record<string, string> = {};
  if (themes.some((t) => /^%.+%$/.test(t.label ?? ""))) nls = ((await readJson(join(dir, "package.nls.json")).catch(() => null)) as Record<string, string>) ?? {};
  return themes
    .filter((t) => t.id && t.path)
    .map((t) => {
      const raw = t.label ?? t.id!;
      const label = /^%.+%$/.test(raw) ? (nls[raw.slice(1, -1)] ?? t.id!) : raw;
      return { id: `vsc:${extension}/${t.id}`, label, extension, version: pkg.version ?? "0", dir, path: t.path!, source };
    });
}

async function homeDir(): Promise<string | null> {
  if (backend().kind !== "tauri") return null;
  try {
    const { homeDir } = await import("@tauri-apps/api/path");
    return await homeDir();
  } catch {
    return null;
  }
}

/** Icon themes of every VS Code-like editor on this machine (newest version of each). */
export async function discoverInstalled(): Promise<VsIconThemeRef[]> {
  const home = await homeDir();
  if (!home) return [];
  const found = new Map<string, VsIconThemeRef>();
  for (const [source, rel] of EDITORS) {
    const root = join(home, rel);
    const entries = await backend()
      .listDir(root)
      .catch(() => []);
    const lists = await Promise.all(entries.filter((e) => e.isDir).map((e) => readExtension(e.path, source).catch(() => [])));
    for (const ref of lists.flat()) {
      const cur = found.get(ref.id);
      if (!cur || newer(ref.version, cur.version)) found.set(ref.id, ref);
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/* ---------------- loading a theme ---------------- */

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
  /** Icon id → absolute file path (empty for font icons, which aren't supported). */
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

/** Parses a VS Code icon theme file; `themeFile` locates the icons. */
export function parseTheme(json: unknown, themeFile: string): LoadedTheme {
  const t = json as RawSection & { iconDefinitions?: Record<string, { iconPath?: string }>; light?: RawSection };
  const base = dirname(themeFile);
  const paths = new Map<string, string>();
  for (const [id, def] of Object.entries(t.iconDefinitions ?? {})) paths.set(id, def.iconPath ? resolvePath(base, def.iconPath) : "");
  return { paths, main: section(t), light: t.light ? section(t.light) : null };
}

// Our language ids → VS Code's, for themes that map languages.
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
    const ext = parts.slice(i).join(".");
    const hit = first((s) => s.fileExtensions.get(ext));
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
  const svg = /\.svg$/i.test(path);
  const read = svg
    ? backend()
        .readFile(path)
        .then((f) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.content)}`)
    : backend()
        .readBase64(path)
        .then((b) => `data:image/${/\.jpe?g$/i.test(path) ? "jpeg" : "png"};base64,${b}`);
  read
    .then((url) => images.set(path, url))
    .catch(() => images.set(path, null))
    .finally(bump);
  return "";
}

/* ---------------- the theme registry ---------------- */

let refs = new Map<string, VsIconThemeRef>();
const loaded = new Map<string, LoadedTheme | null | "loading">();
const themes = new Map<string, IconTheme>();

/** Called with the themes kept in settings. */
export function setVsThemeRefs(list: VsIconThemeRef[]) {
  refs = new Map(list.map((r) => [r.id, r]));
  bump();
}

async function load(ref: VsIconThemeRef) {
  let r = ref;
  // The extension updated (new version folder) or moved: find it again.
  if (!(await backend().exists(join(r.dir, r.path)))) r = (await discoverInstalled()).find((x) => x.id === ref.id) ?? r;
  const file = resolvePath(r.dir, r.path);
  try {
    loaded.set(ref.id, parseTheme(await readJson(file), file));
  } catch {
    loaded.set(ref.id, null);
  }
  bump();
}

let watching = false;
function watchThemeKind() {
  if (watching || typeof MutationObserver === "undefined") return;
  watching = true;
  // Light / dark UI themes pick different icons.
  new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-kind"] });
}

const BLANK: IconSpec = { type: "img", src: "" };

/** An IconTheme for a VS Code theme kept in settings, or null when it isn't one. */
export function vsIconTheme(id: string): IconTheme | null {
  const ref = refs.get(id);
  if (!ref) return null;
  let theme = themes.get(id);
  if (theme) return theme;
  const spec = (name: string, isDir: boolean, open: boolean): IconSpec => {
    const t = loaded.get(id);
    if (t === undefined) {
      loaded.set(id, "loading");
      watchThemeKind();
      void load(refs.get(id) ?? ref);
    }
    if (t === undefined || t === "loading") return BLANK;
    const icon = t && pickIcon(t, name, isDir, open);
    const path = icon ? t.paths.get(icon) : undefined;
    const src = path ? image(path) : null;
    if (src === null) return { type: "glyph", icon: isDir ? (open ? "FolderOpen" : "Folder") : "File", color: "var(--text-dim)" };
    return { type: "img", src };
  };
  theme = {
    id,
    name: ref.label,
    description: `${ref.source} · ${ref.extension}`,
    file: (name) => spec(name, false, false),
    folder: (name, open) => spec(name, true, open),
  };
  themes.set(id, theme);
  return theme;
}

/** Forgets a theme's loaded files (after it is removed or re-imported). */
export function unloadVsTheme(id: string) {
  loaded.delete(id);
  themes.delete(id);
}
