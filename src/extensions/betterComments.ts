/**
 * Better Comments: comments coloured by the tag they start with —
 *   // ! alert   // ? question   // TODO: task   // * highlight   //// commented-out code
 * Works in every language with comments, whatever they look like: // # -- ; %
 * /* *\/  <!-- -->  <# #>  --[[ ]]  {- -}  (* *)  /// doc comments and
 * block-comment continuation lines. Languages whose parser has no comment
 * nodes (Dockerfile, INI, JSONC…) are scanned with their comment tokens.
 */
import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { language, syntaxTree } from "@codemirror/language";

export interface CommentTag {
  tag: string;
  color: string;
  strike?: boolean;
}

export const DEFAULT_TAGS = "! #ff5555, ? #3498db, TODO #ff8c00, * #98c379, // #7f848e strike";

/** "! #ff5555, ? #3498db, // #777 strike" → tags, longest first so "//" wins over "/". */
export function parseTags(spec: string): CommentTag[] {
  const out: CommentTag[] = [];
  for (const part of spec.split(",")) {
    const m = /^\s*(\S+)\s+(#[0-9a-f]{3,8}|[a-z]+\([^)]*\)|[a-z]+)(\s+strike)?\s*$/i.exec(part);
    if (m) out.push({ tag: m[1], color: m[2], strike: !!m[3] });
  }
  return out.sort((a, b) => b.tag.length - a.tag.length);
}

// What opens a comment on a line. Order matters: longer openers first, and
// "///" (doc comments) before "//" so "//// code" still reads as "//" + "//".
const OPENER = /^(\s*)(\/\/\/(?!\/)|\/\/|\/\*+|<!--|<#|--\[=*\[|\{-|\(\*+|#+|--+|;+|%+|'|REM\b|\*(?![/)]))?(\s*)/i;
// What closes one at the end of a line (left uncoloured).
const CLOSER = /\s*(\*+\/|-->|#>|\]=*\]|-\}|\*+\))\s*$/;

/** The tag a comment line starts with, and where it starts (offset in `text`). */
export function matchTag(text: string, tags: CommentTag[]): { tag: CommentTag; at: number } | null {
  const m = OPENER.exec(text)!;
  const at = m[0].length;
  const rest = text.slice(at);
  for (const t of tags) {
    const word = /^\w/.test(t.tag);
    if (word ? new RegExp(`^${t.tag}\\b`, "i").test(rest) : rest.startsWith(t.tag)) return { tag: t, at };
  }
  return null;
}

type Hit = [from: number, to: number, tag: CommentTag];

/** Colours one comment line `[start, end)`. */
function tagLine(state: EditorState, start: number, end: number, tags: CommentTag[], out: Hit[]) {
  const text = state.sliceDoc(start, end);
  const hit = matchTag(text, tags);
  if (!hit) return;
  const body = text.replace(CLOSER, "");
  if (body.length > hit.at) out.push([start + hit.at, start + body.length, hit.tag]);
}

interface Tokens {
  line: string[];
  block: Array<{ open: string; close: string }>;
}

function tokensAt(state: EditorState, pos: number): Tokens {
  const data = state.languageDataAt<{ line?: string; block?: { open: string; close: string } }>("commentTokens", pos);
  const t: Tokens = { line: [], block: [] };
  for (const d of data) {
    if (d.line && !t.line.includes(d.line)) t.line.push(d.line);
    if (d.block) t.block.push(d.block);
  }
  // No tokens declared (JSON, INI…): the common ones.
  if (!t.line.length && !t.block.length) return { line: ["//", "#", ";"], block: [{ open: "/*", close: "*/" }] };
  return t;
}

/**
 * For languages whose parser has no comment nodes: find comments from the
 * language's comment tokens, skipping anything inside a string.
 */
function scan(state: EditorState, from: number, to: number, tags: CommentTag[], out: Hit[]) {
  const tokens = tokensAt(state, from);
  let inBlock: { open: string; close: string } | null = null;
  for (let pos = from; pos <= to; ) {
    const line = state.doc.lineAt(pos);
    const text = line.text;
    let i = 0;
    let quote = "";
    while (i <= text.length) {
      if (inBlock) {
        const end = text.indexOf(inBlock.close, i);
        const stop = end < 0 ? text.length : end + inBlock.close.length;
        tagLine(state, line.from + i, line.from + stop, tags, out);
        if (end < 0) break;
        inBlock = null;
        i = stop;
        continue;
      }
      if (i >= text.length) break;
      const ch = text[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        i++;
        continue;
      }
      const lt = tokens.line.find((t) => text.startsWith(t, i) && (t !== "#" || i === 0 || /\s/.test(text[i - 1])));
      if (lt) {
        tagLine(state, line.from + i, line.to, tags, out);
        break;
      }
      const bt = tokens.block.find((b) => text.startsWith(b.open, i));
      if (bt) {
        inBlock = bt;
        continue;
      }
      i++;
    }
    if (line.to >= to) break;
    pos = line.to + 1;
  }
}

/** Coloured ranges for the comments in `ranges`. */
export function taggedRanges(state: EditorState, ranges: readonly { from: number; to: number }[], tags: CommentTag[]): Hit[] {
  const out: Hit[] = [];
  // Plain text has no comments.
  if (!state.facet(language)) return out;
  const tree = syntaxTree(state);
  for (const { from, to } of ranges) {
    let found = false;
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!/comment/i.test(node.type.name)) return;
        found = true;
        // One node per comment, line by line (block comments span several).
        for (let pos = node.from; pos <= node.to; ) {
          const line = state.doc.lineAt(pos);
          tagLine(state, Math.max(line.from, node.from), Math.min(line.to, node.to), tags, out);
          if (line.to >= node.to) break;
          pos = line.to + 1;
        }
        return false;
      },
    });
    if (!found) scan(state, from, to, tags, out);
  }
  return out;
}

function build(view: EditorView, tags: CommentTag[]): DecorationSet {
  const ranges = taggedRanges(view.state, view.visibleRanges, tags).sort((a, b) => a[0] - b[0]);
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const [from, to, t] of ranges) {
    if (from < last || from >= to) continue;
    builder.add(from, to, Decoration.mark({ class: "nox-bc" + (t.strike ? " nox-bc-strike" : ""), attributes: { style: `--bc: ${t.color}` } }));
    last = to;
  }
  return builder.finish();
}

export function betterComments(spec: string): Extension {
  const tags = parseTags(spec || DEFAULT_TAGS);
  if (!tags.length) return [];
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, tags);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view, tags);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
