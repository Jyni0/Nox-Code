/**
 * Theme import / export: Nox Code's own JSON and VS Code color themes
 * (the `colors` + `tokenColors` format every Marketplace theme ships).
 */
import { EDITOR_TOKENS, SYNTAX_TOKENS, UI_TOKENS, type EditorToken, type SyntaxToken, type Theme, type UiToken } from "./types";
import { BUILTIN_THEMES } from "./builtin";
import { flatten, isColor, isDark, mix, parseColor, shade, toHex, withAlpha, contrastText } from "@/lib/color";

/** VS Code themes are JSONC: comments and trailing commas are common. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "theme";
}

interface VsTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

interface VsTheme {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: VsTokenColor[];
  semanticTokenColors?: Record<string, string | { foreground?: string }>;
}

const SCOPES: Record<SyntaxToken, string[]> = {
  keyword: ["keyword.control", "keyword", "storage.modifier", "storage"],
  string: ["string.quoted", "string"],
  comment: ["comment.line", "comment.block", "comment"],
  function: ["entity.name.function", "support.function", "meta.function-call"],
  variable: ["variable.other.readwrite", "variable.other", "variable", "identifier"],
  property: ["variable.other.property", "support.type.property-name", "meta.object-literal.key", "variable.other.object.property"],
  type: ["entity.name.type", "entity.name.class", "support.type", "support.class", "storage.type"],
  number: ["constant.numeric", "constant"],
  constant: ["constant.language", "variable.other.constant", "support.constant", "constant"],
  operator: ["keyword.operator", "punctuation.accessor"],
  punctuation: ["punctuation.separator", "punctuation.definition", "punctuation", "meta.brace"],
  tag: ["entity.name.tag", "meta.tag"],
  attribute: ["entity.other.attribute-name", "meta.attribute"],
  regexp: ["string.regexp", "constant.regexp"],
  heading: ["markup.heading", "entity.name.section"],
  link: ["markup.underline.link", "string.other.link"],
  meta: ["meta.decorator", "entity.name.function.decorator", "storage.type.annotation", "meta.preprocessor"],
  invalid: ["invalid.illegal", "invalid"],
};

function scopesOf(r: VsTokenColor): string[] {
  if (!r.scope) return [];
  const list = Array.isArray(r.scope) ? r.scope : r.scope.split(",");
  return list.map((s) => s.trim()).filter(Boolean);
}

/** Color of the most specific rule for a preferred scope list. */
function lookup(rules: VsTokenColor[], prefs: string[]): { color?: string; italic?: boolean; bold?: boolean } {
  for (const pref of prefs) {
    let exact: VsTokenColor | undefined;
    let child: VsTokenColor | undefined;
    for (const r of rules) {
      if (!r.settings?.foreground) continue;
      for (const s of scopesOf(r)) {
        // Selectors with descendants ("meta.tag string") are too specific.
        if (s.includes(" ")) continue;
        if (s === pref) exact = r;
        else if (!child && s.startsWith(pref + ".")) child = r;
      }
    }
    const hit = exact ?? child;
    if (hit?.settings?.foreground && isColor(hit.settings.foreground)) {
      const fs = hit.settings.fontStyle ?? "";
      return { color: hit.settings.foreground, italic: fs.includes("italic"), bold: fs.includes("bold") };
    }
  }
  return {};
}

export function fromVsCode(json: unknown, fileName = "Imported theme"): Theme {
  const vs = json as VsTheme;
  if (!vs || typeof vs !== "object" || (!vs.colors && !vs.tokenColors)) {
    throw new Error("This is not a VS Code color theme (no `colors` / `tokenColors`).");
  }
  const c = vs.colors ?? {};
  const get = (...keys: string[]) => keys.map((k) => c[k]).find((v) => v && isColor(v));
  const editorBg = get("editor.background") ?? (vs.type === "light" ? "#ffffff" : "#1e1e1e");
  const kind: Theme["kind"] = vs.type === "light" || vs.type === "hc-light" ? "light" : vs.type === "dark" || vs.type === "hc-black" ? "dark" : isDark(editorBg) ? "dark" : "light";
  const dark = kind === "dark";
  const fg = get("editor.foreground", "foreground") ?? (dark ? "#d4d4d4" : "#1f1f1f");
  const opaque = (v: string | undefined, over: string) => (v ? flatten(v, over) : undefined);

  const sidebar = opaque(get("sideBar.background", "activityBar.background"), editorBg) ?? shade(editorBg, dark ? -0.15 : -0.03);
  const surface = opaque(get("editorWidget.background", "dropdown.background", "quickInput.background", "menu.background"), editorBg) ?? shade(editorBg, dark ? 0.04 : 0);
  const inputBg = opaque(get("input.background", "dropdown.background"), surface) ?? shade(surface, dark ? 0.05 : -0.05);
  const accent = get("focusBorder", "button.background", "textLink.foreground", "activityBarBadge.background") ?? "#388bfd";
  const accentSolid = flatten(accent, editorBg);

  const ui: Record<UiToken, string> = {
    "bg-app": opaque(get("panel.background", "editorGroupHeader.tabsBackground"), editorBg) ?? editorBg,
    "bg-sidebar": sidebar,
    "bg-titlebar": opaque(get("titleBar.activeBackground"), sidebar) ?? sidebar,
    "bg-surface": surface,
    "bg-input": inputBg,
    "bg-elevated": shade(inputBg, dark ? 0.08 : -0.06),
    "bg-editor": editorBg,
    border: get("panel.border", "sideBar.border", "editorGroup.border") ?? withAlpha(fg, 0.1),
    "border-soft": withAlpha(fg, 0.06),
    "text-main": fg,
    "text-muted": get("descriptionForeground", "sideBar.foreground") ?? mix(fg, editorBg, 0.3),
    "text-dim": get("editorLineNumber.foreground") ?? mix(fg, editorBg, 0.5),
    accent: accentSolid,
    "accent-hover": get("button.hoverBackground") ?? shade(accentSolid, dark ? 0.12 : -0.1),
    "accent-fg": get("button.foreground") ?? contrastText(accentSolid),
    "diff-add": get("gitDecoration.addedResourceForeground", "editorGutter.addedBackground", "terminal.ansiGreen") ?? "#3fb950",
    "diff-del": get("gitDecoration.deletedResourceForeground", "editorError.foreground", "terminal.ansiRed") ?? "#f85149",
    "diff-mod": get("gitDecoration.modifiedResourceForeground", "editorWarning.foreground", "terminal.ansiYellow") ?? "#d29922",
    "hover-bg": get("list.hoverBackground") ?? withAlpha(fg, 0.06),
    "row-solid": sidebar,
    "row-solid-hover": flatten(get("list.hoverBackground") ?? withAlpha(fg, 0.08), sidebar),
  };

  const editor: Partial<Record<EditorToken, string>> = {};
  const ed = (k: EditorToken, ...keys: string[]) => {
    const v = get(...keys);
    if (v) editor[k] = v;
  };
  ed("ed-fg", "editor.foreground");
  ed("ed-gutter", "editorLineNumber.foreground");
  ed("ed-gutter-active", "editorLineNumber.activeForeground");
  ed("ed-line-highlight", "editor.lineHighlightBackground");
  ed("ed-selection", "editor.selectionBackground");
  ed("ed-match", "editor.selectionHighlightBackground", "editor.wordHighlightBackground");
  ed("ed-cursor", "editorCursor.foreground");
  ed("ed-bracket", "editorBracketMatch.background");
  ed("ed-search", "editor.findMatchHighlightBackground");
  ed("ed-whitespace", "editorWhitespace.foreground");
  ed("ed-indent", "editorIndentGuide.background", "editorIndentGuide.background1");
  ed("ed-indent-active", "editorIndentGuide.activeBackground", "editorIndentGuide.activeBackground1");

  const rules = vs.tokenColors ?? [];
  const base = BUILTIN_THEMES.find((t) => t.kind === kind)!;
  const syntax = {} as Record<SyntaxToken, string>;
  let italicComments = false;
  let italicKeywords = false;
  let boldKeywords = false;
  for (const tok of SYNTAX_TOKENS) {
    const r = lookup(rules, SCOPES[tok]);
    syntax[tok] = r.color ?? (tok === "variable" || tok === "punctuation" ? fg : base.syntax[tok]);
    if (tok === "comment") italicComments = !!r.italic;
    if (tok === "keyword") {
      italicKeywords = !!r.italic;
      boldKeywords = !!r.bold;
    }
  }

  const name = vs.name?.trim() || fileName.replace(/\.(json|jsonc)$/i, "");
  return {
    id: "custom-" + slugify(name) + "-" + uid(),
    name,
    kind,
    author: "Imported from VS Code",
    ui,
    editor,
    syntax,
    italicComments,
    italicKeywords,
    boldKeywords,
  };
}

/** Validates (and repairs) a theme read from a Nox Code theme file. */
export function fromNoxJson(json: unknown): Theme {
  const t = json as Partial<Theme> & { noxTheme?: number };
  if (!t || typeof t !== "object" || !t.ui || !t.syntax) throw new Error("Not a Nox Code theme file.");
  const kind = t.kind === "light" ? "light" : "dark";
  const base = BUILTIN_THEMES.find((b) => b.kind === kind)!;
  const ui = { ...base.ui };
  for (const k of UI_TOKENS) if (typeof t.ui[k] === "string" && isColor(t.ui[k])) ui[k] = t.ui[k];
  const syntax = { ...base.syntax };
  for (const k of SYNTAX_TOKENS) if (typeof t.syntax[k] === "string" && isColor(t.syntax[k])) syntax[k] = t.syntax[k];
  const editor: Theme["editor"] = {};
  for (const k of EDITOR_TOKENS) {
    const v = t.editor?.[k];
    if (typeof v === "string" && isColor(v)) editor[k] = v;
  }
  const name = (t.name || "Imported theme").toString().slice(0, 60);
  return {
    id: "custom-" + slugify(name) + "-" + uid(),
    name,
    kind,
    author: t.author,
    description: t.description,
    ui,
    editor,
    syntax,
    italicComments: !!t.italicComments,
    italicKeywords: !!t.italicKeywords,
    boldKeywords: !!t.boldKeywords,
  };
}

/** Accepts either format; VS Code themes are recognised by `tokenColors` / `colors`. */
export function importTheme(text: string, fileName?: string): Theme {
  const json = parseJsonc(text);
  const obj = json as Record<string, unknown>;
  if (obj && (obj.tokenColors || (obj.colors && !obj.ui))) return fromVsCode(json, fileName);
  return fromNoxJson(json);
}

export function exportTheme(t: Theme): string {
  const { builtin: _b, ...rest } = t;
  return JSON.stringify({ noxTheme: 1, ...rest }, null, 2);
}

/** Editable copy of any theme ("Customize"). */
export function cloneTheme(t: Theme, name = `${t.name} (Custom)`): Theme {
  return {
    ...structuredClone({ ...t, builtin: undefined }),
    id: "custom-" + slugify(name) + "-" + uid(),
    name,
    author: "You",
    builtin: undefined,
  };
}

/** Quick-generate a palette from three colors (theme studio "Generate"). */
export function generateTheme(name: string, bg: string, accent: string, kind?: Theme["kind"]): Theme {
  const k = kind ?? (isDark(bg) ? "dark" : "light");
  const dark = k === "dark";
  const base = BUILTIN_THEMES.find((t) => t.id === (dark ? "nox-dark" : "nox-light"))!;
  const fg = dark ? mix("#ffffff", bg, 0.1) : mix("#000000", bg, 0.1);
  const step = (n: number) => shade(bg, dark ? n : -n);
  const acc = parseColor(accent) ? toHex({ ...parseColor(accent)!, a: 1 }, false) : base.ui.accent;
  return {
    ...cloneTheme(base, name),
    kind: k,
    ui: {
      "bg-app": bg,
      "bg-sidebar": step(0.04),
      "bg-titlebar": step(0.04),
      "bg-surface": step(0.07),
      "bg-input": step(0.1),
      "bg-elevated": step(0.16),
      "bg-editor": bg,
      border: withAlpha(fg, 0.09),
      "border-soft": withAlpha(fg, 0.06),
      "text-main": fg,
      "text-muted": mix(fg, bg, 0.38),
      "text-dim": mix(fg, bg, 0.55),
      accent: acc,
      "accent-hover": shade(acc, dark ? 0.12 : -0.1),
      "accent-fg": contrastText(acc),
      "diff-add": base.ui["diff-add"],
      "diff-del": base.ui["diff-del"],
      "diff-mod": base.ui["diff-mod"],
      "hover-bg": withAlpha(fg, 0.06),
      "row-solid": step(0.04),
      "row-solid-hover": step(0.1),
    },
    syntax: { ...base.syntax, keyword: acc, variable: fg, punctuation: mix(fg, bg, 0.4), comment: mix(fg, bg, 0.6) },
  };
}
