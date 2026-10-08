/**
 * Syntax errors for every language, without a language server: grammars
 * with a real parser report the spots their error recovery had to skip or
 * invent; the simpler highlight-only modes get a bracket balance check
 * that ignores strings and comments.
 */
import type { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";

/** Languages whose CodeMirror mode only highlights (no error recovery to read). */
const HIGHLIGHT_ONLY = new Set(["powershell", "toml", "dockerfile", "lua", "ruby", "swift", "kotlin", "csharp", "dart", "scala", "haskell", "r", "perl", "nginx", "cmake"]);
/** Nothing sensible to check: prose, data with its own validator, or grammars that disagree with real-world dialects. */
const SKIP = new Set(["plaintext", "markdown", "json", "diff", "ini", "shell", "sql"]);

const MAX = 100;
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** CSS's parser does not know SCSS / Less; Vue and Svelte templates are not plain HTML. */
function checkable(langId: string, path: string | null): boolean {
  if (SKIP.has(langId)) return false;
  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  if (langId === "css" && path && ext !== "css" && ext !== "pcss") return false;
  if (langId === "html" && (ext === "vue" || ext === "svelte")) return false;
  return true;
}

function describe(state: EditorState, from: number, to: number): string {
  const text = state.sliceDoc(from, Math.min(to, from + 40)).trim();
  if (from >= state.doc.length) return "Unexpected end of file — something is not closed";
  if (!text) {
    // A bracket opened earlier on this line and not closed is the usual culprit.
    const line = state.doc.lineAt(from);
    const open: string[] = [];
    for (const ch of state.sliceDoc(line.from, from)) {
      if (ch in OPEN) open.push(ch);
      else if (ch in CLOSE && open[open.length - 1] === CLOSE[ch]) open.pop();
    }
    return open.length ? `Expected '${OPEN[open[open.length - 1]]}'` : "Syntax error: something is missing here";
  }
  const first = text.split(/\s/)[0];
  return `Unexpected ${first.length === 1 ? `'${first}'` : `'${first.length > 24 ? first.slice(0, 24) + "…" : first}'`}`;
}

function parserErrors(state: EditorState): Diagnostic[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 400) ?? syntaxTree(state);
  const out: Diagnostic[] = [];
  let lastEnd = -1;
  tree.iterate({
    enter(node) {
      if (out.length >= MAX) return false;
      if (!node.type.isError) return;
      let from = node.from;
      let to = node.to;
      // Errors right next to each other are one mistake.
      const prev = out[out.length - 1];
      if (prev && from <= lastEnd + 1 && state.doc.lineAt(from).number === state.doc.lineAt(prev.from).number) {
        prev.to = Math.max(prev.to, to);
        lastEnd = prev.to;
        return false;
      }
      if (from === to) {
        // A missing token: mark the character before it (or the one after at line start).
        const line = state.doc.lineAt(from);
        if (from > line.from) from = Math.max(line.from, from - 1);
        else to = Math.min(line.to, from + 1);
      }
      out.push({ from, to, severity: "error", source: "syntax", message: describe(state, node.from, node.to) });
      lastEnd = to;
      return false;
    },
  });
  return out;
}

/** Positions inside strings, comments and regexes, by the highlighter's token names. */
function quoted(state: EditorState): (pos: number) => boolean {
  const ranges: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    enter(n) {
      if (/string|comment|regexp|char|meta|heredoc/i.test(n.type.name)) {
        ranges.push([n.from, n.to]);
        return false;
      }
    },
  });
  let i = 0;
  return (pos) => {
    while (i < ranges.length && ranges[i][1] <= pos) i++;
    return i < ranges.length && ranges[i][0] <= pos;
  };
}

function bracketErrors(state: EditorState): Diagnostic[] {
  const text = state.doc.toString();
  if (text.length > 400_000) return [];
  const inQuote = quoted(state);
  const stack: Array<{ ch: string; pos: number }> = [];
  const out: Diagnostic[] = [];
  for (let pos = 0; pos < text.length && out.length < MAX; pos++) {
    const ch = text[pos];
    if (!(ch in OPEN) && !(ch in CLOSE)) continue;
    if (inQuote(pos)) continue;
    if (ch in OPEN) stack.push({ ch, pos });
    else {
      const top = stack[stack.length - 1];
      if (top?.ch === CLOSE[ch]) stack.pop();
      else if (top && stack.some((s) => s.ch === CLOSE[ch])) {
        // Something opened in between was never closed.
        out.push({ from: top.pos, to: top.pos + 1, severity: "error", source: "syntax", message: `'${top.ch}' is not closed before '${ch}'` });
        while (stack.length && stack[stack.length - 1].ch !== CLOSE[ch]) stack.pop();
        stack.pop();
      } else out.push({ from: pos, to: pos + 1, severity: "error", source: "syntax", message: `Unmatched '${ch}'` });
    }
  }
  for (const s of stack.slice(0, MAX - out.length)) out.push({ from: s.pos, to: s.pos + 1, severity: "error", source: "syntax", message: `'${s.ch}' is never closed — expected '${OPEN[s.ch]}'` });
  return out.sort((a, b) => a.from - b.from);
}

export function syntaxDiagnostics(state: EditorState, langId: string, path: string | null): Diagnostic[] {
  if (!checkable(langId, path)) return [];
  return HIGHLIGHT_ONLY.has(langId) ? bracketErrors(state) : parserErrors(state);
}
