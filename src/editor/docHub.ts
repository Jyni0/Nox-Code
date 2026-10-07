/**
 * One document per open buffer, shared by every view that shows it — a file
 * open in two split panes stays in sync keystroke by keystroke. The text
 * lives here, outside React, so typing never re-renders the app.
 */
import { Annotation, Text, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Marks transactions that only mirror another view's edit. */
export const syncAnnotation = Annotation.define<boolean>();

interface Entry {
  doc: Text;
  saved: Text;
  dirty: boolean;
  views: Set<EditorView>;
  listeners: Set<(doc: Text) => void>;
}

const docs = new Map<string, Entry>();
let dirtyListener: (id: string, dirty: boolean) => void = () => {};
const anyListeners = new Set<(id: string) => void>();

export const toText = (s: string) => Text.of(s.replace(/\r\n?/g, "\n").split("\n"));

function update(id: string, e: Entry) {
  const dirty = !e.doc.eq(e.saved);
  if (dirty !== e.dirty) {
    e.dirty = dirty;
    dirtyListener(id, dirty);
  }
  e.listeners.forEach((l) => l(e.doc));
  anyListeners.forEach((l) => l(id));
}

export const docHub = {
  onDirty(cb: (id: string, dirty: boolean) => void) {
    dirtyListener = cb;
  },
  create(id: string, content: string) {
    const doc = toText(content);
    docs.set(id, { doc, saved: doc, dirty: false, views: new Set(), listeners: new Set() });
  },
  has: (id: string) => docs.has(id),
  doc: (id: string): Text => docs.get(id)?.doc ?? Text.empty,
  text: (id: string): string => docs.get(id)?.doc.toString() ?? "",
  isDirty: (id: string) => docs.get(id)?.dirty ?? false,
  views: (id: string): EditorView[] => [...(docs.get(id)?.views ?? [])],

  attach(id: string, view: EditorView) {
    docs.get(id)?.views.add(view);
  },
  detach(id: string, view: EditorView) {
    docs.get(id)?.views.delete(view);
  },

  /** Called by a view's update listener for every local edit. */
  propagate(id: string, from: EditorView, tr: Transaction) {
    const e = docs.get(id);
    if (!e) return;
    e.doc = tr.state.doc;
    for (const v of e.views) {
      if (v !== from) v.dispatch({ changes: tr.changes, annotations: [syncAnnotation.of(true)] });
    }
    update(id, e);
  },

  /** Replaces the whole text (reload from disk, format, save hooks). */
  setText(id: string, content: string, opts: { markSaved?: boolean } = {}) {
    const e = docs.get(id);
    if (!e) return;
    const next = toText(content);
    if (!next.eq(e.doc)) {
      const [first] = e.views;
      if (first) {
        // Through a view, so undo history and the other views follow.
        first.dispatch({ changes: { from: 0, to: first.state.doc.length, insert: next } });
      } else {
        e.doc = next;
      }
    }
    if (opts.markSaved) e.saved = e.doc;
    update(id, e);
  },

  markSaved(id: string) {
    const e = docs.get(id);
    if (!e) return;
    e.saved = e.doc;
    update(id, e);
  },

  /** Every edit of every buffer (auto save). */
  onAnyChange(cb: (id: string) => void): () => void {
    anyListeners.add(cb);
    return () => anyListeners.delete(cb);
  },

  subscribe(id: string, cb: (doc: Text) => void): () => void {
    const e = docs.get(id);
    if (!e) return () => {};
    e.listeners.add(cb);
    return () => e.listeners.delete(cb);
  },

  dispose(id: string) {
    docs.delete(id);
  },
};
