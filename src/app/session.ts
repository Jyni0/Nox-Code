/** Last folder + open tabs, restored on the next start. */
import { useEditor, type TabKind } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { backend } from "@/lib/backend";

const KEY = "nox.session";

interface SavedPane {
  tabs: Array<{ path: string; kind: TabKind }>;
  active: number;
}

interface Session {
  root: string | null;
  panes: SavedPane[];
  activePane: number;
}

export function saveSession() {
  const { panes, activePaneId } = useEditor.getState();
  const s: Session = {
    root: useWorkspace.getState().root,
    panes: panes.map((p) => {
      const tabs = p.tabs.filter((t) => t.path && (t.kind === "text" || t.kind === "image")).map((t) => ({ path: t.path!, kind: t.kind }));
      const active = p.tabs.filter((t) => t.path && (t.kind === "text" || t.kind === "image")).findIndex((t) => t.id === p.activeTabId);
      return { tabs, active };
    }),
    activePane: Math.max(0, panes.findIndex((p) => p.id === activePaneId)),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function restoreTabs(s: Session) {
  const ed = useEditor.getState();
  for (let i = 0; i < s.panes.length; i++) {
    const p = s.panes[i];
    if (!p.tabs.length) continue;
    if (i > 0) ed.splitRight();
    // splitRight copies the active tab; start the new group clean.
    const pane = useEditor.getState().panes[Math.min(i, useEditor.getState().panes.length - 1)];
    if (i > 0) useEditor.setState((st) => ({ panes: st.panes.map((x) => (x.id === pane.id ? { ...x, tabs: [], activeTabId: null, mru: [] } : x)) }));
    for (const t of p.tabs) {
      if (await backend().exists(t.path)) await useEditor.getState().openFile(t.path, { paneId: pane.id, focus: false });
    }
    const cur = useEditor.getState().panes.find((x) => x.id === pane.id);
    const target = cur?.tabs.find((t) => t.path === p.tabs[p.active]?.path);
    if (cur && target) useEditor.getState().activateTab(cur.id, target.id);
  }
  // Drop empty groups left by missing files.
  useEditor.setState((st) => {
    const panes = st.panes.filter((p, i) => p.tabs.length || i === 0);
    return { panes, activePaneId: panes[Math.min(s.activePane, panes.length - 1)]?.id ?? panes[0].id };
  });
}
