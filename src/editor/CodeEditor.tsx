import { useEffect, useRef, useState } from "react";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { docHub, syncAnnotation } from "./docHub";
import { baseExtensions, pickEditorSettings, settingsExtensions } from "./setup";
import { languageById } from "./languages";
import { viewRegistry } from "./viewRegistry";
import { editorExtensionsFor, isExtEnabled } from "@/extensions/registry";
import { countWords, setGitBase } from "@/extensions/editorFeatures";
import { useEditor, type Buffer } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { useCursor } from "@/stores/cursor";
import { useWorkspace } from "@/stores/workspace";
import { useProject } from "@/stores/project";
import { backend } from "@/lib/backend";
import { relative } from "@/lib/path";
import type { MenuItem } from "@/components/ui/Menus";
import { EditorMenu, editorMenuItems, placeCaretForMenu } from "./EditorMenu";

const langComp = new Compartment();
const extComp = new Compartment();
const settingsComp = new Compartment();

/** Saved state per pane + buffer: undo history, selection and scroll survive tab switches. */
const states = new Map<string, { state: EditorState; scroll: number }>();
const langCache = new Map<string, Extension>();
const gitLoaded = new Set<string>();

export function forgetBufferStates(bufferId: string) {
  for (const k of [...states.keys()]) if (k.endsWith(":" + bufferId)) states.delete(k);
  gitLoaded.delete(bufferId);
  setGitBase(bufferId, undefined);
}

function languageExtension(langId: string, onLoaded: () => void): Extension {
  const def = languageById(langId);
  if (!def || !isExtEnabled(`lang-${langId}`)) return [];
  const hit = langCache.get(langId);
  if (hit) return hit;
  void def
    .load()
    .then((ext) => {
      langCache.set(langId, ext);
      onLoaded();
    })
    .catch((e) => console.error(`Language ${langId} failed to load`, e));
  return [];
}

async function loadGitBase(buffer: Buffer) {
  const root = useWorkspace.getState().root;
  if (!buffer.path || !root || gitLoaded.has(buffer.id)) return;
  const rel = relative(root, buffer.path);
  if (rel === null || !useWorkspace.getState().git?.isRepo) return;
  gitLoaded.add(buffer.id);
  const tracked = await backend().gitHeadContent(root, rel).catch(() => null);
  const untracked = useWorkspace.getState().git?.files.some((f) => f.path === rel && f.status === "?");
  // Untracked files have no base: no markers (VS Code shows them as all-new).
  setGitBase(buffer.id, tracked ?? (untracked ? null : undefined));
}

/** Re-reads HEAD for open buffers after a commit / checkout. */
export function invalidateGitBases() {
  for (const id of [...gitLoaded]) {
    gitLoaded.delete(id);
    const b = useEditor.getState().buffers[id];
    if (b) void loadGitBase(b);
  }
}

export function CodeEditor({ paneId, buffer, active }: { paneId: string; buffer: Buffer; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);

  const reportCursor = (view: EditorView) => {
    if (!activeRef.current) return;
    const st = view.state;
    const main = st.selection.main;
    const line = st.doc.lineAt(main.head);
    const selected = st.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
    const words =
      isExtEnabled("word-count") && (buffer.langId === "markdown" || buffer.langId === "plaintext")
        ? countWords(selected ? st.selection.ranges.map((r) => st.sliceDoc(r.from, r.to)).join(" ") : st.doc.toString())
        : null;
    const cm = isExtEnabled("vim") ? getCM(view) : null;
    const vimState = (cm as unknown as { state?: { vim?: { mode?: string; insertMode?: boolean; visualMode?: boolean } } } | null)?.state?.vim;
    const vimMode = vimState ? (vimState.insertMode ? "INSERT" : vimState.visualMode ? "VISUAL" : "NORMAL") : null;
    useCursor.getState().set({ line: line.number, col: main.head - line.from + 1, selections: st.selection.ranges.length, selected, lines: st.doc.lines, words, vimMode });
  };

  const configure = (b: Buffer, onLangLoaded: () => void): Extension[] => {
    const s = useSettings.getState();
    return [
      langComp.of(languageExtension(b.langId, onLangLoaded)),
      extComp.of(editorExtensionsFor({ bufferId: b.id, langId: b.langId, path: b.path })),
      settingsComp.of(settingsExtensions(pickEditorSettings(s, b))),
    ];
  };

  const makeState = (b: Buffer, view: () => EditorView | null): EditorState =>
    EditorState.create({
      doc: docHub.doc(b.id),
      extensions: [
        ...baseExtensions(),
        ...configure(b, () => reconfigureLanguage(view(), b)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            for (const tr of u.transactions) {
              if (tr.docChanged && !tr.annotation(syncAnnotation)) docHub.propagate(b.id, u.view, tr);
            }
          }
          if (u.docChanged || u.selectionSet || u.focusChanged) reportCursor(u.view);
          if (u.focusChanged && u.view.hasFocus) useEditor.getState().focusPane(paneId);
        }),
      ],
    });

  const reconfigureLanguage = (view: EditorView | null, b: Buffer) => {
    if (!view || shownRef.current !== b.id) return;
    view.dispatch({ effects: langComp.reconfigure(languageExtension(b.langId, () => {})) });
  };

  const reconfigureAll = (view: EditorView, b: Buffer) => {
    const s = useSettings.getState();
    view.dispatch({
      effects: [
        langComp.reconfigure(languageExtension(b.langId, () => reconfigureLanguage(viewRef.current, b))),
        extComp.reconfigure(editorExtensionsFor({ bufferId: b.id, langId: b.langId, path: b.path })),
        settingsComp.reconfigure(settingsExtensions(pickEditorSettings(s, b))),
      ],
    });
  };

  const applyReveal = (view: EditorView, bufferId: string) => {
    const r = useEditor.getState().consumeReveal(bufferId);
    if (!r) return;
    const doc = view.state.doc;
    const line = doc.line(Math.max(1, Math.min(r.line, doc.lines)));
    const from = Math.min(line.from + (r.col ?? 0), line.to);
    const to = Math.min(from + (r.len ?? 0), line.to);
    view.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: "center" }) });
  };

  // Create the view once per pane.
  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current! });
    viewRef.current = view;
    viewRegistry.set(paneId, view);
    return () => {
      const shown = shownRef.current;
      if (shown) {
        states.set(`${paneId}:${shown}`, { state: view.state, scroll: view.scrollDOM.scrollTop });
        docHub.detach(shown, view);
      }
      viewRegistry.set(paneId, null);
      view.destroy();
      viewRef.current = null;
      shownRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Swap the buffer shown in this pane.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const prev = shownRef.current;
    if (prev === buffer.id) return;
    if (prev) {
      states.set(`${paneId}:${prev}`, { state: view.state, scroll: view.scrollDOM.scrollTop });
      docHub.detach(prev, view);
    }
    const key = `${paneId}:${buffer.id}`;
    const cached = states.get(key);
    let scroll = 0;
    if (cached && cached.state.doc === docHub.doc(buffer.id)) {
      view.setState(cached.state);
      reconfigureAll(view, buffer);
      scroll = cached.scroll;
    } else {
      // The text changed elsewhere (other pane, reload): rebuild, keep the caret nearby.
      const state = makeState(buffer, () => viewRef.current);
      view.setState(state);
      if (cached) {
        const head = Math.min(cached.state.selection.main.head, state.doc.length);
        view.dispatch({ selection: { anchor: head } });
        scroll = cached.scroll;
      }
    }
    shownRef.current = buffer.id;
    docHub.attach(buffer.id, view);
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = scroll;
      applyReveal(view, buffer.id);
    });
    if (activeRef.current) reportCursor(view);
    void loadGitBase(buffer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.id, paneId]);

  // Language changed from the status bar.
  useEffect(() => {
    const view = viewRef.current;
    if (view && shownRef.current === buffer.id) reconfigureAll(view, buffer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.langId]);

  // Settings or extensions changed: reconfigure live.
  useEffect(
    () =>
      useSettings.subscribe((s, p) => {
        const view = viewRef.current;
        if (!view || !shownRef.current) return;
        const relevant =
          s.extEnabled !== p.extEnabled ||
          s.extSettings !== p.extSettings ||
          s.tabSize !== p.tabSize ||
          s.insertSpaces !== p.insertSpaces ||
          s.wordWrap !== p.wordWrap ||
          s.lineNumbers !== p.lineNumbers ||
          s.highlightActiveLine !== p.highlightActiveLine ||
          s.renderWhitespace !== p.renderWhitespace ||
          s.cursorStyle !== p.cursorStyle ||
          s.cursorBlink !== p.cursorBlink ||
          s.scrollPastEnd !== p.scrollPastEnd ||
          s.bracketMatching !== p.bracketMatching;
        if (!relevant) return;
        const b = useEditor.getState().buffers[shownRef.current];
        if (b) reconfigureAll(view, b);
        // Font metrics may have changed.
        view.requestMeasure();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Project settings (.nox/settings.json, .editorconfig) changed.
  useEffect(
    () =>
      useProject.subscribe((s, p) => {
        const view = viewRef.current;
        if (!view || !shownRef.current || s.version === p.version) return;
        const b = useEditor.getState().buffers[shownRef.current];
        if (b) reconfigureAll(view, b);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Jump requests (search results, go to line) for the shown buffer.
  const reveal = useEditor((s) => s.pendingReveal[buffer.id]);
  useEffect(() => {
    const view = viewRef.current;
    if (view && reveal && shownRef.current === buffer.id) applyReveal(view, buffer.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // Focus requests.
  const focusNonce = useEditor((s) => s.focusNonce);
  useEffect(() => {
    if (active) requestAnimationFrame(() => viewRef.current?.focus());
  }, [focusNonce, active]);

  useEffect(() => {
    if (active && viewRef.current) reportCursor(viewRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <div
        ref={hostRef}
        className="h-full min-h-0 w-full"
        data-testid="code-editor"
        onContextMenu={(e) => {
          const view = viewRef.current;
          e.preventDefault();
          if (!view || !(e.target as HTMLElement).closest(".cm-content, .cm-line, .cm-scroller")) return;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
          placeCaretForMenu(view, pos);
          view.focus();
          setMenu({ at: { x: e.clientX, y: e.clientY }, items: editorMenuItems(view, buffer.langId, pos) });
        }}
      />
      <EditorMenu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </>
  );
}
