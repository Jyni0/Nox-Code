import { describe, expect, it } from "vitest";
import { extractSymbols } from "@/editor/intel/symbols";
import { effectiveFor, parseEditorConfig } from "@/stores/project";
import { compareVersions } from "@/stores/updates";

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
