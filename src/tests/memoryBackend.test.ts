import { describe, expect, it } from "vitest";
import { createMemoryBackend } from "@/lib/memoryBackend";

const ROOT = "/p";
const make = () =>
  createMemoryBackend({
    root: ROOT,
    files: { "src/a.ts": "const Foo = 1;\nfoo(Foo);\n", "src/b.css": ".foo {}\n", "README.md": "# hi\n", ".gitignore": "dist\n" },
  });

describe("memory backend: files", () => {
  it("lists folders first and reads files", async () => {
    const b = make();
    const entries = await b.listDir(ROOT);
    expect(entries.map((e) => e.name)).toEqual(["src", ".gitignore", "README.md"]);
    expect((await b.readFile("/p/src/a.ts")).content).toContain("Foo");
  });

  it("creates, renames, copies and removes", async () => {
    const b = make();
    await b.createFile("/p/new/deep/x.ts");
    expect(await b.exists("/p/new/deep")).toBe(true);
    await expect(b.createFile("/p/new/deep/x.ts")).rejects.toThrow(/exists/);
    await b.rename("/p/new", "/p/moved");
    expect(await b.exists("/p/moved/deep/x.ts")).toBe(true);
    await b.copy("/p/moved", "/p/copy");
    expect(await b.exists("/p/copy/deep/x.ts")).toBe(true);
    await b.remove("/p/moved");
    expect(await b.exists("/p/moved/deep/x.ts")).toBe(false);
  });

  it("writes with the requested line ending", async () => {
    const b = make();
    await b.writeFile("/p/w.txt", "a\nb", "CRLF");
    const f = await b.readFile("/p/w.txt");
    expect(f.lineEnding).toBe("CRLF");
    expect(f.content).toBe("a\r\nb");
  });

  it("lists project files honoring .gitignore", async () => {
    const b = make();
    await b.writeFile("/p/dist/out.js", "x");
    expect(await b.listFiles(ROOT)).toEqual([".gitignore", "README.md", "src/a.ts", "src/b.css"]);
  });
});

describe("memory backend: search & replace", () => {
  it("finds matches with options and globs", async () => {
    const b = make();
    const all = await b.search(ROOT, { query: "foo", regex: false, caseSensitive: false, wholeWord: false, include: "", exclude: "" });
    expect(all.totalMatches).toBe(4);
    const css = await b.search(ROOT, { query: "foo", regex: false, caseSensitive: false, wholeWord: false, include: "*.css", exclude: "" });
    expect(css.files.map((f) => f.rel)).toEqual(["src/b.css"]);
    const cs = await b.search(ROOT, { query: "Foo", regex: false, caseSensitive: true, wholeWord: true, include: "", exclude: "" });
    expect(cs.totalMatches).toBe(2);
    expect(cs.files[0].matches[0]).toMatchObject({ line: 1, col: 6, len: 3 });
  });

  it("reports invalid regular expressions", async () => {
    const b = make();
    await expect(b.search(ROOT, { query: "(", regex: true, caseSensitive: false, wholeWord: false, include: "", exclude: "" })).rejects.toThrow(/Invalid/);
  });

  it("replaces literally or with regex groups", async () => {
    const b = make();
    const r = await b.replace(ROOT, { query: "const (\\w+)", regex: true, caseSensitive: true, wholeWord: false, include: "", exclude: "" }, "let $1");
    expect(r).toEqual({ filesChanged: 1, replacements: 1 });
    expect((await b.readFile("/p/src/a.ts")).content.startsWith("let Foo")).toBe(true);
    await b.replace(ROOT, { query: "$", regex: false, caseSensitive: false, wholeWord: false, include: "*.md", exclude: "" }, "x");
  });
});

describe("memory backend: git", () => {
  it("tracks working tree, index and commits", async () => {
    const b = make();
    expect((await b.gitInfo(ROOT)).files).toEqual([]);
    await b.writeFile("/p/src/a.ts", "changed\n");
    await b.writeFile("/p/new.txt", "n");
    let info = await b.gitInfo(ROOT);
    expect(info.files).toEqual([
      { path: "new.txt", status: "?", staged: false, unstaged: true },
      { path: "src/a.ts", status: "M", staged: false, unstaged: true },
    ]);
    await b.gitStage(ROOT, ["src/a.ts", "new.txt"]);
    info = await b.gitInfo(ROOT);
    expect(info.files.find((f) => f.path === "new.txt")).toMatchObject({ status: "A", staged: true });
    await b.gitUnstage(ROOT, ["new.txt"]);
    expect((await b.gitInfo(ROOT)).files.find((f) => f.path === "new.txt")!.status).toBe("?");
    await expect(b.gitCommit(ROOT, "  ")).rejects.toThrow();
    await b.gitCommit(ROOT, "msg");
    expect(await b.gitHeadContent(ROOT, "src/a.ts")).toBe("changed\n");
    await b.writeFile("/p/src/a.ts", "again\n");
    await b.gitDiscard(ROOT, ["src/a.ts"]);
    expect((await b.readFile("/p/src/a.ts")).content).toBe("changed\n");
  });
});

describe("memory backend: demo shell", () => {
  it("runs commands and echoes input", async () => {
    const b = make();
    let out = "";
    b.onData((_, d) => (out += d));
    const id = await b.ptySpawn(ROOT, 80, 24);
    await new Promise((r) => setTimeout(r, 50));
    await b.ptyWrite(id, "ls src\r");
    expect(out).toContain("a.ts");
    await b.ptyWrite(id, "nope\r");
    expect(out).toContain("command not found");
    let exited = false;
    b.onExit(() => (exited = true));
    await b.ptyWrite(id, "exit\r");
    expect(exited).toBe(true);
    await expect(b.ptyWrite(id, "x")).rejects.toThrow();
  });
});
