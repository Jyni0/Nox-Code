import { create } from "zustand";
import { backend } from "@/lib/backend";
import { basename, isInside, rebase, samePath } from "@/lib/path";
import { detectLanguage, isImageFile } from "@/editor/languages";
import { docHub } from "@/editor/docHub";
import { insertLeaf, leaf, leafIds, setSizes, syncLayout, type LayoutNode, type Side } from "@/editor/layout";
import { useSettings } from "./settings";
import { effectiveFor } from "./project";
import { errorMessage, toast, useUi } from "./ui";
import { useWorkspace } from "./workspace";

export type TabKind = "text" | "image" | "binary" | "preview" | "diff" | "search";

export interface Buffer {
  id: string;
  path: string | null;
  name: string;
  langId: string;
  dirty: boolean;
  lineEnding: "LF" | "CRLF";
  bom: boolean;
  /** The file changed on disk while it had unsaved edits. */
  diskChanged?: boolean;
  /** The file was deleted or moved away on disk. */
  deleted?: boolean;
}

export interface Tab {
  id: string;
  kind: TabKind;
  bufferId?: string;
  path: string | null;
  title: string;
  /** Single-click "preview" tab: italic, replaced by the next preview. */
  preview?: boolean;
}

export interface Pane {
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
  /** Most-recently-used tab ids, newest first. */
  mru: string[];
}

export type SplitSide = Side;

export interface Reveal {
  line: number;
  col?: number;
  len?: number;
}

export interface OpenOptions {
  paneId?: string;
  preview?: boolean;
  reveal?: Reveal;
  /** Open in the pane to the right (creating it). */
  side?: boolean;
  /** Open in a new group created next to this pane. */
  split?: { paneId: string; side: SplitSide };
  focus?: boolean;
}

interface EditorStore {
  buffers: Record<string, Buffer>;
  /** Editor groups, in reading order of `layout`. */
  panes: Pane[];
  /** How the groups are arranged: nested rows and columns. */
  layout: LayoutNode;
  activePaneId: string;
  closed: Array<{ path: string; kind: TabKind }>;
  pendingReveal: Record<string, Reveal>;
  /** Bumps when a pane should take keyboard focus. */
  focusNonce: number;

  openFile(path: string, opts?: OpenOptions): Promise<void>;
  newUntitled(content?: string, langId?: string): void;
  openPreview(bufferId: string): void;
  openDiff(path: string): Promise<void>;
  /** The project search tab: focus the open one, or add it to the active group. */
  openSearch(): void;
  activateTab(paneId: string, tabId: string): void;
  pinTab(paneId: string, tabId: string): void;
  closeTab(paneId: string, tabId: string, force?: boolean): Promise<boolean>;
  closeTabs(paneId: string, which: "others" | "all" | "saved" | "right", tabId?: string): Promise<void>;
  reopenClosed(): Promise<void>;
  moveTab(fromPane: string, tabId: string, toPane: string, index?: number): void;
  splitRight(paneId?: string): void;
  /** A new group on `side` of the pane, showing a copy of its active tab. */
  split(paneId: string | undefined, side: SplitSide): void;
  setSplitSizes(splitId: string, sizes: number[]): void;
  /** Drag & drop: the tab goes into a new group on that side of `targetPane`. */
  splitWithTab(fromPane: string, tabId: string, targetPane: string, side: SplitSide): void;
  focusPane(paneId: string): void;
  cycleTab(dir: 1 | -1): void;
  save(bufferId: string, saveAs?: boolean): Promise<boolean>;
  saveAll(): Promise<void>;
  revert(bufferId: string): Promise<void>;
  setLanguage(bufferId: string, langId: string): void;
  setLineEnding(bufferId: string, le: "LF" | "CRLF"): void;
  consumeReveal(bufferId: string): Reveal | undefined;
  onDiskChange(paths: string[]): Promise<void>;
  onPathRenamed(from: string, to: string): void;
  onPathDeleted(path: string): void;
  reset(): void;
}

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;
let untitledCount = 0;
const MAX_PANES = 6;

/** Hooks run before writing a buffer (format on save…). Return new text or null. */
type SaveHook = (buf: Buffer, text: string) => Promise<string | null>;
const saveHooks: SaveHook[] = [];
export const registerSaveHook = (h: SaveHook) => {
  saveHooks.push(h);
  return () => saveHooks.splice(saveHooks.indexOf(h), 1);
};

const opening = new Map<string, Promise<void>>();

function emptyPane(): Pane {
  return { id: uid("pane-"), tabs: [], activeTabId: null, mru: [] };
}

const firstPane = emptyPane();

export const useEditor = create<EditorStore>((set, get) => {
  docHub.onDirty((id, dirty) => {
    const b = get().buffers[id];
    if (b && b.dirty !== dirty) {
      set((s) => ({ buffers: { ...s.buffers, [id]: { ...b, dirty } } }));
      // Opening a dirty preview tab turns it into a normal one.
      if (dirty) {
        set((s) => ({
          panes: s.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.bufferId === id && t.preview ? { ...t, preview: false } : t)) })),
        }));
      }
    }
  });

  const pane = (id?: string) => get().panes.find((p) => p.id === (id ?? get().activePaneId)) ?? get().panes[0];
  const updatePane = (id: string, fn: (p: Pane) => Pane) => set((s) => ({ panes: s.panes.map((p) => (p.id === id ? fn(p) : p)) }));
  const bufferByPath = (path: string) => Object.values(get().buffers).find((b) => b.path && samePath(b.path, path));
  const refs = (bufferId: string) => get().panes.reduce((n, p) => n + p.tabs.filter((t) => t.bufferId === bufferId).length, 0);

  const insertTab = (paneId: string, tab: Tab, replacePreview: boolean) =>
    updatePane(paneId, (p) => {
      let tabs = [...p.tabs];
      let at = p.activeTabId ? tabs.findIndex((t) => t.id === p.activeTabId) + 1 : tabs.length;
      if (replacePreview) {
        const pi = tabs.findIndex((t) => t.preview);
        if (pi >= 0) {
          const old = tabs[pi];
          if (!old.bufferId || !get().buffers[old.bufferId]?.dirty) {
            tabs.splice(pi, 1, tab);
            queueMicrotask(() => old.bufferId && refs(old.bufferId) === 0 && disposeBuffer(old.bufferId));
            return { ...p, tabs, activeTabId: tab.id, mru: [tab.id, ...p.mru.filter((m) => m !== old.id)] };
          }
        }
      }
      if (at <= 0) at = tabs.length;
      tabs.splice(at, 0, tab);
      return { ...p, tabs, activeTabId: tab.id, mru: [tab.id, ...p.mru] };
    });

  const disposeBuffer = (id: string) => {
    docHub.dispose(id);
    set((s) => {
      const next = { ...s.buffers };
      delete next[id];
      return { buffers: next };
    });
  };

  /** A new empty group beside `paneId`, or null when the maximum is reached. */
  const insertPane = (paneId: string, side: SplitSide): string | null => {
    if (get().panes.length >= MAX_PANES) {
      toast(`At most ${MAX_PANES} editor groups`, "warning");
      return null;
    }
    const np = emptyPane();
    set((s) => ({ panes: [...s.panes, np], layout: insertLeaf(s.layout, paneId, np.id, side) }));
    return np.id;
  };

  /** The next group in reading order, or a new one to the right. */
  const ensurePaneForSide = (): string => {
    const { panes, activePaneId } = get();
    const i = panes.findIndex((p) => p.id === activePaneId);
    if (i < panes.length - 1) return panes[i + 1].id;
    if (panes.length >= MAX_PANES) return panes[panes.length - 1].id;
    return insertPane(activePaneId, "right") ?? activePaneId;
  };

  async function loadBuffer(path: string): Promise<{ buffer: Buffer; kind: TabKind }> {
    const existing = bufferByPath(path);
    if (existing) return { buffer: existing, kind: "text" };
    const name = basename(path);
    const file = await backend().readFile(path);
    const buffer: Buffer = {
      id: uid("buf-"),
      path,
      name,
      langId: detectLanguage(name),
      dirty: false,
      lineEnding: file.lineEnding,
      bom: file.bom,
    };
    if (file.binary) return { buffer, kind: "binary" };
    docHub.create(buffer.id, file.content);
    set((s) => ({ buffers: { ...s.buffers, [buffer.id]: buffer } }));
    return { buffer, kind: "text" };
  }

  return {
    buffers: {},
    panes: [firstPane],
    layout: leaf(firstPane.id),
    activePaneId: firstPane.id,
    closed: [],
    pendingReveal: {},
    focusNonce: 0,

    async openFile(path, opts = {}) {
      const key = `${path}|${opts.paneId ?? ""}|${opts.side ? 1 : 0}`;
      if (opening.has(key)) return opening.get(key);
      const run = (async () => {
        const paneId = (opts.split && insertPane(opts.split.paneId, opts.split.side)) || (opts.side ? ensurePaneForSide() : pane(opts.split?.paneId ?? opts.paneId).id);
        const target = pane(paneId);
        const previewMode = !!opts.preview && useSettings.getState().previewTabs;
        const image = isImageFile(path);
        const existing = target.tabs.find((t) => (t.kind === "text" || t.kind === "image" || t.kind === "binary") && t.path && samePath(t.path, path));
        if (existing) {
          set({ activePaneId: paneId });
          get().activateTab(paneId, existing.id);
          if (!previewMode && existing.preview) get().pinTab(paneId, existing.id);
          if (existing.bufferId && opts.reveal) set((s) => ({ pendingReveal: { ...s.pendingReveal, [existing.bufferId!]: opts.reveal! } }));
          if (opts.focus !== false) set((s) => ({ focusNonce: s.focusNonce + 1 }));
          return;
        }
        if (image) {
          insertTab(paneId, { id: uid("tab-"), kind: "image", path, title: basename(path), preview: previewMode }, previewMode);
          set({ activePaneId: paneId });
          return;
        }
        try {
          const { buffer, kind } = await loadBuffer(path);
          if (kind === "binary") {
            insertTab(paneId, { id: uid("tab-"), kind: "binary", path, title: buffer.name, preview: previewMode }, previewMode);
          } else {
            if (opts.reveal) set((s) => ({ pendingReveal: { ...s.pendingReveal, [buffer.id]: opts.reveal! } }));
            insertTab(paneId, { id: uid("tab-"), kind: "text", bufferId: buffer.id, path, title: buffer.name, preview: previewMode }, previewMode);
          }
          set((s) => ({ activePaneId: paneId, focusNonce: opts.focus === false ? s.focusNonce : s.focusNonce + 1 }));
        } catch (e) {
          toast(`Cannot open ${basename(path)}`, "error", errorMessage(e));
        }
      })();
      opening.set(key, run);
      try {
        await run;
      } finally {
        opening.delete(key);
      }
    },

    newUntitled(content = "", langId = "plaintext") {
      const n = ++untitledCount;
      const buffer: Buffer = { id: uid("buf-"), path: null, name: `Untitled-${n}`, langId, dirty: false, lineEnding: "LF", bom: false };
      docHub.create(buffer.id, content);
      set((s) => ({ buffers: { ...s.buffers, [buffer.id]: buffer } }));
      insertTab(pane().id, { id: uid("tab-"), kind: "text", bufferId: buffer.id, path: null, title: buffer.name }, false);
      set((s) => ({ focusNonce: s.focusNonce + 1 }));
    },

    openPreview(bufferId) {
      const b = get().buffers[bufferId];
      if (!b) return;
      const paneId = ensurePaneForSide();
      const p = pane(paneId);
      const existing = p.tabs.find((t) => t.kind === "preview" && t.bufferId === bufferId);
      if (existing) return get().activateTab(paneId, existing.id);
      insertTab(paneId, { id: uid("tab-"), kind: "preview", bufferId, path: b.path, title: `Preview ${b.name}` }, false);
    },

    openSearch() {
      const st = get();
      const host = st.panes.find((p) => p.id === st.activePaneId && p.tabs.some((t) => t.kind === "search")) ?? st.panes.find((p) => p.tabs.some((t) => t.kind === "search"));
      const existing = host?.tabs.find((t) => t.kind === "search");
      if (host && existing) {
        set({ activePaneId: host.id });
        get().activateTab(host.id, existing.id);
        return;
      }
      const paneId = pane().id;
      insertTab(paneId, { id: uid("tab-"), kind: "search", path: null, title: "Search" }, false);
      set({ activePaneId: paneId });
    },

    async openDiff(path) {
      const root = useWorkspace.getState().root;
      if (!root) return;
      await get().openFile(path, { focus: false });
      const b = bufferByPath(path);
      const p = pane();
      const existing = p.tabs.find((t) => t.kind === "diff" && t.path && samePath(t.path, path));
      if (existing) return get().activateTab(p.id, existing.id);
      // Replace the plain tab we just opened with the diff (the buffer stays alive).
      const plain = p.tabs.find((t) => t.kind === "text" && t.path && samePath(t.path, path));
      const tab: Tab = { id: uid("tab-"), kind: "diff", bufferId: b?.id, path, title: `${basename(path)} (Working Tree)` };
      insertTab(p.id, tab, false);
      if (plain && plain.preview) updatePane(p.id, (x) => ({ ...x, tabs: x.tabs.filter((t) => t.id !== plain.id) }));
    },

    activateTab(paneId, tabId) {
      updatePane(paneId, (p) => ({ ...p, activeTabId: tabId, mru: [tabId, ...p.mru.filter((m) => m !== tabId)] }));
      set({ activePaneId: paneId });
    },

    pinTab(paneId, tabId) {
      updatePane(paneId, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)) }));
    },

    async closeTab(paneId, tabId, force = false) {
      const p = get().panes.find((x) => x.id === paneId);
      const tab = p?.tabs.find((t) => t.id === tabId);
      if (!p || !tab) return true;
      const buf = tab.bufferId ? get().buffers[tab.bufferId] : undefined;
      const lastRef = buf && refs(buf.id) === 1;
      if (!force && buf && lastRef && buf.dirty && tab.kind === "text") {
        const answer = await useUi.getState().ask({
          title: `Save changes to ${buf.name}?`,
          message: "Your changes will be lost if you don't save them.",
          buttons: [
            { id: "save", label: "Save", variant: "primary" },
            { id: "discard", label: "Don't Save", variant: "danger" },
            { id: "cancel", label: "Cancel" },
          ],
          cancelId: "cancel",
        });
        if (answer === "cancel") return false;
        if (answer === "save" && !(await get().save(buf.id))) return false;
      }
      if (tab.path && (tab.kind === "text" || tab.kind === "image")) {
        set((s) => ({ closed: [{ path: tab.path!, kind: tab.kind }, ...s.closed].slice(0, 30) }));
      }
      updatePane(paneId, (x) => {
        const tabs = x.tabs.filter((t) => t.id !== tabId);
        const mru = x.mru.filter((m) => m !== tabId && tabs.some((t) => t.id === m));
        const activeTabId = x.activeTabId === tabId ? mru[0] ?? tabs[tabs.length - 1]?.id ?? null : x.activeTabId;
        return { ...x, tabs, mru, activeTabId };
      });
      if (buf && refs(buf.id) === 0) disposeBuffer(buf.id);
      // An emptied split pane disappears; the last pane always stays.
      const after = get().panes.find((x) => x.id === paneId);
      if (after && after.tabs.length === 0 && get().panes.length > 1) {
        set((s) => {
          const panes = s.panes.filter((x) => x.id !== paneId);
          return { panes, activePaneId: s.activePaneId === paneId ? panes[Math.max(0, s.panes.findIndex((x) => x.id === paneId) - 1)].id : s.activePaneId };
        });
      }
      return true;
    },

    async closeTabs(paneId, which, tabId) {
      const p = get().panes.find((x) => x.id === paneId);
      if (!p) return;
      const idx = tabId ? p.tabs.findIndex((t) => t.id === tabId) : -1;
      const targets = p.tabs.filter((t, i) => {
        if (which === "all") return true;
        if (which === "others") return t.id !== tabId;
        if (which === "right") return i > idx;
        return !(t.bufferId && get().buffers[t.bufferId]?.dirty);
      });
      for (const t of targets) if (!(await get().closeTab(paneId, t.id))) break;
    },

    async reopenClosed() {
      const [last, ...rest] = get().closed;
      if (!last) return;
      set({ closed: rest });
      await get().openFile(last.path);
    },

    moveTab(fromPane, tabId, toPane, index) {
      const from = get().panes.find((p) => p.id === fromPane);
      const tab = from?.tabs.find((t) => t.id === tabId);
      if (!from || !tab) return;
      if (fromPane === toPane) {
        updatePane(fromPane, (p) => {
          const tabs = p.tabs.filter((t) => t.id !== tabId);
          tabs.splice(Math.min(index ?? tabs.length, tabs.length), 0, tab);
          return { ...p, tabs };
        });
        return;
      }
      const to = get().panes.find((p) => p.id === toPane);
      const dup = to?.tabs.find((t) => t.kind === tab.kind && t.path && tab.path && samePath(t.path, tab.path) && t.bufferId === tab.bufferId);
      updatePane(toPane, (p) => {
        if (dup) return { ...p, activeTabId: dup.id };
        const tabs = [...p.tabs];
        tabs.splice(Math.min(index ?? tabs.length, tabs.length), 0, { ...tab, preview: false });
        return { ...p, tabs, activeTabId: tab.id, mru: [tab.id, ...p.mru] };
      });
      updatePane(fromPane, (p) => {
        const tabs = p.tabs.filter((t) => t.id !== tabId);
        const mru = p.mru.filter((m) => m !== tabId);
        return { ...p, tabs, mru, activeTabId: p.activeTabId === tabId ? mru[0] ?? tabs[0]?.id ?? null : p.activeTabId };
      });
      set({ activePaneId: toPane });
      if (dup && tab.bufferId && refs(tab.bufferId) === 0) disposeBuffer(tab.bufferId);
      const src = get().panes.find((p) => p.id === fromPane);
      if (src && src.tabs.length === 0 && get().panes.length > 1) set((s) => ({ panes: s.panes.filter((p) => p.id !== fromPane) }));
    },

    splitRight(paneId) {
      get().split(paneId, "right");
    },

    split(paneId, side) {
      const src = pane(paneId);
      const active = src.tabs.find((t) => t.id === src.activeTabId);
      const np = insertPane(src.id, side);
      if (!np) return;
      if (active && active.kind !== "preview") {
        const copy = { ...active, id: uid("tab-"), preview: false };
        updatePane(np, (p) => ({ ...p, tabs: [copy], activeTabId: copy.id, mru: [copy.id] }));
      }
      set((s) => ({ activePaneId: np, focusNonce: s.focusNonce + 1 }));
    },

    setSplitSizes(splitId, sizes) {
      set((s) => ({ layout: setSizes(s.layout, splitId, sizes) }));
    },

    splitWithTab(fromPane, tabId, targetPane, side) {
      const src = get().panes.find((p) => p.id === fromPane);
      const tab = src?.tabs.find((t) => t.id === tabId);
      if (!src || !tab) return;
      // Dragging a group's only tab to its own edge would leave it empty: copy instead.
      const copyOnly = fromPane === targetPane && src.tabs.length === 1;
      const np = insertPane(targetPane, side);
      if (!np) return;
      const copy: Tab = { ...tab, id: uid("tab-"), preview: false };
      updatePane(np, (p) => ({ ...p, tabs: [copy], activeTabId: copy.id, mru: [copy.id] }));
      if (!copyOnly) {
        updatePane(fromPane, (p) => {
          const tabs = p.tabs.filter((t) => t.id !== tabId);
          const mru = p.mru.filter((m) => m !== tabId);
          return { ...p, tabs, mru, activeTabId: p.activeTabId === tabId ? mru[0] ?? tabs[0]?.id ?? null : p.activeTabId };
        });
        const after = get().panes.find((p) => p.id === fromPane);
        if (after && after.tabs.length === 0) set((s) => ({ panes: s.panes.filter((p) => p.id !== fromPane) }));
      }
      set((s) => ({ activePaneId: np, focusNonce: s.focusNonce + 1 }));
    },

    focusPane(paneId) {
      if (get().activePaneId !== paneId) set({ activePaneId: paneId });
    },

    cycleTab(dir) {
      const p = pane();
      if (p.tabs.length < 2) return;
      const i = p.tabs.findIndex((t) => t.id === p.activeTabId);
      const next = p.tabs[(i + dir + p.tabs.length) % p.tabs.length];
      get().activateTab(p.id, next.id);
      set((s) => ({ focusNonce: s.focusNonce + 1 }));
    },

    async save(bufferId, saveAs = false) {
      const buf = get().buffers[bufferId];
      if (!buf) return false;
      let path = buf.path;
      if (!path || saveAs) {
        path = await backend().pickSaveFile(buf.path ?? buf.name);
        if (!path) return false;
      }
      const s = effectiveFor(path, buf.langId);
      let text = docHub.text(bufferId);
      for (const hook of saveHooks) {
        try {
          const out = await hook(buf, text);
          if (out !== null) text = out;
        } catch (e) {
          toast("Format on save failed", "warning", errorMessage(e));
        }
      }
      if (s.trimTrailingWhitespace) text = text.replace(/[ \t]+$/gm, "");
      if (s.insertFinalNewline && text.length && !text.endsWith("\n")) text += "\n";
      if (text !== docHub.text(bufferId)) docHub.setText(bufferId, text);
      try {
        await backend().writeFile(path, text, buf.lineEnding, buf.bom);
      } catch (e) {
        toast(`Could not save ${basename(path)}`, "error", errorMessage(e));
        return false;
      }
      docHub.markSaved(bufferId);
      const renamed = path !== buf.path;
      const name = basename(path);
      set((st) => ({
        buffers: {
          ...st.buffers,
          [bufferId]: {
            ...buf,
            path,
            name,
            dirty: false,
            diskChanged: false,
            deleted: false,
            langId: renamed && !buf.path ? detectLanguage(name) : buf.langId,
          },
        },
        panes: renamed
          ? st.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.bufferId === bufferId && t.kind === "text" ? { ...t, path, title: name } : t)) }))
          : st.panes,
      }));
      void useWorkspace.getState().refreshPaths([path]);
      return true;
    },

    async saveAll() {
      for (const b of Object.values(get().buffers)) if (b.dirty) await get().save(b.id);
    },

    async revert(bufferId) {
      const b = get().buffers[bufferId];
      if (!b?.path) return;
      try {
        const file = await backend().readFile(b.path);
        docHub.setText(bufferId, file.content, { markSaved: true });
        set((s) => ({ buffers: { ...s.buffers, [bufferId]: { ...s.buffers[bufferId], diskChanged: false, lineEnding: file.lineEnding, bom: file.bom } } }));
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },

    setLanguage(bufferId, langId) {
      set((s) => ({ buffers: { ...s.buffers, [bufferId]: { ...s.buffers[bufferId], langId } } }));
    },

    setLineEnding(bufferId, le) {
      const b = get().buffers[bufferId];
      if (!b || b.lineEnding === le) return;
      set((s) => ({ buffers: { ...s.buffers, [bufferId]: { ...b, lineEnding: le, dirty: true } } }));
    },

    consumeReveal(bufferId) {
      const r = get().pendingReveal[bufferId];
      if (r) {
        set((s) => {
          const next = { ...s.pendingReveal };
          delete next[bufferId];
          return { pendingReveal: next };
        });
      }
      return r;
    },

    async onDiskChange(paths) {
      for (const b of Object.values(get().buffers)) {
        if (!b.path || !paths.some((p) => samePath(p, b.path!))) continue;
        let file;
        try {
          file = await backend().readFile(b.path);
        } catch {
          if (!(await backend().exists(b.path))) get().onPathDeleted(b.path);
          continue;
        }
        if (file.binary || file.content.replace(/\r\n/g, "\n") === docHub.text(b.id)) continue;
        if (b.dirty) set((s) => ({ buffers: { ...s.buffers, [b.id]: { ...s.buffers[b.id], diskChanged: true } } }));
        else docHub.setText(b.id, file.content, { markSaved: true });
      }
    },

    onPathRenamed(from, to) {
      set((s) => ({
        buffers: Object.fromEntries(
          Object.entries(s.buffers).map(([id, b]) => {
            const np = b.path ? rebase(b.path, from, to) : null;
            return [id, np ? { ...b, path: np, name: basename(np), deleted: false } : b];
          }),
        ),
        panes: s.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) => {
            const np = t.path ? rebase(t.path, from, to) : null;
            if (!np) return t;
            const name = basename(np);
            const title = t.kind === "preview" ? `Preview ${name}` : t.kind === "diff" ? `${name} (Working Tree)` : name;
            return { ...t, path: np, title };
          }),
        })),
      }));
    },

    onPathDeleted(path) {
      set((s) => ({
        buffers: Object.fromEntries(
          Object.entries(s.buffers).map(([id, b]) => [id, b.path && isInside(path, b.path) ? { ...b, deleted: true } : b]),
        ),
      }));
    },

    reset() {
      for (const id of Object.keys(get().buffers)) docHub.dispose(id);
      const p = emptyPane();
      set({ buffers: {}, panes: [p], layout: leaf(p.id), activePaneId: p.id, closed: [], pendingReveal: {} });
    },
  };
});

// Whoever adds or removes a group (here, the session restore, tests), the layout
// follows: gone panes leave the tree, unknown ones join on the right, and
// `panes` is kept in reading order.
useEditor.subscribe((s, prev) => {
  if (s.panes === prev.panes && s.layout === prev.layout) return;
  const layout = syncLayout(s.layout, s.panes.map((p) => p.id));
  const order = leafIds(layout);
  const inOrder = order.length === s.panes.length && order.every((id, i) => s.panes[i].id === id);
  const panes = inOrder ? s.panes : order.map((id) => s.panes.find((p) => p.id === id)!);
  if (layout !== s.layout || panes !== s.panes) useEditor.setState({ layout, panes });
});

/** Active pane's active tab and its buffer. */
export function activeTabInfo(s = useEditor.getState()) {
  const pane = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
  const tab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null;
  const buffer = tab?.bufferId ? s.buffers[tab.bufferId] ?? null : null;
  return { pane, tab, buffer };
}

export function useActiveTab() {
  return useEditor((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
    return pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null;
  });
}

export function useActiveBuffer() {
  return useEditor((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0];
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
    return tab?.bufferId ? s.buffers[tab.bufferId] ?? null : null;
  });
}
