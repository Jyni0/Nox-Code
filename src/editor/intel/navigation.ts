/**
 * Go to Definition (F12 / Ctrl+click), hover cards and the Ctrl+hover link
 * underline. Definitions come from the syntax tree and the symbol extractor
 * for the current file, then from the project index.
 */
import { Facet, RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { backend } from "@/lib/backend";
import { dirname, join, samePath } from "@/lib/path";
import { activeView } from "@/editor/viewRegistry";
import { isMac } from "@/lib/keys";
import { highlightLines } from "@/editor/staticHighlight";
import { useEditor } from "@/stores/editor";
import { useWorkspace, relPath } from "@/stores/workspace";
import { toast, useUi } from "@/stores/ui";
import { docSymbols, ensureIndex, findInProject } from "./index";
import { wordRe, type CodeSymbol } from "./symbols";
import { vocabFor } from "./vocab";

export interface IntelContext {
  bufferId: string;
  langId: string;
  path: string | null;
}

/** Which buffer a view shows; set by the extension registry. */
export const intelContext = Facet.define<IntelContext, IntelContext | null>({ combine: (v) => v[v.length - 1] ?? null });

export interface Definition extends CodeSymbol {
  /** null = the current document. */
  path: string | null;
  /** An import binding: only used when nothing better is found. */
  viaImport?: boolean;
}

interface Resolved {
  name: string;
  from: number;
  to: number;
  defs: Definition[];
  /** A file path written in a string (import "./x", #include "x.h"). */
  importSpec?: string;
}

/* ---------------- words ---------------- */

export function wordAtPos(state: EditorState, pos: number, langId: string): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos);
  const re = new RegExp(wordRe(langId).source, "g");
  for (const m of line.text.matchAll(re)) {
    const from = line.from + m.index!;
    const to = from + m[0].length;
    if (pos >= from && pos <= to && !/^\d/.test(m[0])) {
      return { from, to, text: m[0] };
    }
    if (from > pos) break;
  }
  return null;
}

/** Nodes that name a binding in CodeMirror's grammars (params, destructuring, locals). */
const DEF_NODES = new Set(["VariableDefinition", "PropertyDefinition", "TypeDefinition", "DefName", "BoundIdentifier", "FunctionName", "TypeName"]);

function treeDefinitions(state: EditorState, name: string): Definition[] {
  if (state.doc.length > 1_500_000) return [];
  const out: Definition[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (n) => {
      if (!DEF_NODES.has(n.name)) return;
      if (n.to - n.from !== name.length || state.sliceDoc(n.from, n.to) !== name) return;
      // TypeName / FunctionName are also used at call sites in some grammars: only accept
      // them when their parent looks like a declaration.
      if ((n.name === "TypeName" || n.name === "FunctionName") && !/Declaration|Definition|Item|Statement/.test(n.node.parent?.name ?? "")) return;
      const line = state.doc.lineAt(n.from);
      out.push({ name, kind: n.name === "TypeDefinition" ? "type" : "variable", line: line.number, col: n.from - line.from, signature: line.text.trim(), path: null });
    },
  });
  return out;
}

/** The definition that is in scope at `pos`: the nearest one above, else the first. */
function pickLocal(defs: Definition[], state: EditorState, pos: number): Definition[] {
  if (defs.length <= 1) return defs;
  const line = state.doc.lineAt(pos).number;
  const above = defs.filter((d) => d.line <= line).sort((a, b) => b.line - a.line);
  return above.length ? [above[0], ...defs.filter((d) => d !== above[0])] : defs;
}

const IMPORT_DECL = /^\s*(?:import\b|from\s+\S+\s+import\b|use\s|using\s|#\s*include|(?:const|let|var)\s+.*=\s*require\()/;
const IMPORT_LINE = /\b(?:import|from|require|include|export|use|load|source|@import|@use|src=|href=|url\()/;

function importSpecAt(state: EditorState, pos: number): { from: number; to: number; spec: string } | null {
  const node = syntaxTree(state).resolveInner(pos, 1);
  let str: typeof node | null = node;
  while (str && !/String|Path|AttributeValue|IncludeFile/i.test(str.type.name)) str = str.parent;
  const line = state.doc.lineAt(pos);
  let from: number;
  let to: number;
  if (str && str.to - str.from < 300) {
    from = str.from;
    to = str.to;
  } else {
    // Grammars without string nodes: the quoted run around the click.
    const rel = pos - line.from;
    const m = [...line.text.matchAll(/(["'<])([^"'<>\s]+)(["'>])/g)].find((x) => x.index! <= rel && x.index! + x[0].length >= rel);
    if (!m) return null;
    from = line.from + m.index!;
    to = from + m[0].length;
  }
  if (!IMPORT_LINE.test(line.text)) return null;
  const spec = state.sliceDoc(from, to).replace(/^[\s"'`<(]+|[\s"'`>)]+$/g, "");
  if (!spec || spec.length > 260 || /\s/.test(spec)) return null;
  return { from, to, spec };
}

export function resolveAt(state: EditorState, pos: number): Resolved | null {
  const ctx = state.facet(intelContext);
  if (!ctx) return null;
  const imp = importSpecAt(state, pos);
  if (imp && (/^[.~@/]/.test(imp.spec) || /\.\w{1,5}$/.test(imp.spec))) return { name: imp.spec, from: imp.from, to: imp.to, defs: [], importSpec: imp.spec };
  const w = wordAtPos(state, pos, ctx.langId);
  if (!w) return null;
  const name = w.text.replace(/^\$/, "");
  const local = [
    ...docSymbols(state.doc, ctx.langId).map((s) => ({ ...s, path: null })),
    ...treeDefinitions(state, name),
  ].filter((d) => d.name === name || d.name === w.text);
  // Same line twice (symbol + tree node): keep the richer one.
  const uniq = new Map<number, Definition>();
  for (const d of local) if (!uniq.has(d.line) || uniq.get(d.line)!.kind === "variable") uniq.set(d.line, d);
  // An import binding is only a pointer: the real definition in another file wins.
  const all = pickLocal([...uniq.values()], state, pos);
  const imports = all.filter((d) => IMPORT_DECL.test(state.doc.line(d.line).text));
  const defs: Definition[] = all.filter((d) => !imports.includes(d));
  defs.push(...findInProject(name, ctx.langId, ctx.path), ...imports.map((d) => ({ ...d, viaImport: true })));
  return { name, from: w.from, to: w.to, defs };
}

/* ---------------- navigation ---------------- */

interface Place {
  path: string | null;
  bufferId: string;
  pos: number;
}

const back: Place[] = [];

function remember(view: EditorView) {
  const ctx = view.state.facet(intelContext);
  if (!ctx) return;
  back.push({ path: ctx.path, bufferId: ctx.bufferId, pos: view.state.selection.main.head });
  if (back.length > 50) back.shift();
}

function revealHere(view: EditorView, line: number, col: number, len: number) {
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const from = Math.min(l.from + col, l.to);
  view.dispatch({ selection: { anchor: from, head: Math.min(from + len, l.to) }, effects: EditorView.scrollIntoView(from, { y: "center" }), userEvent: "select" });
  view.focus();
}

async function open(view: EditorView, d: Definition) {
  const ctx = view.state.facet(intelContext);
  remember(view);
  if (!d.path || (ctx?.path && samePath(d.path, ctx.path))) return revealHere(view, d.line, d.col, d.name.length);
  await useEditor.getState().openFile(d.path, { reveal: { line: d.line, col: d.col, len: d.name.length } });
}

const IMPORT_EXTS = ["", ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json", ".css", ".scss", ".py", ".rs", ".go", ".h", ".hpp", ".lua", ".rb", ".php", ".sh"];
const INDEX_FILES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/__init__.py", "/mod.rs", "/init.lua"];

async function resolveImport(spec: string, fromPath: string | null): Promise<string | null> {
  const root = useWorkspace.getState().root;
  const bases: string[] = [];
  const clean = spec.replace(/[?#].*$/, "");
  if (/^\.\.?\//.test(clean) || (!/^[@~/]/.test(clean) && fromPath)) bases.push(join(dirname(fromPath ?? root ?? ""), clean));
  if (root) {
    if (clean.startsWith("@/")) bases.push(join(root, "src", clean.slice(2)));
    if (clean.startsWith("~/")) bases.push(join(root, clean.slice(2)));
    if (clean.startsWith("/")) bases.push(join(root, clean.slice(1)));
    bases.push(join(root, clean));
    // Python: `from pkg.mod import x` → pkg/mod.py.
    if (/^[\w.]+$/.test(clean) && clean.includes(".") && !/\.\w{1,4}$/.test(clean)) bases.push(join(root, clean.replace(/\./g, "/")));
  }
  for (const base of bases) {
    for (const ext of [...IMPORT_EXTS, ...INDEX_FILES]) {
      const p = base + ext;
      if (await backend().exists(p).catch(() => false)) {
        // A folder is not a file.
        if (ext === "" && (await backend().listDir(p).then(() => true, () => false))) continue;
        return p;
      }
    }
  }
  return null;
}

/** F12 / Ctrl+click. Returns false when there was nothing to go to. */
export async function goToDefinition(view: EditorView, pos = view.state.selection.main.head): Promise<boolean> {
  const r = resolveAt(view.state, pos);
  const ctx = view.state.facet(intelContext);
  if (!r) return false;
  if (r.importSpec) {
    const target = await resolveImport(r.importSpec, ctx?.path ?? null);
    if (!target) {
      toast(`Cannot find “${r.importSpec}”`, "warning");
      return false;
    }
    remember(view);
    await useEditor.getState().openFile(target);
    return true;
  }
  let defs = r.defs;
  // Clicking the definition itself: go to the other ones (overloads, other files).
  const here = view.state.doc.lineAt(pos).number;
  const onSelf = defs.find((d) => !d.path && d.line === here);
  if (onSelf) defs = defs.filter((d) => d !== onSelf);
  if (!defs.length) {
    if (!onSelf) {
      // The index may still be building: try once more when it is done.
      if (useWorkspace.getState().root) await ensureIndex();
      const again = resolveAt(view.state, pos)?.defs.filter((d) => !(!d.path && d.line === here)) ?? [];
      if (again.length) return goTo(view, again);
      toast(`No definition found for “${r.name}”`, "info");
    }
    return false;
  }
  return goTo(view, defs);
}

async function goTo(view: EditorView, all: Definition[]): Promise<boolean> {
  const real = all.filter((d) => !d.viaImport);
  const defs = real.length ? real : all;
  // Several candidates in other files: let the user choose (the local one wins outright).
  if (defs[0].path === null || defs.length === 1) {
    await open(view, defs[0]);
    return true;
  }
  useUi.getState().pick({
    placeholder: `${defs.length} definitions of ${defs[0].name}`,
    items: defs.slice(0, 200).map((d, i) => ({
      id: String(i),
      label: d.signature,
      description: d.path ? `${relPath(d.path)}:${d.line}` : `line ${d.line}`,
      hint: d.kind,
    })),
    onAccept: (it) => void open(view, defs[Number(it.id)]),
  });
  return true;
}

/** Alt+← after a jump. */
export async function goBack(): Promise<boolean> {
  const p = back.pop();
  if (!p) return false;
  const st = useEditor.getState();
  if (p.path) await st.openFile(p.path);
  // The buffer's view is the active one after openFile.
  requestAnimationFrame(() => {
    const view = activeView();
    if (!view) return;
    const pos = Math.min(p.pos, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  });
  return true;
}

/* ---------------- hover ---------------- */

const kindLabel = (d: Definition) => (d.container ? `${d.kind} · ${d.container}` : d.kind);

function renderDoc(doc: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "nox-hover-doc";
  // A little Markdown/JSDoc: `code`, @tags on their own lines, paragraphs.
  for (const para of doc.split(/\n\s*\n/)) {
    const p = document.createElement("p");
    const lines = para.split("\n");
    lines.forEach((ln, i) => {
      const tag = /^\s*@(\w+)\s*(.*)$/.exec(ln);
      if (tag) {
        const t = document.createElement("span");
        t.className = "nox-hover-tag";
        t.textContent = "@" + tag[1];
        p.appendChild(t);
        ln = " " + tag[2];
      }
      for (const [k, part] of ln.split(/`([^`]+)`/).entries()) {
        if (k % 2) {
          const c = document.createElement("code");
          c.textContent = part;
          p.appendChild(c);
        } else if (part) p.appendChild(document.createTextNode(part));
      }
      if (i < lines.length - 1) p.appendChild(document.createElement("br"));
    });
    box.appendChild(p);
  }
  return box;
}

async function signatureDom(sig: string, langId: string): Promise<HTMLElement> {
  const pre = document.createElement("pre");
  pre.className = "nox-hover-sig";
  try {
    const lines = await highlightLines(sig, langId);
    lines.forEach((tokens, i) => {
      for (const t of tokens) {
        const s = document.createElement("span");
        if (t.cls) s.className = t.cls;
        s.textContent = t.text;
        pre.appendChild(s);
      }
      if (i < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
    });
  } catch {
    pre.textContent = sig;
  }
  return pre;
}

export function hoverCards(): Extension {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const ctx = view.state.facet(intelContext);
      if (!ctx) return null;
      const r = resolveAt(view.state, pos);
      if (!r) return null;
      const builtin = r.defs.length ? undefined : vocabFor(ctx.langId)?.builtins?.[r.name];
      if (!r.defs.length && !builtin && !r.importSpec) return null;
      const defs = r.defs;
      const first = defs[0];
      const dom = document.createElement("div");
      dom.className = "nox-hover";
      if (r.importSpec) {
        const target = await resolveImport(r.importSpec, ctx.path);
        if (!target) return null;
        const p = document.createElement("div");
        p.className = "nox-hover-loc";
        p.textContent = relPath(target);
        dom.appendChild(p);
      } else if (first) {
        dom.appendChild(await signatureDom(first.signature, (first as Definition & { langId?: string }).langId ?? ctx.langId));
        if (first.doc) dom.appendChild(renderDoc(first.doc));
        const loc = document.createElement("div");
        loc.className = "nox-hover-loc";
        const where = first.path ? `${relPath(first.path)}:${first.line}` : `line ${first.line}`;
        loc.textContent = `${kindLabel(first)} · ${where}${defs.length > 1 ? ` · +${defs.length - 1} more` : ""}`;
        dom.appendChild(loc);
      } else if (builtin) {
        dom.appendChild(await signatureDom(builtin, ctx.langId));
        const loc = document.createElement("div");
        loc.className = "nox-hover-loc";
        loc.textContent = "builtin";
        dom.appendChild(loc);
      }
      const hint = document.createElement("div");
      hint.className = "nox-hover-hint";
      if (first || r.importSpec) {
        hint.textContent = `${isMac ? "⌘" : "Ctrl"}+click or F12 to go there`;
        dom.appendChild(hint);
      }
      return { pos: r.from, end: r.to, above: true, create: () => ({ dom }) };
    },
    { hoverTime: 350 },
  );
}

/* ---------------- Ctrl+click and the link underline ---------------- */

const linkMark = Decoration.mark({ class: "cm-goto-link" });

const modDown = (e: MouseEvent | KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;

export function ctrlClickNavigation(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      last: { x: number; y: number } | null = null;
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = Decoration.none;
      }
      set(range: { from: number; to: number } | null) {
        const b = new RangeSetBuilder<Decoration>();
        if (range) b.add(range.from, range.to, linkMark);
        this.decorations = b.finish();
        this.view.dispatch({});
      }
      refresh(e: MouseEvent | KeyboardEvent, at: { x: number; y: number } | null) {
        if (!at || !modDown(e)) {
          if (this.decorations.size) this.set(null);
          return;
        }
        const pos = this.view.posAtCoords(at);
        const r = pos === null ? null : resolveAt(this.view.state, pos);
        const ok = !!r && (r.defs.length > 0 || !!r.importSpec);
        const cur = this.decorations.iter();
        if (ok && cur.value && cur.from === r!.from && cur.to === r!.to) return;
        if (!ok && !this.decorations.size) return;
        this.set(ok ? r : null);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousemove(e) {
          this.last = { x: e.clientX, y: e.clientY };
          this.refresh(e, this.last);
        },
        mouseleave() {
          this.last = null;
          if (this.decorations.size) this.set(null);
        },
        keydown(e) {
          this.refresh(e, this.last);
        },
        keyup(e) {
          this.refresh(e, this.last);
        },
        mousedown(e, view) {
          if (e.button !== 0 || !modDown(e)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          e.preventDefault();
          this.set(null);
          // The caret moves to the click first, so Go Back returns right here.
          view.dispatch({ selection: { anchor: pos } });
          void goToDefinition(view, pos);
          return true;
        },
      },
    },
  );
  return [
    plugin,
    // Ctrl+click now navigates; extra cursors move to Alt+click, like VS Code.
    EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
    EditorView.baseTheme({ ".cm-goto-link": { textDecoration: "underline", cursor: "pointer", color: "var(--accent) !important" } }),
  ];
}
