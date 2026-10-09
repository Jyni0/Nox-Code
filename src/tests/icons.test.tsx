import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ICON_THEMES, resolveIcon, type IconRule } from "@/icons/iconThemes";
import { fileKind } from "@/icons/fileTypes";
import { ICON_LIBRARY } from "@/icons/library";
import { IconView } from "@/icons/FileIcon";
import { parseTheme, pickIcon, resolvePath } from "@/icons/vscodeThemes";

describe("file kinds", () => {
  it("knows special file names before extensions", () => {
    expect(fileKind("package.json")!.icon).toBe("Package");
    expect(fileKind("index.test.ts")!.badge).toBe("TST");
    expect(fileKind("types.d.ts")!.badge).toBe("DTS");
    expect(fileKind(".env.production")!.badge).toBe("ENV");
    expect(fileKind("Dockerfile.dev")!.icon).toBe("Container");
    expect(fileKind("main.rs")!.badge).toBe("RS");
    expect(fileKind("mystery.xyz")).toBeNull();
  });

  it("only references icons that exist in the library", () => {
    for (const t of ICON_THEMES) {
      for (const name of ["a.ts", "b.unknown", "package.json", "x.png"]) {
        const spec = t.file(name);
        if (spec.type === "glyph") expect(ICON_LIBRARY[spec.icon], `${t.id}: ${spec.icon}`).toBeDefined();
      }
      for (const dir of ["src", "node_modules", "whatever"]) {
        const spec = t.folder(dir, false);
        if (spec.type === "glyph") expect(ICON_LIBRARY[spec.icon]).toBeDefined();
      }
    }
  });
});

describe("resolveIcon", () => {
  const rules: IconRule[] = [
    { id: "1", match: "ext", pattern: "ts", icon: { type: "emoji", char: "🔷" } },
    { id: "2", match: "ext", pattern: "test.ts", icon: { type: "emoji", char: "🧪" } },
    { id: "3", match: "name", pattern: "main.ts", icon: { type: "emoji", char: "🚀" } },
    { id: "4", match: "folder", pattern: "API", icon: { type: "dot", color: "#f0f" } },
  ];

  it("prefers exact names, then the longest extension", () => {
    expect(resolveIcon("main.ts", false, false, "glyphs", rules)).toEqual({ type: "emoji", char: "🚀" });
    expect(resolveIcon("a.test.ts", false, false, "glyphs", rules)).toEqual({ type: "emoji", char: "🧪" });
    expect(resolveIcon("b.ts", false, false, "glyphs", rules)).toEqual({ type: "emoji", char: "🔷" });
  });

  it("matches folders case-insensitively and falls back to the theme", () => {
    expect(resolveIcon("api", true, false, "glyphs", rules)).toEqual({ type: "dot", color: "#f0f" });
    expect(resolveIcon("src", true, true, "glyphs", rules)).toMatchObject({ type: "glyph", icon: "FolderCode" });
    expect(resolveIcon("x.rs", false, false, "badges", [])).toMatchObject({ type: "badge", text: "RS" });
    expect(resolveIcon("x.rs", false, false, "none", [])).toEqual({ type: "none" });
  });

  it("gives each extension a stable hue in the Spectral theme", () => {
    const a = resolveIcon("a.foo", false, false, "spectral", []);
    const b = resolveIcon("b.foo", false, false, "spectral", []);
    expect(a).toEqual(b);
  });
});

describe("IconView", () => {
  it("renders badges, emoji and sanitized SVG", () => {
    const { container, rerender } = render(<IconView spec={{ type: "badge", text: "TS", bg: "#3178c6", fg: "#fff" }} />);
    expect(container.textContent).toBe("TS");
    rerender(<IconView spec={{ type: "emoji", char: "🚀" }} />);
    expect(container.textContent).toBe("🚀");
    rerender(<IconView spec={{ type: "svg", markup: '<svg viewBox="0 0 1 1"><script>alert(1)</script><rect width="1" height="1"/></svg>' }} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("rect")).not.toBeNull();
  });
});

describe("VS Code icon themes", () => {
  const theme = parseTheme(
    {
      iconDefinitions: { file: { iconPath: "./dark/file.svg" }, ts: { iconPath: "./dark/ts.svg" }, test: { iconPath: "./dark/test.svg" }, pkg: { iconPath: "../shared/pkg.svg" }, folder: { iconPath: "./dark/folder.svg" }, folderOpen: { iconPath: "./dark/folder-open.svg" }, src: { iconPath: "./dark/src.svg" }, py: { iconPath: "./dark/py.svg" }, tsLight: { iconPath: "./light/ts.svg" } },
      file: "file",
      folder: "folder",
      folderExpanded: "folderOpen",
      fileExtensions: { ts: "ts", "TEST.ts": "test" },
      fileNames: { "Package.json": "pkg" },
      folderNames: { src: "src" },
      languageIds: { python: "py" },
      light: { fileExtensions: { ts: "tsLight" } },
    },
    String.raw`C:\ext\themes\dark.json`,
  );
  const pick = (name: string, dir = false, open = false, light = false) => pickIcon(theme, name, dir, open, light);

  it("matches like VS Code: file names, longest extension, language, default", () => {
    expect(pick("package.json")).toBe("pkg");
    expect(pick("a.test.ts")).toBe("test");
    expect(pick("a.ts")).toBe("ts");
    expect(pick("script.pyw")).toBe("py");
    expect(pick("notes.unknown")).toBe("file");
  });
  it("handles folders, open folders and light themes", () => {
    expect(pick("src", true)).toBe("src");
    expect(pick("src", true, true)).toBe("src");
    expect(pick("lib", true)).toBe("folder");
    expect(pick("lib", true, true)).toBe("folderOpen");
    expect(pick("a.ts", false, false, true)).toBe("tsLight");
    expect(pick("a.test.ts", false, false, true)).toBe("test");
  });
  it("resolves icon paths against the theme file", () => {
    expect(theme.paths.get("ts")).toBe(String.raw`C:\ext\themes\dark\ts.svg`);
    expect(theme.paths.get("pkg")).toBe(String.raw`C:\ext\shared\pkg.svg`);
    expect(resolvePath("/home/u/.vscode/extensions/x", "./a/../b.json")).toBe("/home/u/.vscode/extensions/x/b.json");
  });
});
