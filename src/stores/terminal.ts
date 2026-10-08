import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { backend } from "@/lib/backend";
import { basename, join } from "@/lib/path";
import { useSettings, findTheme } from "./settings";
import { terminalTheme } from "@/themes/apply";
import { useWorkspace } from "./workspace";
import { useProject } from "./project";
import { errorMessage, toast, useUi } from "./ui";
import type { ShellProfile } from "@/lib/types";

export interface TermInfo {
  id: string;
  ptyId: number | null;
  title: string;
  cwd: string;
  exited: boolean;
  /** Profile it was started with (empty for a custom command line). */
  profileId: string;
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
    if (s.themeId === prev.themeId && s.customThemes === prev.customThemes && s.terminalFontSize === prev.terminalFontSize && s.terminalCursor === prev.terminalCursor && s.fontFamily === prev.fontFamily) return;
    const theme = terminalTheme(findTheme(s.themeId, s));
    for (const l of live.values()) {
      l.term.options.theme = theme;
      l.term.options.fontSize = s.terminalFontSize;
      l.term.options.cursorStyle = s.terminalCursor;
      l.term.options.fontFamily = s.fontFamily;
      try {
        l.fit.fit();
      } catch {
        /* hidden */
      }
    }
  });
}

interface TerminalState {
  terms: TermInfo[];
  activeId: string | null;
  /** Detected shells; loaded once, the system default first. */
  shells: ShellProfile[];
  loadShells(): Promise<ShellProfile[]>;
  /** Opens a terminal with a profile id, or the default from settings. */
  create(cwd?: string, profileId?: string): Promise<string | null>;
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

  async create(cwd, profileId) {
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
      fontSize: s.terminalFontSize,
      cursorStyle: s.terminalCursor,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: terminalTheme(findTheme(s.themeId, s)),
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const host = document.createElement("div");
    host.style.cssText = "width:100%;height:100%;";
    // term.open() happens when the view first attaches the host to the DOM.
    live.set(id, { term, fit, host });

    const title = profile?.name ?? (custom ? basename(custom.split(" ")[0]).replace(/\.exe$/i, "") : "shell");
    const info: TermInfo = { id, ptyId: null, title, cwd: dir, exited: false, profileId: profile?.id ?? "" };
    set((st) => ({ terms: [...st.terms, info], activeId: id }));
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
      return { terms, activeId: s.activeId === id ? terms[terms.length - 1]?.id ?? null : s.activeId };
    });
    if (!get().terms.length) useUi.getState().togglePanel(false);
  },

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
