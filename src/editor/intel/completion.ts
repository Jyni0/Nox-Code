/**
 * Completion source that works for every language: definitions in the file
 * and the project, keywords, builtins and snippets, words from the file —
 * ranked, deduplicated, and quiet inside strings and comments.
 */
import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { collectWords, wordRe, type CodeSymbol, type SymbolKind } from "./symbols";
import { docSymbols, projectSymbols } from "./index";
import { NATIVE_COMPLETION, vocabFor } from "./vocab";

export interface CompletionOptions {
  langId: string;
  path: string | null;
  anyWord: boolean;
  project: boolean;
  snippets: boolean;
}

const TYPE_OF: Record<SymbolKind, string> = {
  function: "function",
  method: "method",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  variable: "variable",
  constant: "constant",
  property: "property",
  namespace: "namespace",
  macro: "function",
};

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function infoFor(s: CodeSymbol & { path?: string }): () => Node {
  return () => {
    const box = document.createElement("div");
    box.className = "nox-cm-info";
    const code = document.createElement("code");
    code.className = "nox-cm-info-sig";
    code.textContent = s.signature;
    box.appendChild(code);
    if (s.doc) {
      const doc = document.createElement("div");
      doc.className = "nox-cm-info-doc";
      doc.textContent = s.doc.length > 600 ? s.doc.slice(0, 600) + "…" : s.doc;
      box.appendChild(doc);
    }
    if (s.path) {
      const loc = document.createElement("div");
      loc.className = "nox-cm-info-loc";
      loc.textContent = `${fileName(s.path)}:${s.line}`;
      box.appendChild(loc);
    }
    return box;
  };
}

/** Inside a string or comment, only words and paths make sense. */
function inStringOrComment(ctx: CompletionContext): "string" | "comment" | null {
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    const name = n.type.name;
    if (/Comment/i.test(name)) return "comment";
    if (/String|Template|Regex|Char(?:acter)?Literal/i.test(name) && !/Interpolation/.test(name)) return "string";
    if (/Interpolation/.test(name)) return null;
  }
  return null;
}

const wordsCache = new WeakMap<object, { re: string; words: string[] }>();

function docWords(ctx: CompletionContext, re: RegExp): string[] {
  const doc = ctx.state.doc;
  const hit = wordsCache.get(doc);
  if (hit && hit.re === re.source) return hit.words;
  const words = collectWords(doc.toString(), re);
  wordsCache.set(doc, { re: re.source, words });
  return words;
}

export function universalCompletion(opts: CompletionOptions) {
  const vocab = vocabFor(opts.langId);
  const native = NATIVE_COMPLETION.has(opts.langId);
  const re = wordRe(opts.langId);
  const snippetOptions: Completion[] = opts.snippets && vocab?.snippets && !native ? vocab.snippets.map((s) => snippetCompletion(s.body, { label: s.label, detail: s.detail, type: "keyword", boost: -2 })) : [];
  const keywordOptions: Completion[] = !native && vocab
    ? [
        ...vocab.keywords.map((k) => ({ label: k, type: "keyword", boost: -1 })),
        ...(vocab.types ?? []).map((t) => ({ label: t, type: "type", boost: -1 })),
        // Rust's builtins are macros: accepting one writes the `!`.
        ...Object.entries(vocab.builtins ?? {}).map(([name, info]) => ({ label: name, type: "function", detail: "builtin", info, boost: -1, apply: opts.langId === "rust" ? name + "!" : undefined })),
      ]
    : [];

  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(new RegExp(`(?:${re.source})$`));
    const where = inStringOrComment(ctx);
    if (!word && !ctx.explicit) return null;
    if (word && word.from === word.to && !ctx.explicit) return null;
    // A lone digit is a number, not the start of a name.
    if (word && /^\d/.test(word.text)) return null;
    const from = word ? word.from : ctx.pos;
    const typed = word?.text ?? "";
    const before = ctx.state.sliceDoc(Math.max(0, from - 2), from);
    const member = /(?:\.|->|::)$/.test(before) || before.endsWith(":") && opts.langId === "lua";

    const seen = new Set<string>([typed]);
    const out: Completion[] = [];
    const add = (c: Completion) => {
      if (seen.has(c.label)) return;
      seen.add(c.label);
      out.push(c);
    };

    if (where !== "comment" && where !== "string") {
      // Definitions in this file (the language package already covers JS/Python locals).
      if (!native) {
        for (const s of docSymbols(ctx.state.doc, opts.langId)) {
          if (member && s.kind !== "method" && s.kind !== "property" && s.kind !== "function") continue;
          add({ label: s.name, type: TYPE_OF[s.kind], detail: s.container ? `${s.kind} · ${s.container}` : s.kind, info: infoFor(s), boost: 2 });
        }
      }
      if (opts.project) {
        for (const s of projectSymbols(opts.langId, opts.path)) {
          if (member && s.kind !== "method" && s.kind !== "property" && s.kind !== "function") continue;
          if (!member && (s.kind === "method" || s.kind === "property") && !native) continue;
          add({ label: s.name, type: TYPE_OF[s.kind], detail: fileName(s.path), info: infoFor(s), boost: 0 });
        }
      }
      if (!member) {
        for (const c of snippetOptions) out.push(c);
        for (const c of keywordOptions) add(c);
      }
    }
    if (opts.anyWord) {
      for (const w of docWords(ctx, re)) {
        if (w === typed) continue;
        add({ label: w, type: "text", boost: -3 });
      }
    }
    if (!out.length) return null;
    return { from, options: out, validFor: new RegExp(`^(?:${re.source})?$`) };
  };
}
