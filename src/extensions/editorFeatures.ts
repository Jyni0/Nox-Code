/** CodeMirror features written for Nox Code's built-in extensions. */
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  gutter,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSet } from "@codemirror/state";
import { diffLines } from "diff";

/* ---------------- Rainbow brackets ---------------- */

export const RAINBOW_PALETTES: Record<string, string[]> = {
  classic: ["#ffd700", "#da70d6", "#179fff"],
  pastel: ["#f6c177", "#c4a7e7", "#9ccfd8", "#ebbcba"],
  neon: ["#ff5ac5", "#36f9f6", "#fede5d", "#72f1b8"],
  spectrum: ["#ff6b6b", "#ffb86b", "#ffe66d", "#7bd88f", "#5ac8fa", "#b388ff"],
};

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

function treeDepth(node: { parent: { firstChild: { name: string } | null; parent: unknown } | null }): number {
  let depth = 0;
  // Each ancestor whose first child is an opening bracket is one level.
  for (let p = node.parent as { firstChild: { name: string } | null; parent: unknown } | null; p; p = p.parent as typeof p) {
    if (p.firstChild && OPEN.has(p.firstChild.name)) depth++;
  }
  return Math.max(0, depth - 1);
}

export function rainbowBrackets(colors: string[]): Extension {
  const marks = colors.map((c) => Decoration.mark({ attributes: { style: `color: ${c} !important` } }));
  const build = (view: EditorView): DecorationSet => {
    const found: Array<{ from: number; to: number; depth: number }> = [];
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({
        from,
        to,
        enter: (n) => {
          if (OPEN.has(n.name) || CLOSE.has(n.name)) found.push({ from: n.from, to: n.to, depth: treeDepth(n.node as never) });
        },
      });
    }
    // Grammars without bracket tokens (legacy modes): count from a bounded window.
    if (!found.length) {
      const vis = view.visibleRanges;
      if (vis.length) {
        const start = Math.max(0, vis[0].from - 50_000);
        const end = vis[vis.length - 1].to;
        const text = view.state.doc.sliceString(start, end);
        let depth = 0;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (OPEN.has(ch)) {
            if (start + i >= vis[0].from) found.push({ from: start + i, to: start + i + 1, depth });
            depth++;
          } else if (CLOSE.has(ch)) {
            depth = Math.max(0, depth - 1);
            if (start + i >= vis[0].from) found.push({ from: start + i, to: start + i + 1, depth });
          }
        }
      }
    }
    found.sort((a, b) => a.from - b.from);
    const b = new RangeSetBuilder<Decoration>();
    let last = -1;
    for (const f of found) {
      if (f.from < last) continue;
      b.add(f.from, f.to, marks[f.depth % marks.length]);
      last = f.to;
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/* ---------------- Color preview + picker ---------------- */

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\([^()\n]{4,48}\)/g;

function toPickerHex(color: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = color;
  if (!probe.style.color) return null;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return null;
  return "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("");
}

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(o: SwatchWidget) {
    return o.color === this.color;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "color-swatch";
    wrap.title = "Click to pick a color";
    const fill = document.createElement("span");
    fill.style.background = this.color;
    wrap.appendChild(fill);
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const hex = toPickerHex(this.color);
      if (!hex || view.state.readOnly) return;
      const input = document.createElement("input");
      input.type = "color";
      input.value = hex;
      input.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;opacity:0;width:1px;height:1px;`;
      document.body.appendChild(input);
      const original = this.color;
      let current = original;
      input.addEventListener("input", () => {
        const pos = view.posAtDOM(wrap);
        const text = view.state.doc.sliceString(pos, pos + current.length);
        if (text !== current) return;
        // Keep the short / alpha form when the source used hex; otherwise write hex.
        const next = original.startsWith("#") && original.length === 9 ? input.value + original.slice(7) : input.value;
        view.dispatch({ changes: { from: pos, to: pos + current.length, insert: next } });
        current = next;
      });
      input.addEventListener("change", () => input.remove());
      input.addEventListener("blur", () => setTimeout(() => input.remove(), 100));
      input.click();
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

export function colorPreview(): Extension {
  const matcher = new MatchDecorator({
    regexp: COLOR_RE,
    decoration: (m) => Decoration.widget({ widget: new SwatchWidget(m[0]), side: -1 }),
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = matcher.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/* ---------------- TODO highlighter ---------------- */

const KNOWN_TODO = new Set(["TODO", "FIXME", "HACK", "NOTE", "BUG", "XXX"]);

export function todoHighlighter(keywords: string[]): Extension {
  const words = keywords.map((k) => k.trim()).filter(Boolean).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [];
  const matcher = new MatchDecorator({
    regexp: new RegExp(`\\b(?:${words.join("|")})\\b:?`, "g"),
    decoration: (m) => {
      const word = m[0].replace(/:$/, "").toUpperCase();
      return Decoration.mark({ class: `todo-mark ${KNOWN_TODO.has(word) ? "todo-" + word : "todo-custom"}` });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = matcher.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/* ---------------- Git gutter ---------------- */

export type LineChange = { line: number; kind: "add" | "mod" | "del" };

/** Line markers for the current text against the HEAD version. */
export function computeLineChanges(base: string, current: string): LineChange[] {
  const out: LineChange[] = [];
  const parts = diffLines(base, current);
  let line = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const count = p.count ?? p.value.split("\n").length - (p.value.endsWith("\n") ? 1 : 0);
    if (!p.added && !p.removed) {
      line += count;
      continue;
    }
    if (p.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        const n = next.count ?? 0;
        for (let k = 0; k < n; k++) out.push({ line: line + k, kind: "mod" });
        line += n;
        i++;
      } else {
        out.push({ line: Math.max(1, line), kind: "del" });
      }
      continue;
    }
    for (let k = 0; k < count; k++) out.push({ line: line + k, kind: "add" });
    line += count;
  }
  return out;
}

class GitMarker extends GutterMarker {
  constructor(readonly kind: LineChange["kind"]) {
    super();
  }
  eq(o: GitMarker) {
    return o.kind === this.kind;
  }
  toDOM() {
    const d = document.createElement("div");
    d.className = `git-marker git-marker-${this.kind}`;
    return d;
  }
}

const MARKERS = { add: new GitMarker("add"), mod: new GitMarker("mod"), del: new GitMarker("del") };
const setGitMarkers = StateEffect.define<RangeSet<GutterMarker>>();
const gitMarkersField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGitMarkers)) return e.value;
    return tr.docChanged ? value.map(tr.changes) : value;
  },
});

/** HEAD text per buffer; null = untracked (everything is "added"). */
const bases = new Map<string, string | null>();
const baseListeners = new Map<string, Set<() => void>>();

export function setGitBase(bufferId: string, base: string | null | undefined) {
  if (base === undefined) bases.delete(bufferId);
  else bases.set(bufferId, base);
  baseListeners.get(bufferId)?.forEach((l) => l());
}

function markersFor(doc: Text, changes: LineChange[]): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  for (const c of changes) {
    if (c.line > doc.lines) continue;
    b.add(doc.line(c.line).from, doc.line(c.line).from, MARKERS[c.kind]);
  }
  return b.finish();
}

export function gitGutter(bufferId: string): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      unlisten: () => void;
      constructor(readonly view: EditorView) {
        const set = baseListeners.get(bufferId) ?? new Set();
        baseListeners.set(bufferId, set);
        const l = () => this.schedule(0);
        set.add(l);
        this.unlisten = () => set.delete(l);
        this.schedule(0);
      }
      schedule(ms: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.compute(), ms);
      }
      compute() {
        if (!bases.has(bufferId)) {
          this.view.dispatch({ effects: setGitMarkers.of(RangeSet.empty) });
          return;
        }
        const base = bases.get(bufferId);
        const doc = this.view.state.doc;
        const changes = base == null ? [] : computeLineChanges(base, doc.toString());
        this.view.dispatch({ effects: setGitMarkers.of(markersFor(doc, changes)) });
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule(250);
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.unlisten();
      }
    },
  );
  return [
    gitMarkersField,
    plugin,
    gutter({ class: "cm-git-gutter", markers: (v) => v.state.field(gitMarkersField) }),
  ];
}

/* ---------------- Word count ---------------- */

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}
