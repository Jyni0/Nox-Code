import { describe, expect, it } from "vitest";
import { basename, dirname, extname, isInside, join, rebase, relative, samePath } from "@/lib/path";
import { globToRegExp, matchesAny, splitGlobs } from "@/lib/glob";
import { fuzzyFilter, fuzzyMatch } from "@/lib/fuzzy";
import { contrastText, flatten, isDark, mix, parseColor, toHex, withAlpha } from "@/lib/color";
import { eventToCombo, formatCombo, keyName, normalizeCombo } from "@/lib/keys";

describe("path", () => {
  it("joins with the separator of the base path", () => {
    expect(join("C:\\code\\app", "src", "main.ts")).toBe("C:\\code\\app\\src\\main.ts");
    expect(join("/home/u/app/", "/src/", "a.ts")).toBe("/home/u/app/src/a.ts");
    expect(join("C:\\code", "a/b/c.ts")).toBe("C:\\code\\a\\b\\c.ts");
  });

  it("splits names, folders and extensions", () => {
    expect(basename("C:\\a\\b\\file.TS")).toBe("file.TS");
    expect(dirname("/a/b/c")).toBe("/a/b");
    expect(dirname("/a")).toBe("/");
    expect(extname("x/Readme.MD")).toBe("md");
    expect(extname(".gitignore")).toBe("");
  });

  it("computes relative paths case-insensitively on Windows", () => {
    expect(relative("C:\\Code\\App", "c:\\code\\app\\src\\x.ts")).toBe("src/x.ts");
    expect(relative("/a/b", "/a/b")).toBe("");
    expect(relative("/a/b", "/a/bc/x")).toBeNull();
    expect(isInside("/a", "/a/b/c")).toBe(true);
    expect(samePath("C:\\A\\b", "c:/a/B")).toBe(true);
  });

  it("rebases paths after a move", () => {
    expect(rebase("/p/src/a/x.ts", "/p/src/a", "/p/lib/a")).toBe("/p/lib/a/x.ts");
    expect(rebase("/p/src/a", "/p/src/a", "/p/b")).toBe("/p/b");
    expect(rebase("/p/other", "/p/src", "/p/x")).toBeNull();
  });
});

describe("glob", () => {
  it("matches gitignore-style patterns", () => {
    expect(globToRegExp("*.ts").test("src/deep/a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("a.tsx")).toBe(false);
    expect(globToRegExp("src/**").test("src/a/b.ts")).toBe(true);
    expect(globToRegExp("src/**").test("lib/a.ts")).toBe(false);
    expect(globToRegExp("node_modules").test("node_modules/x/y.js")).toBe(true);
    expect(globToRegExp("**/dist").test("packages/a/dist/x.js")).toBe(true);
    expect(globToRegExp("*.{js,ts}").test("a.js")).toBe(true);
  });

  it("splits comma lists", () => {
    expect(splitGlobs(" *.ts, ,src/** ")).toEqual(["*.ts", "src/**"]);
    expect(matchesAny(".git/HEAD", splitGlobs(".git, .DS_Store"))).toBe(true);
  });
});

describe("fuzzy", () => {
  it("requires characters in order", () => {
    expect(fuzzyMatch("mts", "src/main.ts")).not.toBeNull();
    expect(fuzzyMatch("xyz", "src/main.ts")).toBeNull();
  });

  it("prefers file-name and word-start matches", () => {
    const files = ["src/components/Button.tsx", "src/main.ts", "docs/manual/install.md"];
    const res = fuzzyFilter("main", files, (f) => f);
    expect(res[0].item).toBe("src/main.ts");
    const res2 = fuzzyFilter("btn", files, (f) => f);
    expect(res2[0].item).toBe("src/components/Button.tsx");
  });

  it("returns highlight positions", () => {
    const r = fuzzyMatch("abc", "a_b_c")!;
    expect(r.positions).toEqual([0, 2, 4]);
  });

  it("keeps the original order for an empty query", () => {
    expect(fuzzyFilter("", ["b", "a"], (x) => x).map((r) => r.item)).toEqual(["b", "a"]);
  });
});

describe("color", () => {
  it("parses hex and rgb()", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#00000080")!.a).toBeCloseTo(0.5, 1);
    expect(parseColor("rgba(10, 20, 30, 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseColor("nope")).toBeNull();
  });

  it("mixes, flattens and picks readable text", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(flatten("rgba(255,255,255,0.5)", "#000000")).toBe("#808080");
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080");
    expect(toHex({ r: 1, g: 2, b: 3, a: 1 })).toBe("#010203");
    expect(isDark("#101010")).toBe(true);
    expect(contrastText("#ffffff")).toBe("#111111");
  });
});

describe("keys", () => {
  const ev = (init: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...init }) as KeyboardEvent;

  it("uses the physical key so shortcuts work on any layout", () => {
    expect(keyName({ key: "з", code: "KeyP" })).toBe("P");
    expect(eventToCombo(ev({ key: "з", code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(eventToCombo(ev({ key: "`", code: "Backquote", ctrlKey: true }))).toBe("Ctrl+`");
    expect(eventToCombo(ev({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
  });

  it("normalizes modifier order and aliases", () => {
    expect(normalizeCombo("shift+ctrl+p")).toBe("Ctrl+Shift+P");
    expect(normalizeCombo("Alt+Shift+f")).toBe("Shift+Alt+F");
    expect(normalizeCombo("cmd+k")).toBe("Ctrl+K");
    expect(formatCombo("ctrl+,")).toEqual(["Ctrl", ","]);
  });
});
