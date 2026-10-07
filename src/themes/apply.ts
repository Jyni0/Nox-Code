import { EDITOR_TOKENS, SYNTAX_TOKENS, UI_TOKENS, type Theme } from "./types";
import { flatten, mix, shade } from "@/lib/color";

/** Writes a theme onto <html> as CSS variables; the whole app follows. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  const s = root.style;
  for (const t of UI_TOKENS) s.setProperty(`--${t}`, theme.ui[t]);
  s.setProperty("--row-solid-gradient", theme.ui["row-solid-hover"]);
  s.setProperty(
    "--shadow-popup",
    theme.kind === "dark" ? "0 10px 30px rgba(0, 0, 0, 0.45)" : "0 10px 30px rgba(0, 0, 0, 0.12)",
  );
  for (const t of EDITOR_TOKENS) {
    const v = theme.editor[t];
    if (v) s.setProperty(`--${t}`, v);
    else s.removeProperty(`--${t}`);
  }
  for (const t of SYNTAX_TOKENS) s.setProperty(`--syn-${t}`, theme.syntax[t]);
  s.setProperty("--syn-comment-style", theme.italicComments ? "italic" : "normal");
  s.setProperty("--syn-keyword-style", theme.italicKeywords ? "italic" : "normal");
  s.setProperty("--syn-keyword-weight", theme.boldKeywords ? "600" : "normal");
  s.setProperty("color-scheme", theme.kind);
  root.dataset.themeKind = theme.kind;
  root.dataset.theme = theme.id;
}

/** xterm.js palette derived from the theme's syntax colors. */
export function terminalTheme(theme: Theme) {
  const bg = theme.ui["bg-editor"];
  const fg = theme.ui["text-main"];
  const sy = theme.syntax;
  const dark = theme.kind === "dark";
  const bright = (c: string) => shade(c, dark ? 0.2 : -0.15);
  const black = dark ? flatten(theme.ui["bg-elevated"], bg) : "#24292f";
  const white = dark ? theme.ui["text-muted"] : "#6e7781";
  return {
    background: bg,
    foreground: fg,
    cursor: theme.editor["ed-cursor"] ?? theme.ui.accent,
    cursorAccent: bg,
    selectionBackground: mix(theme.ui.accent, bg, 0.65),
    black,
    red: theme.ui["diff-del"],
    green: theme.ui["diff-add"],
    yellow: theme.ui["diff-mod"],
    blue: sy.function,
    magenta: sy.keyword,
    cyan: sy.property,
    white,
    brightBlack: theme.ui["text-dim"],
    brightRed: bright(theme.ui["diff-del"]),
    brightGreen: bright(theme.ui["diff-add"]),
    brightYellow: bright(theme.ui["diff-mod"]),
    brightBlue: bright(sy.function),
    brightMagenta: bright(sy.keyword),
    brightCyan: bright(sy.property),
    brightWhite: fg,
  };
}

/** The three dots a theme shows in pickers. */
export const themeSwatch = (t: Theme) => [t.ui["bg-editor"], t.ui.accent, t.syntax.keyword, t.syntax.string];
