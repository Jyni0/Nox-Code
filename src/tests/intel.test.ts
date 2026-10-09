import { describe, expect, it } from "vitest";
import { extractSymbols } from "@/editor/intel/symbols";
import { effectiveFor, parseEditorConfig } from "@/stores/project";
import { compareVersions } from "@/stores/updates";
import { EditorState } from "@codemirror/state";
import { findLinks } from "@/terminal/links";
import { syntaxDiagnostics } from "@/editor/intel/syntaxErrors";
import { languageById } from "@/editor/languages";
import { parseGeneric, parseMsbuild, parseTsc } from "@/editor/intel/problems";
import { DEFAULT_TAGS, matchTag, parseTags, taggedRanges } from "@/extensions/betterComments";
import { ensureSyntaxTree } from "@codemirror/language";

const names = (text: string, lang: string) => extractSymbols(text, lang).map((s) => `${s.kind}:${s.name}`);

describe("symbol extraction", () => {
  it("finds TypeScript definitions with docs and members", () => {
    const src = [
      "/** Adds two numbers. */",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "export const PI = 3.14;",
      "const double = (x: number) => x * 2;",
      "export interface Shape { area(): number }",
      "type Id = string;",
      "class Circle {",
      "  private radius = 1;",
      "  area(): number {",
      "    doSomething(1)",
      "    return 1;",
      "  }",
      "}",
    ].join("\n");
    const syms = extractSymbols(src, "typescript");
    expect(names(src, "typescript")).toEqual(["function:add", "constant:PI", "function:double", "interface:Shape", "type:Id", "class:Circle", "property:radius", "method:area"]);
    expect(syms[0].doc).toBe("Adds two numbers.");
    expect(syms[0].signature).toBe("export function add(a: number, b: number): number");
    expect(syms.find((s) => s.name === "area")?.container).toBe("Circle");
  });

  it("handles Python, Rust, Go and C++", () => {
    expect(names('class A:\n    def run(self):\n        """Runs it."""\n        pass\n\ndef main():\n    pass\nMAX = 3', "python")).toEqual(["class:A", "method:run", "function:main", "constant:MAX"]);
    expect(extractSymbols('def f():\n    """Doc here."""', "python")[0].doc).toBe("Doc here.");
    expect(names("/// Point\npub struct Point { x: i32 }\nimpl Point {\n    pub fn new() -> Self { todo!() }\n}\nfn main() {}", "rust")).toEqual(["class:Point", "function:new", "function:main"]);
    expect(names("type Server struct {}\nfunc (s *Server) Start() error {\n}\nfunc main() {\n\tx := 1\n}", "go")).toEqual(["class:Server", "method:Start", "function:main", "variable:x"]);
    expect(names("#define MAX 10\nint add(int a, int b) {\n  return foo(a);\n}\nclass Foo {\npublic:\n  void bar(int x);\n};", "cpp")).toEqual(["macro:MAX", "function:add", "class:Foo"]);
  });

  it("handles scripting languages", () => {
    expect(names("local function greet(name)\nend\nfunction M.run()\nend", "lua")).toEqual(["function:greet", "function:run"]);
    expect(names("deploy() {\n  echo hi\n}\nNAME=x", "shell")).toEqual(["function:deploy", "variable:NAME"]);
    expect(names("function Get-Thing {\n}\n$count = 1", "powershell")).toEqual(["function:Get-Thing", "variable:count"]);
    expect(names("class User\n  def name?\n  end\nend", "ruby")).toEqual(["class:User", "function:name?"]);
  });
});

describe("project settings", () => {
  const user = { tabSize: 2, insertSpaces: true, wordWrap: false, trimTrailingWhitespace: false, insertFinalNewline: true };

  it("parses .editorconfig and applies matching sections", () => {
    const ec = parseEditorConfig("root = true\n[*]\nindent_style = space\nindent_size = 4\n[*.go]\nindent_style = tab\n[Makefile]\nindent_style = tab\n");
    const project = { root: "/p", settings: {}, editorConfig: ec };
    expect(effectiveFor("/p/a.ts", "typescript", user, project)).toMatchObject({ tabSize: 4, insertSpaces: true });
    expect(effectiveFor("/p/cmd/main.go", "go", user, project)).toMatchObject({ insertSpaces: false });
  });

  it("layers project and language overrides over the user settings", () => {
    const project = { root: "/p", settings: { tabSize: 8, trimTrailingWhitespace: true, languages: { python: { tabSize: 4, insertSpaces: true } } }, editorConfig: [] };
    expect(effectiveFor("/p/a.ts", "typescript", user, project)).toMatchObject({ tabSize: 8, trimTrailingWhitespace: true });
    expect(effectiveFor("/p/a.py", "python", user, project)).toMatchObject({ tabSize: 4 });
    expect(effectiveFor("/p/a.ts", "typescript", user, { root: null, settings: { tabSize: 8 }, editorConfig: [] }).tabSize).toBe(2);
  });
});

describe("updates", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.3")).toBe(1);
    expect(compareVersions("1.1.1", "1.1.1")).toBe(0);
    expect(compareVersions("v1.2", "1.2.1")).toBe(-1);
  });
});

describe("terminal links", () => {
  const strip = (text: string) => findLinks(text).map((l) => `${text.slice(l.start, l.end)}|${l.path ?? l.url}|${l.line ?? ""}|${l.col ?? ""}`);
  it("finds paths with positions in compiler and runtime output", () => {
    expect(strip("  --> src/main.rs:3:5")).toEqual(["src/main.rs:3:5|src/main.rs|3|5"]);
    expect(strip("src/app.ts(12,7): error TS2304")).toEqual(["src/app.ts(12,7)|src/app.ts|12|7"]);
    expect(strip('  File "C:\\proj\\run.py", line 14, in <module>')).toEqual(["C:\\proj\\run.py|C:\\proj\\run.py|14|"]);
    expect(strip("./cmd/main.go:8: undefined")).toEqual(["./cmd/main.go:8|./cmd/main.go|8|"]);
    expect(strip("see https://example.com/docs.html.")).toEqual(["https://example.com/docs.html|https://example.com/docs.html||"]);
  });
});

describe("syntax errors", () => {
  const check = async (text: string, langId: string, path: string) => {
    const lang = await languageById(langId)!.load();
    const state = EditorState.create({ doc: text, extensions: [lang] });
    return syntaxDiagnostics(state, langId, path).map((d) => d.message);
  };
  it("reports parser errors and stays quiet on valid code", async () => {
    expect(await check("const a = 1;\nfunction f(x) { return x * 2 }\n", "typescript", "a.ts")).toEqual([]);
    expect((await check("function f( {\n  return 1\n}\n", "typescript", "a.ts")).length).toBeGreaterThan(0);
    expect(await check("def f(x):\n    return x\n", "python", "a.py")).toEqual([]);
    expect((await check("def f(x:\n    return x\n", "python", "a.py")).length).toBeGreaterThan(0);
  });
  it("checks brackets in highlight-only languages", async () => {
    expect(await check('local t = { a = "(" }\n-- )\n', "lua", "a.lua")).toEqual([]);
    expect(await check("local t = { a = f(1 }\n", "lua", "a.lua")).toEqual(["'(' is not closed before '}'"]);
    expect(await check("print(1))\n", "lua", "a.lua")).toEqual(["Unmatched ')'"]);
  });
});

describe("problem parsers", () => {
  it("reads tsc output", () => {
    const out = "src/a.ts(12,5): error TS2304: Cannot find name 'x'.\nsrc/b.tsx(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\n  Long continuation.\n";
    const p = parseTsc(out, "/p");
    expect(p.map((x) => [x.path, x.line, x.col, x.severity])).toEqual([["/p/src/a.ts", 12, 5, "error"], ["/p/src/b.tsx", 3, 1, "error"]]);
    expect(p[1].message).toContain("Long continuation.");
  });
  it("reads dotnet build output once", () => {
    const line = String.raw`C:\p\Program.cs(5,10): error CS1002: ; expected [C:\p\app.csproj]`;
    const out = [line, String.raw`C:\sdk\Microsoft.Common.targets(5034,5): error MSB3027: Could not copy [C:\p\app.csproj]`, "Build FAILED.", line].join("\n");
    expect(parseMsbuild(out, String.raw`C:\p`).map((x) => `${x.path}:${x.line}:${x.col}:${x.message}`)).toEqual([String.raw`C:\p\Program.cs:5:10:; expected (CS1002)`]);
  });
  it("reads cargo, go, ruff and pyflakes output", () => {
    const out = [
      "src/main.rs:3:5: error[E0308]: mismatched types",
      "src\lib.rs:10:9: warning: unused variable: `x`",
      "warning: `app` (bin \"app\") generated 1 warning",
      "./main.go:8:2: undefined: foo",
      "app/x.py:1:8: F401 [*] `os` imported but unused",
      "./y.py:4: undefined name 'bar'",
    ].join("\n");
    expect(parseGeneric(out, "/p", "t").map((x) => `${x.path}:${x.line}:${x.col}:${x.severity}:${x.message}`)).toEqual([
      "/p/src/main.rs:3:5:error:mismatched types [E0308]",
      "/p/src\lib.rs:10:9:warning:unused variable: `x`",
      "/p/main.go:8:2:error:undefined: foo",
      "/p/app/x.py:1:8:error:F401 [*] `os` imported but unused",
      "/p/y.py:4:0:error:undefined name 'bar'",
    ]);
  });
});

describe("better comments", () => {
  const tags = parseTags(DEFAULT_TAGS);
  const tagOf = (line: string) => matchTag(line, tags)?.tag.tag ?? null;
  it("finds the tag after any comment opener", () => {
    expect(tagOf("// ! alert")).toBe("!");
    expect(tagOf("# ? question")).toBe("?");
    expect(tagOf("-- todo: later")).toBe("TODO");
    expect(tagOf(" * * highlighted")).toBe("*");
    expect(tagOf("//// old()")).toBe("//");
    expect(tagOf("// plain")).toBe(null);
    expect(tagOf(" * @param x")).toBe(null);
    expect(tagOf("// todos are not a tag")).toBe(null);
    expect(tagOf("/// TODO: xml doc")).toBe("TODO");
    expect(tagOf("//! alert")).toBe("!");
    expect(tagOf("<# ? ps block #>")).toBe("?");
    expect(tagOf("--[[ ! lua block ]]")).toBe("!");
    expect(tagOf("{- * haskell -}")).toBe("*");
  });

  // The coloured text of each comment, in every language.
  const colored = async (langId: string, doc: string) => {
    const lang = await languageById(langId)!.load();
    const state = EditorState.create({ doc, extensions: [lang] });
    ensureSyntaxTree(state, doc.length, 5000);
    return taggedRanges(state, [{ from: 0, to: doc.length }], tags).map(([f, t, tag]) => `${tag.tag}:${doc.slice(f, t)}`);
  };
  it("colours comments in every language", async () => {
    const slash = "x = 1; // ! alert\n/* ? q */\n/// TODO doc\n//// old();\n";
    const slashWant = ["!:! alert", "?:? q", "TODO:TODO doc", "//:// old();"];
    for (const id of ["typescript", "javascript", "rust", "go", "cpp", "java", "csharp", "kotlin", "swift", "dart", "scala"]) expect(await colored(id, slash), id).toEqual(slashWant);
    expect(await colored("php", "<?php\n// ! a\n# ? b\n")).toEqual(["!:! a", "?:? b"]);
    for (const id of ["python", "yaml", "shell", "toml", "ruby", "r", "perl", "nginx", "cmake"]) expect(await colored(id, 'x = "#1" # ! alert\n# TODO: later\n'), id).toEqual(["!:! alert", "TODO:TODO: later"]);
    expect(await colored("dockerfile", "FROM node\n# ! pin the version\n")).toEqual(["!:! pin the version"]);
    expect(await colored("ini", "[core]\n# ! a\n; ? b\nk = v\n")).toEqual(["!:! a", "?:? b"]);
    expect(await colored("powershell", "# ! a\n<# ? b #>\n")).toEqual(["!:! a", "?:? b"]);
    for (const id of ["sql", "lua", "haskell"]) expect(await colored(id, "x = 1 -- ! alert\n"), id).toEqual(["!:! alert"]);
    expect(await colored("lua", "--[[ ? block ]]\n")).toEqual(["?:? block"]);
    for (const id of ["html", "xml", "markdown"]) expect(await colored(id, "<!-- ! alert -->\n"), id).toEqual(["!:! alert"]);
    expect(await colored("css", "a { color: red; } /* * note */\n")).toEqual(["*:* note"]);
    expect(await colored("json", '{ "url": "http://x" // TODO later\n}\n')).toEqual(["TODO:TODO later"]);
  });
});
