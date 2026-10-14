import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { backend } from "@/lib/backend";
import { basename, join } from "@/lib/path";
import { useSettings, findTheme, type SettingsState } from "./settings";
import { terminalTheme } from "@/themes/apply";
import { useWorkspace } from "./workspace";
import { useProject } from "./project";
import { errorMessage, toast, useUi } from "./ui";
import type { ShellProfile } from "@/lib/types";
import { clipboardKeys, terminalLinkProvider } from "@/terminal/links";

export interface TermInfo {
  id: string;
  ptyId: number | null;
  title: string;
  cwd: string;
  exited: boolean;
  /** Profile it was started with (empty for a custom command line). */
  profileId: string;
  /** Terminals sharing a group show side by side under one tab (a split). */
  group: string;
  /** Share of the group's width. */
  weight: number;
}

export type DropSide = "before" | "after";

/** Groups in tab order, each with its terminals left to right. */
export function termGroups(terms: TermInfo[]): Array<{ id: string; terms: TermInfo[] }> {
  const out: Array<{ id: string; terms: TermInfo[] }> = [];
  for (const t of terms) {
    const g = out.find((x) => x.id === t.group);
    if (g) g.terms.push(t);
    else out.push({ id: t.group, terms: [t] });
  }
  return out;
}

/** Moves `moving` (in their order) next to `target`, into its group. */
function placeNext(terms: TermInfo[], moving: string[], target: string, side: DropSide): TermInfo[] {
  const group = terms.find((t) => t.id === target)?.group;
  if (!group || moving.includes(target)) return terms;
  const moved = moving.map((id) => terms.find((t) => t.id === id)!).filter(Boolean).map((t) => ({ ...t, group, weight: 1 }));
  const rest = terms.filter((t) => !moving.includes(t.id)).map((t) => (t.group === group ? { ...t, weight: 1 } : t));
  const i = rest.findIndex((t) => t.id === target) + (side === "after" ? 1 : 0);
  return [...rest.slice(0, i), ...moved, ...rest.slice(i)];
}

/**
 * xterm instances live outside React: hiding the panel or switching tabs
 * keeps scrollback, and the host element is re-attached when shown again.
 */
interface Live {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
}
const live = new Map<string, Live>();
const byPty = new Map<number, string>();
/** Output that arrived before ptySpawn resolved (ConPTY asks for the cursor position right away). */
const early = new Map<number, string[]>();
/** Writes and resizes per pty, in order: the async IPC may otherwise reorder keystrokes. */
const queues = new Map<number, Promise<unknown>>();
const enqueue = (ptyId: number, job: () => Promise<unknown>) => {
  const next = (queues.get(ptyId) ?? Promise.resolve()).then(job).catch(() => {});
  queues.set(ptyId, next);
  return next;
};
let wired = false;

/**
 * xterm measures in unzoomed pixels: inside the app's CSS zoom it maps the
 * mouse to the wrong cells (selection lands off to the side). The terminal
 * host cancels the zoom (index.css), so the font is scaled here instead.
 */
/** The theme's terminal colors; with a see-through window the panel behind paints the background. */
const termTheme = (s: SettingsState) => {
  const t = terminalTheme(findTheme(s.themeId, s));
  return s.windowOpacity < 100 ? { ...t, background: "rgba(0, 0, 0, 0)" } : t;
};

const termFontSize = (s: { terminalFontSize: number; uiScale: number }) => Math.round(s.terminalFontSize * (s.uiScale || 1) * 100) / 100;
let seq = 0;

function wire() {
  if (wired) return;
  wired = true;
  const b = backend();
  b.onData((ptyId, data) => {
    const id = byPty.get(ptyId);
    if (id) live.get(id)?.term.write(data);
    else early.set(ptyId, [...(early.get(ptyId) ?? []), data]);
  });
  b.onExit((ptyId) => {
    const id = byPty.get(ptyId);
    if (!id) return;
    byPty.delete(ptyId);
    queues.delete(ptyId);
    live.get(id)?.term.write("\r\n\x1b[2m[process exited — press any key to close]\x1b[0m\r\n");
    useTerminal.setState((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, exited: true } : t)) }));
  });
  // Repaint every terminal when the theme or font changes.
  useSettings.subscribe((s, prev) => {
    if (s.themeId === prev.themeId && s.customThemes === prev.customThemes && s.terminalFontSize === prev.terminalFontSize && s.uiScale === prev.uiScale && s.windowOpacity === prev.windowOpacity && s.terminalCursor === prev.terminalCursor && s.fontFamily === prev.fontFamily) return;
    const theme = termTheme(s);
    for (const l of live.values()) {
      l.term.options.theme = theme;
      l.term.options.fontSize = termFontSize(s);
      l.term.options.cursorStyle = s.terminalCursor;
      l.term.options.fontFamily = s.fontFamily;
    }
    // Re-fit once the new UI scale is on the page (it's applied after this render),
    // or the column count is measured against the old zoom.
    setTimeout(() => {
      for (const l of live.values()) {
        try {
          l.fit.fit();
        } catch {
          /* hidden */
        }
      }
    }, 50);
  });
}

interface TerminalState {
  terms: TermInfo[];
  activeId: string | null;
  /** Detected shells; loaded once, the system default first. */
  shells: ShellProfile[];
  loadShells(): Promise<ShellProfile[]>;
  /** Opens a terminal with a profile id, or the default from settings. */
  create(cwd?: string, profileId?: string, opts?: { group?: string; after?: string }): Promise<string | null>;
  /** A new terminal next to `id` (the active one), same shell and folder. */
  split(id?: string): Promise<string | null>;
  /** Moves a terminal next to another one, splitting that group. */
  place(id: string, target: string, side: DropSide): void;
  /** Moves a whole tab (group) next to a terminal, splitting it. */
  placeGroup(group: string, target: string, side: DropSide): void;
  /** Takes a terminal out of its split into a tab of its own (at tab `index`). */
  detach(id: string, index?: number): void;
  /** Resizes two neighbours of a split. */
  resize(a: string, wa: number, b: string, wb: number): void;
  kill(id: string): Promise<void>;
  activate(id: string): void;
  rename(id: string, title: string): void;
  live(id: string): Live | undefined;
  sendText(text: string): Promise<void>;
}

let shellsLoading: Promise<ShellProfile[]> | null = null;

/** `terminalProfile` value meaning "run the command line from settings". */
export const CUSTOM_PROFILE = "custom";

export const useTerminal = create<TerminalState>((set, get) => ({
  terms: [],
  activeId: null,
  shells: [],

  loadShells() {
    shellsLoading ??= backend()
      .listShells()
      .catch(() => [] as ShellProfile[])
      .then((shells) => {
        set({ shells });
        return shells;
      });
    return shellsLoading;
  },

  async create(cwd, profileId, opts) {
    wire();
    const s = useSettings.getState();
    // An explicit pick wins, then the default profile, then the custom command line.
    const shells = await get().loadShells();
    const pick = profileId ?? (s.terminalProfile || (s.terminalShell.trim() ? CUSTOM_PROFILE : ""));
    let profile = shells.find((p) => p.id === pick) ?? null;
    const custom = pick === CUSTOM_PROFILE ? s.terminalShell.trim() : "";
    if (!profile && !custom) profile = shells[0] ?? null;
    const root = useWorkspace.getState().root;
    const projectCwd = useProject.getState().settings.terminalCwd?.trim();
    const dir = cwd ?? (root && projectCwd ? join(root, projectCwd) : root) ?? "";
    const id = `term-${++seq}`;
    const term = new Terminal({
      fontFamily: s.fontFamily,
      fontSize: termFontSize(s),
      cursorStyle: s.terminalCursor,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: termTheme(s),
      // A see-through window shows through the terminal too.
      allowTransparency: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.attachCustomKeyEventHandler(clipboardKeys(term));
    term.registerLinkProvider(terminalLinkProvider(term, () => get().terms.find((t) => t.id === id)?.cwd ?? dir));
    const host = document.createElement("div");
    host.style.cssText = "width:100%;height:100%;";
    // term.open() happens when the view first attaches the host to the DOM.
    live.set(id, { term, fit, host });

    const title = profile?.name ?? (custom ? basename(custom.split(" ")[0]).replace(/\.exe$/i, "") : "shell");
    const info: TermInfo = { id, ptyId: null, title, cwd: dir, exited: false, profileId: profile?.id ?? "", group: opts?.group ?? id, weight: 1 };
    set((st) => {
      const at = opts?.after ? st.terms.findIndex((t) => t.id === opts.after) + 1 : 0;
      // A split: the group's panes share the width equally again.
      const terms = opts?.group ? st.terms.map((t) => (t.group === opts.group ? { ...t, weight: 1 } : t)) : st.terms;
      return { terms: at > 0 ? [...terms.slice(0, at), info, ...terms.slice(at)] : [...terms, info], activeId: id };
    });
    useUi.getState().togglePanel(true);

    try {
      const ptyId = await backend().ptySpawn(dir, term.cols || 80, term.rows || 24, profile?.program ?? (custom || undefined), profile?.args);
      if (!live.has(id)) {
        // Closed while the shell was starting.
        void backend().ptyKill(ptyId).catch(() => {});
        return null;
      }
      byPty.set(ptyId, id);
      for (const chunk of early.get(ptyId) ?? []) term.write(chunk);
      early.delete(ptyId);
      set((st) => ({ terms: st.terms.map((t) => (t.id === id ? { ...t, ptyId } : t)) }));
      term.onData((data) => {
        const t = get().terms.find((x) => x.id === id);
        if (t?.exited) {
          void get().kill(id);
          return;
        }
        void enqueue(ptyId, () => backend().ptyWrite(ptyId, data));
      });
      term.onResize(({ cols, rows }) => void enqueue(ptyId, () => backend().ptyResize(ptyId, cols, rows)));
      // Catch up with a fit that happened while the shell was starting.
      if (term.cols && term.rows) void enqueue(ptyId, () => backend().ptyResize(ptyId, term.cols, term.rows));
      // Windows shells set the title to their own exe path; the profile name reads better.
      term.onTitleChange((t) => t && !/\.exe$/i.test(t.trim()) && get().rename(id, t.slice(0, 40)));
    } catch (e) {
      term.write(`\x1b[31mCould not start the shell: ${errorMessage(e)}\x1b[0m\r\n`);
      toast("Terminal failed to start", "error", errorMessage(e));
    }
    return id;
  },

  async kill(id) {
    const t = get().terms.find((x) => x.id === id);
    if (t?.ptyId != null) {
      const ptyId = t.ptyId;
      byPty.delete(ptyId);
      queues.delete(ptyId);
      // Not awaited: the tab closes at once even if the shell takes a moment to die.
      void backend().ptyKill(ptyId).catch(() => {});
    }
    const l = live.get(id);
    l?.term.dispose();
    l?.host.remove();
    live.delete(id);
    set((s) => {
      const terms = s.terms.filter((x) => x.id !== id);
      if (s.activeId !== id) return { terms };
      // Prefer a neighbour in the same split, then the last tab.
      const sibling = terms.filter((x) => x.group === t?.group);
      const i = s.terms.findIndex((x) => x.id === id);
      const next = sibling.find((x) => s.terms.indexOf(x) > i) ?? sibling.at(-1) ?? terms.at(-1);
      return { terms, activeId: next?.id ?? null };
    });
    if (!get().terms.length) useUi.getState().togglePanel(false);
  },

  async split(id) {
    const from = get().terms.find((t) => t.id === (id ?? get().activeId));
    if (!from) return get().create();
    return get().create(from.cwd || undefined, from.profileId || undefined, { group: from.group, after: from.id });
  },

  place: (id, target, side) => set((s) => ({ terms: placeNext(s.terms, [id], target, side), activeId: id })),

  placeGroup: (group, target, side) =>
    set((s) => {
      const moving = s.terms.filter((t) => t.group === group).map((t) => t.id);
      return { terms: placeNext(s.terms, moving, target, side), activeId: moving.includes(s.activeId ?? "") ? s.activeId : moving[0] ?? s.activeId };
    }),

  detach: (id, index) =>
    set((s) => {
      const t = s.terms.find((x) => x.id === id);
      if (!t) return {};
      const rest = s.terms.filter((x) => x.id !== id).map((x) => (x.group === t.group ? { ...x, weight: 1 } : x));
      const mine = { ...t, group: `${id}-${++seq}`, weight: 1 };
      // Tab `index`: before the first terminal of the group now at that position.
      const groups = termGroups(rest);
      const before = index !== undefined && index < groups.length ? rest.indexOf(groups[index].terms[0]) : rest.length;
      return { terms: [...rest.slice(0, before), mine, ...rest.slice(before)], activeId: id };
    }),

  resize: (a, wa, b, wb) => set((s) => ({ terms: s.terms.map((t) => (t.id === a ? { ...t, weight: wa } : t.id === b ? { ...t, weight: wb } : t)) })),

  activate: (id) => set({ activeId: id }),
  rename: (id, title) => set((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, title } : t)) })),
  live: (id) => live.get(id),

  async sendText(text) {
    let id = get().activeId;
    if (!id) id = await get().create();
    const t = get().terms.find((x) => x.id === id);
    if (t?.ptyId != null) {
      const ptyId = t.ptyId;
      await enqueue(ptyId, () => backend().ptyWrite(ptyId, text));
    }
  },
}));
