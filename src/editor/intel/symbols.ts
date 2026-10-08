/**
 * Language-agnostic symbol extraction. No language server: each language
 * family has a handful of definition patterns, which is enough for
 * completions, hover cards and Ctrl+click across most code people write.
 */

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "variable" | "constant" | "property" | "namespace" | "macro";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line, 0-based column of the name. */
  line: number;
  col: number;
  /** The definition as written (one logical line, trimmed). */
  signature: string;
  /** Doc comment / docstring above (or below, for Python) the definition. */
  doc?: string;
  /** Enclosing class / impl / object, when known. */
  container?: string;
}

interface Pattern {
  re: RegExp;
  kind: SymbolKind;
  /** Capture group holding the name (default 1). */
  group?: number;
  /** Only at the start of the line (no indentation). */
  topLevel?: boolean;
}

/** Which grammar of patterns a language uses. */
export function familyOf(langId: string): string {
  switch (langId) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
    case "html":
      return "js";
    case "cpp":
    case "java":
    case "csharp":
    case "dart":
      return "clike";
    default:
      return langId;
  }
}

/** Identifier characters per family (CSS and PowerShell allow dashes). */
export function wordRe(langId: string): RegExp {
  switch (familyOf(langId)) {
    case "css":
      return /[\w$-]+/;
    case "powershell":
      return /[\w-]+/;
    case "ruby":
      return /[\w]+[?!]?/;
    case "php":
    case "js":
      return /[\w$]+/;
    default:
      return /\w+/;
  }
}

const ID = "([A-Za-z_$][\\w$]*)";
const MODS_JS = "(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?";

const PATTERNS: Record<string, Pattern[]> = {
  js: [
    { re: new RegExp(`^\\s*${MODS_JS}function\\s*\\*?\\s*${ID}`), kind: "function" },
    { re: new RegExp(`^\\s*${MODS_JS}class\\s+${ID}`), kind: "class" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?interface\\s+${ID}`), kind: "interface" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+${ID}\\s*(?:<[^=]*>)?\\s*=`), kind: "type" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+${ID}`), kind: "enum" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:namespace|module)\\s+${ID}`), kind: "namespace" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${ID}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=]+)?=>`), kind: "function" },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${ID}\\s*(?::[^=]+)?=\\s*(?:async\\s+)?function`), kind: "function" },
    { re: new RegExp(`^(?:export\\s+)?(?:declare\\s+)?const\\s+${ID}`), kind: "constant", topLevel: true },
    { re: new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${ID}`), kind: "variable" },
    // Class members: `name(…) {`, `async name(…)`, `get name()`, `private name: T`.
    {
      re: new RegExp(`^\\s+(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set|declare)\\s+)*\\*?${ID}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::\\s*[^={;]+)?\\s*\\{?\\s*$`),
      kind: "method",
    },
    { re: new RegExp(`^\\s+(?:(?:public|private|protected|static|readonly|override|declare)\\s+)+${ID}\\s*[?!]?\\s*[:=]`), kind: "property" },
  ],
  python: [
    { re: /^\s*(?:async\s+)?def\s+(\w+)/, kind: "function" },
    { re: /^\s*class\s+(\w+)/, kind: "class" },
    { re: /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=(?!=)/, kind: "constant", topLevel: true },
    { re: /^(\w+)\s*(?::[^=]+)?=(?!=)/, kind: "variable", topLevel: true },
    { re: /^\s+self\.(\w+)\s*(?::[^=]+)?=(?!=)/, kind: "property" },
  ],
  rust: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/, kind: "function" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?union\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)/, kind: "enum" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)/, kind: "type" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/, kind: "namespace" },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?(\w+)/, kind: "constant" },
    { re: /^\s*macro_rules!\s*(\w+)/, kind: "macro" },
    { re: /^\s*let\s+(?:mut\s+)?(\w+)/, kind: "variable" },
  ],
  go: [
    { re: /^func\s+\([^)]*\)\s*(\w+)/, kind: "method" },
    { re: /^func\s+(\w+)/, kind: "function" },
    { re: /^\s*type\s+(\w+)\s+interface/, kind: "interface" },
    { re: /^\s*type\s+(\w+)\s+struct/, kind: "class" },
    { re: /^\s*type\s+(\w+)/, kind: "type" },
    { re: /^\s*const\s+(\w+)/, kind: "constant" },
    { re: /^\s*var\s+(\w+)/, kind: "variable" },
    { re: /^\s*(\w+)\s*(?:,\s*\w+\s*)*:=/, kind: "variable" },
  ],
  clike: [
    { re: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|export|template\s*<[^>]*>)\s+)*(?:class|struct|record)\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|export)\s+)*(?:interface|concept)\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:(?:public|private|protected|internal|static|export)\s+)*enum\s+(?:class\s+)?(\w+)/, kind: "enum" },
    { re: /^\s*namespace\s+([\w:.]+)/, kind: "namespace" },
    { re: /^\s*#\s*define\s+(\w+)/, kind: "macro" },
    { re: /^\s*typedef\s+.*?(\w+)\s*;/, kind: "type" },
    { re: /^\s*using\s+(\w+)\s*=/, kind: "type" },
    // `ReturnType name(…)` not followed by `;` (that would be a declaration or a call).
    {
      re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|final|abstract|async|inline|constexpr|extern|explicit|unsafe|synchronized|native|const|friend|operator)\s+)*(?:[\w:<>,.[\]*&?]+\s+)+[*&]*(\w+)\s*\([^;]*$/,
      kind: "function",
    },
    { re: /^\s*(?:(?:public|private|protected|internal|static|final|readonly|const|constexpr)\s+)+(?:[\w:<>,.[\]*&?]+\s+)+(\w+)\s*(?:=|;)/, kind: "property" },
  ],
  kotlin: [
    { re: /^\s*(?:[a-z]+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)/, kind: "function" },
    { re: /^\s*(?:[a-z]+\s+)*(?:class|object)\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:[a-z]+\s+)*interface\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:[a-z]+\s+)*typealias\s+(\w+)/, kind: "type" },
    { re: /^\s*(?:[a-z]+\s+)*(?:val|var)\s+(\w+)/, kind: "variable" },
  ],
  swift: [
    { re: /^\s*(?:[a-z@]+\s+)*func\s+(\w+)/, kind: "function" },
    { re: /^\s*(?:[a-z@]+\s+)*(?:class|struct|actor|extension)\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:[a-z@]+\s+)*protocol\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:[a-z@]+\s+)*enum\s+(\w+)/, kind: "enum" },
    { re: /^\s*(?:[a-z@]+\s+)*typealias\s+(\w+)/, kind: "type" },
    { re: /^\s*(?:[a-z@]+\s+)*(?:let|var)\s+(\w+)/, kind: "variable" },
  ],
  scala: [
    { re: /^\s*(?:[a-z]+\s+)*def\s+(\w+)/, kind: "function" },
    { re: /^\s*(?:[a-z]+\s+)*(?:class|object)\s+(\w+)/, kind: "class" },
    { re: /^\s*(?:[a-z]+\s+)*trait\s+(\w+)/, kind: "interface" },
    { re: /^\s*(?:[a-z]+\s+)*type\s+(\w+)/, kind: "type" },
    { re: /^\s*(?:[a-z]+\s+)*(?:val|var)\s+(\w+)/, kind: "variable" },
  ],
  php: [
    { re: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?(\w+)/, kind: "function" },
    { re: /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|trait)\s+(\w+)/, kind: "class" },
    { re: /^\s*interface\s+(\w+)/, kind: "interface" },
    { re: /^\s*enum\s+(\w+)/, kind: "enum" },
    { re: /^\s*(?:const\s+(\w+)|define\(\s*['"](\w+)['"])/, kind: "constant" },
    { re: /^\s*(?:(?:public|private|protected|static|readonly)\s+)+(?:\??[\w\\]+\s+)?\$(\w+)/, kind: "property" },
    { re: /^\s*\$(\w+)\s*=(?!=)/, kind: "variable" },
  ],
  ruby: [
    { re: /^\s*def\s+(?:self\.)?(\w+[?!=]?)/, kind: "function" },
    { re: /^\s*class\s+([\w:]+)/, kind: "class" },
    { re: /^\s*module\s+([\w:]+)/, kind: "namespace" },
    { re: /^\s*([A-Z][A-Z0-9_]*)\s*=(?!=)/, kind: "constant" },
    { re: /^\s*attr_(?:reader|writer|accessor)\s+:(\w+)/, kind: "property" },
  ],
  lua: [
    { re: /^\s*(?:local\s+)?function\s+(?:[\w.]+[.:])?(\w+)/, kind: "function" },
    { re: /^\s*(?:local\s+)?(\w+)\s*=\s*function/, kind: "function" },
    { re: /^\s*local\s+(\w+)/, kind: "variable" },
  ],
  shell: [
    { re: /^\s*(?:function\s+)?([\w-]+)\s*\(\)\s*\{?/, kind: "function" },
    { re: /^\s*function\s+([\w-]+)/, kind: "function" },
    { re: /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)?)?(\w+)=/, kind: "variable" },
  ],
  powershell: [
    { re: /^\s*function\s+([\w-]+)/i, kind: "function" },
    { re: /^\s*class\s+(\w+)/i, kind: "class" },
    { re: /^\s*enum\s+(\w+)/i, kind: "enum" },
    { re: /^\s*\$(?:script:|global:)?(\w+)\s*=(?!=)/i, kind: "variable" },
  ],
  perl: [
    { re: /^\s*sub\s+(\w+)/, kind: "function" },
    { re: /^\s*package\s+([\w:]+)/, kind: "namespace" },
    { re: /^\s*(?:my|our)\s+[$@%](\w+)/, kind: "variable" },
  ],
  r: [
    { re: /^\s*([\w.]+)\s*(?:<-|=)\s*function/, kind: "function" },
    { re: /^\s*([\w.]+)\s*<-/, kind: "variable" },
  ],
  haskell: [
    { re: /^(\w+)\s*::/, kind: "function", topLevel: true },
    { re: /^data\s+(\w+)/, kind: "class", topLevel: true },
    { re: /^newtype\s+(\w+)/, kind: "type", topLevel: true },
    { re: /^type\s+(\w+)/, kind: "type", topLevel: true },
    { re: /^class\s+(?:\([^)]*\)\s*=>\s*)?(\w+)/, kind: "interface", topLevel: true },
  ],
  sql: [
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)/i, kind: "class" },
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+[`"[]?([\w.]+)/i, kind: "class" },
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+[`"[]?([\w.]+)/i, kind: "function" },
    { re: /^\s*create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?[`"[]?(\w+)/i, kind: "property" },
  ],
  css: [
    { re: /^\s*(--[\w-]+)\s*:/, kind: "variable" },
    { re: /^\s*\$([\w-]+)\s*:/, kind: "variable" },
    { re: /^\s*@([\w-]+)\s*:/, kind: "variable" },
    { re: /^\s*@mixin\s+([\w-]+)/, kind: "function" },
    { re: /^\s*@function\s+([\w-]+)/, kind: "function" },
    { re: /^\s*@keyframes\s+([\w-]+)/, kind: "constant" },
    { re: /^\s*\.([\w-]+)[^;]*\{\s*$/, kind: "class" },
  ],
  toml: [{ re: /^\s*\[+\s*([\w.-]+)\s*\]+/, kind: "namespace" }, { re: /^\s*([\w-]+)\s*=/, kind: "property" }],
  ini: [{ re: /^\s*\[([^\]]+)\]/, kind: "namespace" }, { re: /^\s*([\w.-]+)\s*[=:]/, kind: "property" }],
  yaml: [{ re: /^([\w.-]+)\s*:/, kind: "property", topLevel: true }],
  makefile: [{ re: /^([\w.-]+)\s*:(?!=)/, kind: "function", topLevel: true }],
  cmake: [{ re: /^\s*(?:function|macro)\s*\(\s*(\w+)/i, kind: "function" }, { re: /^\s*set\s*\(\s*(\w+)/i, kind: "variable" }],
  dockerfile: [{ re: /^\s*(?:ARG|ENV)\s+(\w+)/i, kind: "variable" }, { re: /^\s*FROM\s+\S+\s+AS\s+(\w+)/i, kind: "namespace" }],
  markdown: [{ re: /^#{1,6}\s+(.+?)\s*#*\s*$/, kind: "namespace" }],
};

const NOT_NAMES = new Set(["if", "for", "while", "switch", "catch", "return", "else", "do", "try", "new", "throw", "await", "typeof", "sizeof", "delete", "case", "function", "constructor", "super", "import", "export", "elif", "with", "using", "lock", "foreach", "fixed", "when"]);

/** Line comment prefixes stripped from doc comments. */
const DOC_PREFIX = /^\s*(?:\/\/\/?!?|#'?|--|;+|\*(?!\/)|\/\*\*?|%)\s?/;

function docAbove(lines: string[], idx: number): string | undefined {
  const out: string[] = [];
  let i = idx - 1;
  // Skip decorators / attributes / annotations between the doc and the definition.
  while (i >= 0 && /^\s*(?:@\w|#\[|\[\w)/.test(lines[i])) i--;
  if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
    // Block comment: walk up to its start.
    let j = i;
    while (j >= 0 && !/\/\*/.test(lines[j])) j--;
    if (j < 0 || i - j > 60) return undefined;
    for (let k = j; k <= i; k++) out.push(lines[k].replace(/\*\/\s*$/, "").replace(DOC_PREFIX, ""));
  } else {
    while (i >= 0 && out.length < 40) {
      const l = lines[i];
      if (/^\s*(?:\/\/|#(?![!\[{])|--(?!-)|;)/.test(l) && !/^\s*#\s*(?:include|define|if|endif|pragma|region|endregion)\b/.test(l)) {
        out.unshift(l.replace(DOC_PREFIX, ""));
        i--;
      } else break;
    }
  }
  const text = out.join("\n").trim();
  return text ? text : undefined;
}

/** Python / Elixir style: a string right after the definition. */
function docBelow(lines: string[], idx: number): string | undefined {
  let i = idx + 1;
  // Multi-line signatures: find the line that ends with ":".
  while (i < lines.length && i - idx < 8 && !/:\s*(?:#.*)?$/.test(lines[i - 1])) i++;
  const first = lines[i]?.trim();
  if (!first) return undefined;
  const q = first.startsWith('"""') ? '"""' : first.startsWith("'''") ? "'''" : null;
  if (!q) return undefined;
  const rest = first.slice(3);
  if (rest.includes(q)) return rest.slice(0, rest.indexOf(q)).trim() || undefined;
  const out = [rest];
  for (let k = i + 1; k < lines.length && k - i < 60; k++) {
    const l = lines[k];
    if (l.includes(q)) {
      out.push(l.slice(0, l.indexOf(q)));
      break;
    }
    out.push(l);
  }
  const minIndent = Math.min(...out.slice(1).filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length), 99);
  return out.map((l, n) => (n ? l.slice(minIndent) : l)).join("\n").trim() || undefined;
}

/** The definition line, continued while brackets stay open (multi-line params). */
function signatureAt(lines: string[], idx: number): string {
  let sig = lines[idx].trim();
  let depth = 0;
  const count = (s: string) => {
    for (const ch of s) {
      if (ch === "(" || ch === "[" || ch === "<") depth++;
      else if (ch === ")" || ch === "]" || ch === ">") depth = Math.max(0, depth - 1);
    }
  };
  count(sig);
  for (let k = idx + 1; depth > 0 && k < lines.length && k - idx < 12; k++) {
    const l = lines[k].trim();
    sig += (sig.endsWith("(") || sig.endsWith(",") ? " " : " ") + l;
    count(l);
  }
  sig = sig
    .replace(/\s*\{\s*$/, "")
    .replace(/\s*\{\s*\}?\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*\)/g, ")");
  // Long bodies on one line (`const f = () => …`): keep the head.
  const arrow = sig.indexOf("=>");
  if (arrow > 0 && sig.length > arrow + 2) sig = sig.slice(0, arrow + 2) + " …";
  return sig.length > 300 ? sig.slice(0, 297) + "…" : sig;
}

const MAX_LINES = 60_000;

/** Every definition in `text`. Cheap enough to run on each keystroke pause. */
export function extractSymbols(text: string, langId: string): CodeSymbol[] {
  const pats = PATTERNS[familyOf(langId)] ?? PATTERNS[langId];
  if (!pats) return [];
  const lines = text.split(/\r?\n/, MAX_LINES);
  const out: CodeSymbol[] = [];
  const pyLike = langId === "python";
  // Track the enclosing class by indentation (Python) or braces (others).
  const containers: Array<{ name: string; indent: number; depth: number }> = [];
  let depth = 0;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    const trimmed = line.trimStart();
    // Skip comment-only lines (and the inside of block comments).
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (/^(?:\/\/|\*|#(?!\s*define)(?![\[!])|--)/.test(trimmed) && familyOf(langId) !== "markdown" && familyOf(langId) !== "css") continue;
    const indent = line.length - trimmed.length;
    while (containers.length) {
      const top = containers[containers.length - 1];
      if (pyLike ? trimmed && indent <= top.indent : depth < top.depth) containers.pop();
      else break;
    }
    for (const p of pats) {
      if (p.topLevel && indent > 0) continue;
      const m = p.re.exec(line);
      if (!m) continue;
      const name = m[p.group ?? 1] ?? m[2];
      if (!name) continue;
      // Members and C-style functions only count directly in a type / file body:
      // deeper down, the same shapes are calls and local statements.
      const fam = familyOf(langId);
      if ((fam === "js" || fam === "clike") && NOT_NAMES.has(name)) continue;
      const memberish = p.kind === "method" || p.kind === "property" || (fam === "clike" && p.kind === "function");
      if (memberish && (fam === "js" || fam === "clike")) {
        if (fam === "js" && !containers.length) continue;
        if (depth !== (containers[containers.length - 1]?.depth ?? 0)) continue;
        if (/^\s*(?:return|else|new|throw|case|await|delete|goto|yield|co_return|co_await)\b/.test(line)) continue;
      }
      const col = line.indexOf(name, m.index + (m[0].indexOf(name) >= 0 ? m[0].indexOf(name) : 0));
      const container = containers[containers.length - 1]?.name;
      let kind = p.kind;
      if (kind === "function" && container && familyOf(langId) !== "go") kind = "method";
      out.push({
        name,
        kind,
        line: i + 1,
        col: Math.max(0, col),
        signature: signatureAt(lines, i),
        doc: (pyLike ? docBelow(lines, i) : undefined) ?? docAbove(lines, i),
        container,
      });
      if (kind === "class" || kind === "interface" || kind === "enum" || kind === "namespace") {
        containers.push({ name, indent, depth: depth + 1 });
      }
      break;
    }
    if (!pyLike) {
      // Brace depth outside strings is close enough for nesting.
      for (const ch of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
        if (ch === "{") depth++;
        else if (ch === "}") depth = Math.max(0, depth - 1);
      }
    }
  }
  return out;
}

/** Words in a text for "any word" completions, most frequent first. */
export function collectWords(text: string, re: RegExp, limit = 4000): string[] {
  const counts = new Map<string, number>();
  const g = new RegExp(re.source, "g");
  const slice = text.length > 1_000_000 ? text.slice(0, 1_000_000) : text;
  for (const m of slice.matchAll(g)) {
    const w = m[0];
    if (w.length < 3 || /^\d/.test(w) || /^-+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (counts.size > limit * 2) break;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
