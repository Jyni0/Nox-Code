import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { computeLineChanges, countWords } from "@/extensions/editorFeatures";
import { EXTENSIONS, editorExtensionsFor, extSettings, isExtEnabled } from "@/extensions/registry";
import { LANGUAGES, detectLanguage, isImageFile, languageName } from "@/editor/languages";
import { docHub, syncAnnotation } from "@/editor/docHub";
import { formatText } from "@/extensions/prettier";
import { DEFAULT_SETTINGS } from "@/stores/settings";

describe("languages", () => {
  it("detects languages from names and extensions", () => {
    expect(detectLanguage("App.tsx")).toBe("tsx");
    expect(detectLanguage("Cargo.toml")).toBe("toml");
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage(".env.local")).toBe("ini");
    expect(detectLanguage("CMakeLists.txt")).toBe("cmake");
    expect(detectLanguage("weird.zzz")).toBe("plaintext");
    expect(languageName("rust")).toBe("Rust");
    expect(isImageFile("a.PNG")).toBe(true);
  });

  it("registers 35 languages, each loadable", async () => {
    expect(LANGUAGES.length).toBe(35);
    // Spot-check a modern and a legacy-mode grammar.
    await expect(LANGUAGES.find((l) => l.id === "rust")!.load()).resolves.toBeTruthy();
    await expect(LANGUAGES.find((l) => l.id === "powershell")!.load()).resolves.toBeTruthy();
  });
});

describe("extensions", () => {
  it("has unique ids and a language pack per language", () => {
    expect(new Set(EXTENSIONS.map((e) => e.id)).size).toBe(EXTENSIONS.length);
    expect(EXTENSIONS.filter((e) => e.category === "Languages")).toHaveLength(LANGUAGES.length);
  });

  it("uses defaults until the user changes them", () => {
    const s = { ...DEFAULT_SETTINGS };
    expect(isExtEnabled("vim", s)).toBe(false);
    expect(isExtEnabled("minimap", s)).toBe(true);
    expect(isExtEnabled("minimap", { ...s, extEnabled: { minimap: false } })).toBe(false);
    expect(extSettings("prettier", s).printWidth).toBe(100);
    expect(extSettings("prettier", { ...s, extSettings: { prettier: { printWidth: 80 } } }).printWidth).toBe(80);
  });

  it("builds a working CodeMirror configuration from the enabled set", () => {
    const exts = editorExtensionsFor({ bufferId: "b", langId: "json", path: null }, { ...DEFAULT_SETTINGS, extEnabled: { vim: true } });
    const state = EditorState.create({ doc: "{ }", extensions: exts });
    const view = new EditorView({ state, parent: document.body });
    expect(view.state.doc.toString()).toBe("{ }");
    view.destroy();
  });
});

describe("git gutter diff", () => {
  it("marks added, modified and deleted lines", () => {
    const base = "a\nb\nc\nd\n";
    expect(computeLineChanges(base, "a\nb\nc\nd\nE\n")).toEqual([{ line: 5, kind: "add" }]);
    expect(computeLineChanges(base, "a\nB\nc\nd\n")).toEqual([{ line: 2, kind: "mod" }]);
    expect(computeLineChanges(base, "a\nc\nd\n")).toEqual([{ line: 2, kind: "del" }]);
    expect(computeLineChanges(base, base)).toEqual([]);
  });
});

describe("word count", () => {
  it("counts words in any script", () => {
    expect(countWords("Hello, world — привет мир! It's 2026.")).toBe(6);
    expect(countWords("   ")).toBe(0);
  });
});

describe("docHub", () => {
  it("keeps two views of one buffer in sync", () => {
    docHub.create("sync", "abc");
    const mk = () => {
      let view: EditorView;
      // eslint-disable-next-line prefer-const
      view = new EditorView({
        parent: document.body,
        state: EditorState.create({
          doc: docHub.doc("sync"),
          extensions: EditorView.updateListener.of((u) => {
            for (const tr of u.transactions) if (tr.docChanged && !tr.annotation(syncAnnotation)) docHub.propagate("sync", u.view, tr);
          }),
        }),
      });
      docHub.attach("sync", view);
      return view;
    };
    const a = mk();
    const b = mk();
    a.dispatch({ changes: { from: 3, insert: "d" } });
    expect(b.state.doc.toString()).toBe("abcd");
    expect(docHub.isDirty("sync")).toBe(true);
    docHub.setText("sync", "fresh", { markSaved: true });
    expect(a.state.doc.toString()).toBe("fresh");
    expect(b.state.doc.toString()).toBe("fresh");
    expect(docHub.isDirty("sync")).toBe(false);
    a.destroy();
    b.destroy();
    docHub.dispose("sync");
  });
});

describe("prettier", () => {
  it("formats TypeScript and keeps the cursor nearby", async () => {
    const opts = { printWidth: 80, tabWidth: 2, useTabs: false, semi: true, singleQuote: true, trailingComma: "all" as const };
    const r = await formatText("const   x = {a:1,b:\"two\"}", "typescript", opts, 5);
    expect(r.formatted).toBe("const x = { a: 1, b: 'two' };\n");
    expect(r.cursorOffset).toBeGreaterThanOrEqual(0);
  });

  it("formats JSON and refuses unknown languages", async () => {
    const opts = { printWidth: 80, tabWidth: 2, useTabs: false, semi: true, singleQuote: false, trailingComma: "none" as const };
    expect((await formatText('{"a":[1,2]}', "json", opts)).formatted).toBe('{ "a": [1, 2] }\n');
    await expect(formatText("x", "rust", opts)).rejects.toThrow(/cannot format/);
  });
});

describe("group layout tree", () => {
  it("splits beside and below, and collapses when a group goes away", async () => {
    const { insertLeaf, leaf, leafIds, removeLeaf, syncLayout } = await import("@/editor/layout");
    let t = insertLeaf(leaf("a"), "a", "b", "right");
    expect(t).toMatchObject({ kind: "split", dir: "row" });
    t = insertLeaf(t, "b", "c", "bottom");
    expect(leafIds(t)).toEqual(["a", "b", "c"]);
    // b and c are stacked inside the row.
    expect(t.kind === "split" && t.children[1]).toMatchObject({ kind: "split", dir: "column" });
    // Same direction adds a sibling instead of nesting.
    const t2 = insertLeaf(t, "a", "d", "left");
    expect(t2.kind === "split" && t2.children.map((c) => (c.kind === "pane" ? c.paneId : "split"))).toEqual(["d", "a", "split"]);
    // Removing c leaves b alone in its column, which collapses back into the row.
    const t3 = removeLeaf(t, "c")!;
    expect(t3).toMatchObject({ kind: "split", dir: "row", children: [{ paneId: "a" }, { paneId: "b" }] });
    expect(syncLayout(t3, ["a", "b"])).toBe(t3);
    expect(leafIds(syncLayout(t3, ["b", "x"]))).toEqual(["b", "x"]);
  });
});
