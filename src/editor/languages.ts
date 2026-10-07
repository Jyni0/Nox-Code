/**
 * Language registry. Each language is lazy-loaded the first time a file of
 * that kind opens, and each one is also a toggleable extension.
 */
import type { Extension } from "@codemirror/state";
import { StreamLanguage, type StreamParser } from "@codemirror/language";

export interface LanguageDef {
  id: string;
  name: string;
  extensions: string[];
  filenames?: string[];
  /** Line comment token, shown in the extension card. */
  comment?: string;
  /** Prettier parser that can format it (needs the Prettier extension). */
  prettier?: string;
  load: () => Promise<Extension>;
}

const legacy = (p: Promise<StreamParser<unknown>>) => p.then((parser) => StreamLanguage.define(parser) as Extension);

export const LANGUAGES: LanguageDef[] = [
  { id: "typescript", name: "TypeScript", extensions: ["ts", "mts", "cts"], comment: "//", prettier: "typescript", load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })) },
  { id: "tsx", name: "TypeScript React", extensions: ["tsx"], comment: "//", prettier: "typescript", load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })) },
  { id: "javascript", name: "JavaScript", extensions: ["js", "mjs", "cjs"], comment: "//", prettier: "babel", load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()) },
  { id: "jsx", name: "JavaScript React", extensions: ["jsx"], comment: "//", prettier: "babel", load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })) },
  { id: "json", name: "JSON", extensions: ["json", "jsonc", "json5", "webmanifest"], filenames: [".prettierrc", ".eslintrc", ".babelrc"], prettier: "json", load: () => import("@codemirror/lang-json").then((m) => m.json()) },
  { id: "html", name: "HTML", extensions: ["html", "htm", "xhtml", "vue", "svelte"], prettier: "html", load: () => import("@codemirror/lang-html").then((m) => m.html()) },
  { id: "css", name: "CSS", extensions: ["css", "scss", "sass", "less", "pcss"], prettier: "css", load: () => import("@codemirror/lang-css").then((m) => m.css()) },
  { id: "markdown", name: "Markdown", extensions: ["md", "mdx", "markdown"], prettier: "markdown", load: () => Promise.all([import("@codemirror/lang-markdown"), import("@codemirror/language-data")]).then(([m, d]) => m.markdown({ codeLanguages: d.languages })) },
  { id: "python", name: "Python", extensions: ["py", "pyi", "pyw"], comment: "#", load: () => import("@codemirror/lang-python").then((m) => m.python()) },
  { id: "rust", name: "Rust", extensions: ["rs"], comment: "//", load: () => import("@codemirror/lang-rust").then((m) => m.rust()) },
  { id: "go", name: "Go", extensions: ["go"], comment: "//", load: () => import("@codemirror/lang-go").then((m) => m.go()) },
  { id: "cpp", name: "C / C++", extensions: ["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "ino"], comment: "//", load: () => import("@codemirror/lang-cpp").then((m) => m.cpp()) },
  { id: "java", name: "Java", extensions: ["java"], comment: "//", load: () => import("@codemirror/lang-java").then((m) => m.java()) },
  { id: "php", name: "PHP", extensions: ["php", "phtml"], comment: "//", load: () => import("@codemirror/lang-php").then((m) => m.php()) },
  { id: "sql", name: "SQL", extensions: ["sql"], comment: "--", load: () => import("@codemirror/lang-sql").then((m) => m.sql()) },
  { id: "xml", name: "XML", extensions: ["xml", "svg", "xaml", "csproj", "plist", "xsd", "xsl"], load: () => import("@codemirror/lang-xml").then((m) => m.xml()) },
  { id: "yaml", name: "YAML", extensions: ["yml", "yaml"], comment: "#", prettier: "yaml", load: () => import("@codemirror/lang-yaml").then((m) => m.yaml()) },
  { id: "shell", name: "Shell", extensions: ["sh", "bash", "zsh", "fish", "ksh"], filenames: [".bashrc", ".zshrc", ".profile"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell)) },
  { id: "powershell", name: "PowerShell", extensions: ["ps1", "psm1", "psd1"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell)) },
  { id: "toml", name: "TOML", extensions: ["toml"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)) },
  { id: "dockerfile", name: "Dockerfile", extensions: ["dockerfile"], filenames: ["dockerfile", "containerfile"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/dockerfile").then((m) => m.dockerFile)) },
  { id: "lua", name: "Lua", extensions: ["lua"], comment: "--", load: () => legacy(import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)) },
  { id: "ruby", name: "Ruby", extensions: ["rb", "rake", "gemspec"], filenames: ["gemfile", "rakefile"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)) },
  { id: "swift", name: "Swift", extensions: ["swift"], comment: "//", load: () => legacy(import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)) },
  { id: "kotlin", name: "Kotlin", extensions: ["kt", "kts"], comment: "//", load: () => legacy(import("@codemirror/legacy-modes/mode/clike").then((m) => m.kotlin)) },
  { id: "csharp", name: "C#", extensions: ["cs", "csx"], comment: "//", load: () => legacy(import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp)) },
  { id: "dart", name: "Dart", extensions: ["dart"], comment: "//", load: () => legacy(import("@codemirror/legacy-modes/mode/clike").then((m) => m.dart)) },
  { id: "scala", name: "Scala", extensions: ["scala", "sc"], comment: "//", load: () => legacy(import("@codemirror/legacy-modes/mode/clike").then((m) => m.scala)) },
  { id: "haskell", name: "Haskell", extensions: ["hs"], comment: "--", load: () => legacy(import("@codemirror/legacy-modes/mode/haskell").then((m) => m.haskell)) },
  { id: "r", name: "R", extensions: ["r"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/r").then((m) => m.r)) },
  { id: "perl", name: "Perl", extensions: ["pl", "pm"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl)) },
  { id: "ini", name: "INI / Properties", extensions: ["ini", "cfg", "conf", "properties", "env", "editorconfig", "gitconfig"], filenames: [".env", ".gitattributes", ".npmrc"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/properties").then((m) => m.properties)) },
  { id: "diff", name: "Diff", extensions: ["diff", "patch"], load: () => legacy(import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff)) },
  { id: "nginx", name: "Nginx", extensions: ["nginx"], filenames: ["nginx.conf"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/nginx").then((m) => m.nginx)) },
  { id: "cmake", name: "CMake", extensions: ["cmake"], filenames: ["cmakelists.txt"], comment: "#", load: () => legacy(import("@codemirror/legacy-modes/mode/cmake").then((m) => m.cmake)) },
];

export const PLAIN_TEXT: Pick<LanguageDef, "id" | "name"> = { id: "plaintext", name: "Plain Text" };

export function detectLanguage(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const l of LANGUAGES) if (l.filenames?.includes(lower)) return l.id;
  if (lower.startsWith(".env")) return "ini";
  if (lower.startsWith("dockerfile")) return "dockerfile";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  for (const l of LANGUAGES) if (l.extensions.includes(ext)) return l.id;
  return PLAIN_TEXT.id;
}

export function languageName(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.name ?? PLAIN_TEXT.name;
}

export const languageById = (id: string) => LANGUAGES.find((l) => l.id === id);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"]);
export const isImageFile = (name: string) => IMAGE_EXT.has(name.toLowerCase().split(".").pop() ?? "");
