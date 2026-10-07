import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "@/themes/builtin";
import { SYNTAX_TOKENS, UI_TOKENS } from "@/themes/types";
import { applyTheme, terminalTheme } from "@/themes/apply";
import { cloneTheme, exportTheme, fromVsCode, generateTheme, importTheme, parseJsonc } from "@/themes/convert";
import { isColor } from "@/lib/color";

const VSCODE_THEME = `{
  // A Marketplace-style theme with comments and trailing commas
  "name": "Night Owl Mini",
  "type": "dark",
  "colors": {
    "editor.background": "#011627",
    "editor.foreground": "#d6deeb",
    "sideBar.background": "#011627",
    "focusBorder": "#122d42",
    "button.background": "#7e57c2",
    "editorLineNumber.foreground": "#4b6479",
    "editor.selectionBackground": "#1d3b53",
    "editorCursor.foreground": "#80a4c2",
    "gitDecoration.addedResourceForeground": "#9ccc65",
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#637777", "fontStyle": "italic" } },
    { "scope": "string", "settings": { "foreground": "#ecc48d" } },
    { "scope": "keyword.control", "settings": { "foreground": "#c792ea", "fontStyle": "italic" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#82aaff" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f78c6c" } },
    { "scope": "meta.tag string", "settings": { "foreground": "#ff0000" } },
  ],
}`;

describe("built-in themes", () => {
  it("ship 20 complete palettes with unique ids", () => {
    expect(BUILTIN_THEMES.length).toBe(20);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length);
    for (const t of BUILTIN_THEMES) {
      for (const k of UI_TOKENS) expect(isColor(t.ui[k]), `${t.id} ui.${k}`).toBe(true);
      for (const k of SYNTAX_TOKENS) expect(isColor(t.syntax[k]), `${t.id} syntax.${k}`).toBe(true);
    }
  });

  it("include the science-themed originals", () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["nox-dark", "event-horizon", "nebula", "aurora", "photon"]));
  });
});

describe("applyTheme", () => {
  it("writes CSS variables onto the root element", () => {
    const el = document.createElement("div");
    const t = BUILTIN_THEMES.find((x) => x.id === "nebula")!;
    applyTheme({ ...t, editor: { "ed-cursor": "#ff00ff" } }, el);
    expect(el.style.getPropertyValue("--accent")).toBe(t.ui.accent);
    expect(el.style.getPropertyValue("--syn-keyword")).toBe(t.syntax.keyword);
    expect(el.style.getPropertyValue("--ed-cursor")).toBe("#ff00ff");
    expect(el.dataset.themeKind).toBe("dark");
    applyTheme(t, el);
    expect(el.style.getPropertyValue("--ed-cursor")).toBe("");
  });

  it("derives a full terminal palette", () => {
    const term = terminalTheme(BUILTIN_THEMES[0]);
    expect(term.background).toBe(BUILTIN_THEMES[0].ui["bg-editor"]);
    for (const v of Object.values(term)) expect(isColor(v)).toBe(true);
  });
});

describe("VS Code import", () => {
  it("parses JSONC without breaking strings that contain //", () => {
    expect(parseJsonc('{"url": "http://x//y", /* c */ "a": [1,],}')).toEqual({ url: "http://x//y", a: [1] });
  });

  it("maps colors and token scopes", () => {
    const t = importTheme(VSCODE_THEME, "night-owl.json");
    expect(t.name).toBe("Night Owl Mini");
    expect(t.kind).toBe("dark");
    expect(t.ui["bg-editor"]).toBe("#011627");
    expect(t.ui["text-main"]).toBe("#d6deeb");
    expect(t.ui["diff-add"]).toBe("#9ccc65");
    expect(t.editor["ed-cursor"]).toBe("#80a4c2");
    expect(t.syntax.comment).toBe("#637777");
    expect(t.syntax.string).toBe("#ecc48d");
    expect(t.syntax.keyword).toBe("#c792ea");
    expect(t.syntax.function).toBe("#82aaff");
    expect(t.syntax.number).toBe("#f78c6c");
    // Descendant selectors are ignored.
    expect(t.syntax.string).not.toBe("#ff0000");
    expect(t.italicComments).toBe(true);
    expect(t.italicKeywords).toBe(true);
    expect(t.builtin).toBeUndefined();
  });

  it("guesses light themes from the background", () => {
    const t = fromVsCode({ colors: { "editor.background": "#fafafa" }, tokenColors: [] });
    expect(t.kind).toBe("light");
  });

  it("rejects files that are not themes", () => {
    expect(() => importTheme('{"hello": 1}')).toThrow();
  });
});

describe("Nox Code theme files", () => {
  it("round-trip through export / import and repair bad values", () => {
    const src = cloneTheme(BUILTIN_THEMES[2], "Mine");
    const json = JSON.parse(exportTheme(src));
    expect(json.noxTheme).toBe(1);
    json.syntax.keyword = "not-a-color";
    const back = importTheme(JSON.stringify(json));
    expect(back.name).toBe("Mine");
    expect(back.ui.accent).toBe(src.ui.accent);
    expect(back.syntax.keyword).toBe(BUILTIN_THEMES[0].syntax.keyword);
    expect(back.id).not.toBe(src.id);
  });

  it("generates a theme from a background and an accent", () => {
    const t = generateTheme("Gen", "#fdfdfd", "#e8590c");
    expect(t.kind).toBe("light");
    expect(t.ui.accent).toBe("#e8590c");
    expect(t.syntax.keyword).toBe("#e8590c");
    for (const k of UI_TOKENS) expect(isColor(t.ui[k])).toBe(true);
  });
});
