/**
 * Per-project settings: `.nox/settings.json` in the project root, plus the
 * project's `.editorconfig`. They sit on top of the user settings:
 *
 *   user settings < .editorconfig < .nox/settings.json < its per-language block
 *
 * Everything that depends on indentation or save behavior asks
 * `effectiveFor(path, langId)` instead of reading the user settings directly.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { join, relative } from "@/lib/path";
import { globToRegExp, splitGlobs } from "@/lib/glob";
import { useSettings, type SettingsState } from "./settings";
import { errorMessage, toast } from "./ui";

export const PROJECT_DIR = ".nox";
export const PROJECT_FILE = ".nox/settings.json";

/** What a language block may override. */
export interface LanguageOverrides {
  tabSize?: number;
  insertSpaces?: boolean;
  wordWrap?: boolean;
  formatOnSave?: boolean;
}

export interface ProjectSettings extends LanguageOverrides {
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
  printWidth?: number;
  semi?: boolean;
  singleQuote?: boolean;
  /** Extra globs hidden from the explorer, on top of the user ones. */
  filesExclude?: string;
  /** Read `.editorconfig` (default: yes). */
  useEditorConfig?: boolean;
  /** Folder new terminals open in, relative to the root. */
  terminalCwd?: string;
  languages?: Record<string, LanguageOverrides>;
}

export const PROJECT_KEYS: Array<keyof ProjectSettings> = [
  "tabSize",
  "insertSpaces",
  "wordWrap",
  "formatOnSave",
  "trimTrailingWhitespace",
  "insertFinalNewline",
  "printWidth",
  "semi",
  "singleQuote",
  "filesExclude",
  "useEditorConfig",
  "terminalCwd",
  "languages",
];

interface EditorConfigSection {
  glob: string;
  props: Record<string, string>;
}

/** The values a buffer actually uses. */
export interface Effective {
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  formatOnSave: boolean | null;
  printWidth: number | null;
  semi: boolean | null;
  singleQuote: boolean | null;
}

interface ProjectState {
  root: string | null;
  settings: ProjectSettings;
  /** The settings file exists on disk. */
  exists: boolean;
  editorConfig: EditorConfigSection[];
  /** Bumped on every change, so editors know to reconfigure. */
  version: number;

  load(root: string | null): Promise<void>;
  /** Re-reads the files when the watcher reports them changed. */
  onDiskChange(paths: string[]): void;
  /** Sets keys (undefined removes one) and writes the file. */
  update(patch: Partial<ProjectSettings>): Promise<void>;
  setLanguage(langId: string, patch: LanguageOverrides | null): Promise<void>;
}

/* ---------------- .editorconfig ---------------- */

export function parseEditorConfig(text: string): EditorConfigSection[] {
  const out: EditorConfigSection[] = [];
  let cur: EditorConfigSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      cur = { glob: sec[1].trim(), props: {} };
      out.push(cur);
      continue;
    }
    const kv = /^([^=:]+)[=:](.*)$/.exec(line);
    if (kv && cur) cur.props[kv[1].trim().toLowerCase()] = kv[2].trim().toLowerCase();
  }
  return out;
}

function editorConfigMatches(glob: string, rel: string): boolean {
  // "*" in editorconfig means any file name; "**" crosses folders. Our glob
  // helper already treats slash-less patterns as "at any depth".
  if (glob === "*") return true;
  try {
    return globToRegExp(glob).test(rel);
  } catch {
    return false;
  }
}

function fromEditorConfig(sections: EditorConfigSection[], rel: string | null): Partial<Effective> {
  const out: Partial<Effective> = {};
  if (!rel) return out;
  for (const s of sections) {
    if (!editorConfigMatches(s.glob, rel)) continue;
    const p = s.props;
    if (p.indent_style === "space") out.insertSpaces = true;
    if (p.indent_style === "tab") out.insertSpaces = false;
    const size = Number(p.indent_size === "tab" ? p.tab_width : p.indent_size);
    if (size > 0 && size <= 16) out.tabSize = size;
    else if (Number(p.tab_width) > 0) out.tabSize = Number(p.tab_width);
    if (p.trim_trailing_whitespace === "true") out.trimTrailingWhitespace = true;
    if (p.trim_trailing_whitespace === "false") out.trimTrailingWhitespace = false;
    if (p.insert_final_newline === "true") out.insertFinalNewline = true;
    if (p.insert_final_newline === "false") out.insertFinalNewline = false;
    const max = Number(p.max_line_length);
    if (max > 0) out.printWidth = max;
  }
  return out;
}

/* ---------------- store ---------------- */

function clean(data: unknown): ProjectSettings {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const types: Record<string, string> = {
    tabSize: "number",
    insertSpaces: "boolean",
    wordWrap: "boolean",
    formatOnSave: "boolean",
    trimTrailingWhitespace: "boolean",
    insertFinalNewline: "boolean",
    printWidth: "number",
    semi: "boolean",
    singleQuote: "boolean",
    filesExclude: "string",
    useEditorConfig: "boolean",
    terminalCwd: "string",
  };
  for (const [k, t] of Object.entries(types)) if (typeof src[k] === t) out[k] = src[k];
  if (src.languages && typeof src.languages === "object") {
    const langs: Record<string, LanguageOverrides> = {};
    for (const [id, v] of Object.entries(src.languages as Record<string, unknown>)) {
      const c = clean(v) as LanguageOverrides;
      const o: LanguageOverrides = {};
      if (c.tabSize !== undefined) o.tabSize = c.tabSize;
      if (c.insertSpaces !== undefined) o.insertSpaces = c.insertSpaces;
      if (c.wordWrap !== undefined) o.wordWrap = c.wordWrap;
      if (c.formatOnSave !== undefined) o.formatOnSave = c.formatOnSave;
      if (Object.keys(o).length) langs[id] = o;
    }
    if (Object.keys(langs).length) out.languages = langs;
  }
  return out as ProjectSettings;
}

/** JSON with comments and trailing commas, as people write config files. */
function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s: string | undefined) => s ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return stripped.trim() ? JSON.parse(stripped) : {};
}

async function readText(path: string): Promise<string | null> {
  try {
    if (!(await backend().exists(path))) return null;
    const f = await backend().readFile(path);
    return f.binary ? null : f.content;
  } catch {
    return null;
  }
}

let writing = 0;
let loadToken = 0;

export const useProject = create<ProjectState>((set, get) => ({
  root: null,
  settings: {},
  exists: false,
  editorConfig: [],
  version: 0,

  async load(root) {
    const token = ++loadToken;
    if (!root) {
      set((s) => ({ root: null, settings: {}, exists: false, editorConfig: [], version: s.version + 1 }));
      return;
    }
    const [json, ec] = await Promise.all([readText(join(root, PROJECT_FILE)), readText(join(root, ".editorconfig"))]);
    let settings: ProjectSettings = {};
    if (json !== null) {
      try {
        settings = clean(parseJsonc(json));
      } catch (e) {
        toast(`${PROJECT_FILE} is not valid JSON`, "warning", errorMessage(e));
      }
    }
    if (token !== loadToken) return;
    set((s) => ({ root, settings, exists: json !== null, editorConfig: ec ? parseEditorConfig(ec) : [], version: s.version + 1 }));
  },

  onDiskChange(paths) {
    const root = get().root;
    if (!root || Date.now() - writing < 600) return;
    const hit = paths.some((p) => {
      const rel = relative(root, p);
      return rel === PROJECT_FILE || rel === ".editorconfig" || rel === PROJECT_DIR;
    });
    if (hit) void get().load(root);
  },

  async update(patch) {
    const root = get().root;
    if (!root) return;
    const next: Record<string, unknown> = { ...get().settings };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    const settings = clean(next);
    set((s) => ({ settings, exists: true, version: s.version + 1 }));
    writing = Date.now();
    try {
      const dir = join(root, PROJECT_DIR);
      if (!(await backend().exists(dir))) await backend().createDir(dir);
      await backend().writeFile(join(root, PROJECT_FILE), JSON.stringify(settings, null, 2) + "\n");
    } catch (e) {
      toast(`Could not write ${PROJECT_FILE}`, "error", errorMessage(e));
    }
  },

  async setLanguage(langId, patch) {
    const langs = { ...get().settings.languages };
    if (patch === null) delete langs[langId];
    else {
      const merged: Record<string, unknown> = { ...langs[langId] };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length) langs[langId] = merged as LanguageOverrides;
      else delete langs[langId];
    }
    await get().update({ languages: Object.keys(langs).length ? langs : undefined });
  },
}));

/**
 * Indentation and save behavior for one file. `path` may be null (untitled
 * buffers get the user settings plus the project-wide keys).
 */
export function effectiveFor(
  path: string | null,
  langId: string,
  user: Pick<SettingsState, "tabSize" | "insertSpaces" | "wordWrap" | "trimTrailingWhitespace" | "insertFinalNewline"> = useSettings.getState(),
  project: Pick<ProjectState, "root" | "settings" | "editorConfig"> = useProject.getState(),
): Effective {
  const out: Effective = {
    tabSize: user.tabSize,
    insertSpaces: user.insertSpaces,
    wordWrap: user.wordWrap,
    trimTrailingWhitespace: user.trimTrailingWhitespace,
    insertFinalNewline: user.insertFinalNewline,
    formatOnSave: null,
    printWidth: null,
    semi: null,
    singleQuote: null,
  };
  if (!project.root) return out;
  const p = project.settings;
  const rel = path ? relative(project.root, path) : null;
  if (p.useEditorConfig !== false) Object.assign(out, fromEditorConfig(project.editorConfig, rel));
  const lang = p.languages?.[langId] ?? {};
  const pick = <K extends keyof Effective>(k: K, ...vals: Array<Effective[K] | undefined>) => {
    for (const v of vals) if (v !== undefined) return void (out[k] = v);
  };
  pick("tabSize", lang.tabSize, p.tabSize);
  pick("insertSpaces", lang.insertSpaces, p.insertSpaces);
  pick("wordWrap", lang.wordWrap, p.wordWrap);
  pick("formatOnSave", lang.formatOnSave, p.formatOnSave);
  pick("trimTrailingWhitespace", p.trimTrailingWhitespace);
  pick("insertFinalNewline", p.insertFinalNewline);
  pick("printWidth", p.printWidth);
  pick("semi", p.semi);
  pick("singleQuote", p.singleQuote);
  return out;
}

/** User + project globs hidden from the explorer. */
export function effectiveExcludes(userExclude: string, project: ProjectSettings): string[] {
  return [...splitGlobs(userExclude), ...splitGlobs(project.filesExclude ?? "")];
}
