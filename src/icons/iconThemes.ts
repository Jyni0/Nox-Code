import { DEFAULT_FOLDER_COLOR, FOLDERS, extOf, fileKind } from "./fileTypes";
import { vsIconTheme } from "./vscodeThemes";

/** How one file or folder is drawn. */
export type IconSpec =
  | { type: "glyph"; icon: string; color: string }
  | { type: "badge"; text: string; bg: string; fg: string }
  /** Soft tinted squircle with a colored label or glyph (the Flow look). */
  | { type: "tile"; color: string; text?: string; icon?: string }
  | { type: "emoji"; char: string }
  | { type: "svg"; markup: string; color?: string }
  /** An image file (VS Code icon themes); "" while it loads. */
  | { type: "img"; src: string }
  | { type: "dot"; color: string }
  | { type: "none" };

/** A user rule: "*.test.ts files get a flask", "folder 'api' is purple". */
export interface IconRule {
  id: string;
  match: "ext" | "name" | "folder";
  /** Extension without the dot ("ts"), exact file name, or folder name. Case-insensitive. */
  pattern: string;
  icon: IconSpec;
}

export interface IconTheme {
  id: string;
  name: string;
  description: string;
  file(name: string): IconSpec;
  folder(name: string, open: boolean): IconSpec;
}

const DIM = "var(--text-dim)";
const MUTED = "var(--text-muted)";

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

const folderGlyph = (name: string, open: boolean, color?: string): IconSpec => {
  const special = FOLDERS[name.toLowerCase()];
  if (special) return { type: "glyph", icon: open && special.iconOpen ? special.iconOpen : special.icon, color: color ?? special.color };
  return { type: "glyph", icon: open ? "FolderOpen" : "Folder", color: color ?? DEFAULT_FOLDER_COLOR };
};

/** Languages read best as letters (TS, C#, PY); formats as pictures (braces, image, lock). */
const LETTER_ICONS = new Set(["FileCode", "Hash", "FileText"]);

export const ICON_THEMES: IconTheme[] = [
  {
    id: "flow",
    name: "Nox Flow",
    description: "Soft tinted tiles and quiet outline folders — in the spirit of VS Code's Flow Icons.",
    file: (name) => {
      const kind = fileKind(name);
      if (!kind) return { type: "tile", color: "#8b95a7", icon: "File" };
      return LETTER_ICONS.has(kind.icon) ? { type: "tile", color: kind.color, text: kind.badge } : { type: "tile", color: kind.color, icon: kind.icon };
    },
    // Plain folders stay neutral; known ones (src, assets, tests…) keep their glyph and hue.
    folder: (name, open) => {
      const special = FOLDERS[name.toLowerCase()];
      if (special) return { type: "glyph", icon: open && special.iconOpen ? special.iconOpen : special.icon, color: special.color };
      return { type: "glyph", icon: open ? "FolderOpen" : "Folder", color: MUTED };
    },
  },
  {
    id: "glyphs",
    name: "Nox Glyphs",
    description: "Colored glyphs per language, special folders get their own icons.",
    file: (name) => {
      const kind = fileKind(name);
      return kind ? { type: "glyph", icon: kind.icon, color: kind.color } : { type: "glyph", icon: "FileText", color: DIM };
    },
    folder: (name, open) => folderGlyph(name, open),
  },
  {
    id: "badges",
    name: "Badges",
    description: "Singularity-style colored language tiles — TS, RS, {}.",
    file: (name) => {
      const kind = fileKind(name);
      return kind ? { type: "badge", text: kind.badge, bg: kind.color, fg: kind.badgeFg ?? "#ffffff" } : { type: "glyph", icon: "FileText", color: DIM };
    },
    folder: (name, open) => {
      const special = FOLDERS[name.toLowerCase()];
      return { type: "glyph", icon: open ? "FolderOpen" : "Folder", color: special?.color ?? DEFAULT_FOLDER_COLOR };
    },
  },
  {
    id: "spectral",
    name: "Spectral",
    description: "Every extension gets its own hue from the visible spectrum.",
    file: (name) => {
      const kind = fileKind(name);
      const ext = extOf(name) || name;
      return { type: "glyph", icon: kind?.icon ?? "File", color: `hsl(${hashHue(ext)} 75% 66%)` };
    },
    folder: (name, open) => ({ type: "glyph", icon: open ? "FolderOpen" : "Folder", color: `hsl(${hashHue(name.toLowerCase())} 60% 64%)` }),
  },
  {
    id: "quantum-dots",
    name: "Quantum Dots",
    description: "Just a colored dot — quiet, Zed-like.",
    file: (name) => ({ type: "dot", color: fileKind(name)?.color ?? DIM }),
    folder: (name, open) => ({ type: "glyph", icon: open ? "FolderOpen" : "Folder", color: FOLDERS[name.toLowerCase()]?.color ?? MUTED }),
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Monochrome glyphs that follow the theme's text color.",
    file: (name) => ({ type: "glyph", icon: fileKind(name)?.icon ?? "FileText", color: MUTED }),
    folder: (name, open) => folderGlyph(name, open, MUTED),
  },
  {
    id: "none",
    name: "No Icons",
    description: "Names only.",
    file: () => ({ type: "none" }),
    folder: () => ({ type: "none" }),
  },
];

export const DEFAULT_ICON_THEME = "flow";

export function findIconTheme(id: string): IconTheme {
  if (id.startsWith("vsc:")) return vsIconTheme(id) ?? ICON_THEMES[0];
  return ICON_THEMES.find((t) => t.id === id) ?? ICON_THEMES[0];
}

/** Custom rules win: exact name, then the longest matching extension. */
export function resolveIcon(name: string, isDir: boolean, open: boolean, themeId: string, rules: IconRule[]): IconSpec {
  const lower = name.toLowerCase();
  if (isDir) {
    const rule = rules.find((r) => r.match === "folder" && r.pattern.toLowerCase() === lower);
    if (rule) return rule.icon;
    return findIconTheme(themeId).folder(name, open);
  }
  const byName = rules.find((r) => r.match === "name" && r.pattern.toLowerCase() === lower);
  if (byName) return byName.icon;
  const byExt = rules
    .filter((r) => r.match === "ext" && lower.endsWith("." + r.pattern.toLowerCase().replace(/^\./, "")))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  if (byExt) return byExt.icon;
  return findIconTheme(themeId).file(name);
}
