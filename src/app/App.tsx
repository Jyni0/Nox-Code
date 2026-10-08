import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Minimize2 } from "lucide-react";
import { backend, inTauri } from "@/lib/backend";
import { eventToCombo, keyState } from "@/lib/keys";
import { basename } from "@/lib/path";
import { appWindow } from "@/lib/window";
import { commandForCombo, runCommand } from "@/core/commands";
import { docHub } from "@/editor/docHub";
import { forgetBufferStates } from "@/editor/CodeEditor";
import { viewRegistry } from "@/editor/viewRegistry";
import { applyTheme } from "@/themes/apply";
import { isExtEnabled } from "@/extensions/registry";
import { canFormat, formatOnSaveFor, formatText, prettierOptionsFor } from "@/extensions/prettier";
import { registerSaveHook, useEditor } from "@/stores/editor";
import { findTheme, useActiveTheme, useSettings } from "@/stores/settings";
import { useWindowEdges } from "@/components/layout/islands";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { useProject } from "@/stores/project";
import { startUpdateChecks } from "@/stores/updates";
import { reindexPaths } from "@/editor/intel";
import { TitleBar } from "@/components/layout/TitleBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { EditorArea } from "@/components/editor/EditorArea";
import { TerminalPanel } from "@/components/panel/TerminalPanel";
import { Palette } from "@/components/overlays/Palette";
import { DialogHost, Toasts } from "@/components/overlays/Overlays";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { cx } from "@/components/ui";
import { registerAppCommands } from "./commands";
import { loadSession, restoreTabs, saveSession } from "./session";

const STROKE = { thin: "1.25", regular: "1.6", bold: "2.1" } as const;

/** Theme, fonts, zoom and icon weight → CSS variables. */
/**
 * Line height in whole device pixels. A fractional one (14px × 1.6 at 125 %
 * display scaling, or with the UI zoom) makes every line box end mid-pixel;
 * the indent guides, drawn per line, then show seams and look dashed.
 */
function snappedLineHeight(fontSize: number, ratio: number, zoom: number): string {
  const device = (window.devicePixelRatio || 1) * (zoom || 1);
  return `${Math.max(1, Math.round(fontSize * ratio * device)) / device}px`;
}

/** Re-renders when the window moves to a screen with another scaling. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [dpr]);
  return dpr;
}

function useAppearance() {
  const theme = useActiveTheme();
  const s = useSettings();
  const dpr = useDevicePixelRatio();
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--editor-font", s.fontFamily);
    st.setProperty("--editor-font-size", `${s.fontSize}px`);
    st.setProperty("--editor-line-height", snappedLineHeight(s.fontSize, s.lineHeight, s.uiScale));
    st.setProperty("--editor-ligatures", s.ligatures ? "contextual" : "none");
    st.setProperty("--editor-features", s.ligatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0');
    st.setProperty("--font-ui", `${s.uiFont}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`);
    st.setProperty("--icon-stroke", STROKE[s.iconWeight]);
    requestAnimationFrame(() => viewRegistry.all().forEach((v) => v.requestMeasure()));
  }, [s.fontFamily, s.fontSize, s.lineHeight, s.ligatures, s.uiFont, s.iconWeight, s.uiScale, dpr]);
  // Follow the OS light / dark setting.
  useEffect(() => {
    if (!s.followSystem) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => useSettings.getState().set("themeId", mq.matches ? useSettings.getState().darkThemeId : useSettings.getState().lightThemeId);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [s.followSystem, s.lightThemeId, s.darkThemeId]);
}

/** Global shortcuts, resolved before CodeMirror / xterm see the key. */
/**
 * Browser actions that must never fire inside the editor. Keys CodeMirror
 * itself uses (Ctrl+F, Ctrl+G, Ctrl+D…) are left alone so its handlers run.
 */
const BROWSER_SHORTCUTS = new Set([
  "F5", "Ctrl+R", "Ctrl+Shift+R", "Ctrl+F5", "F7", "Ctrl+P", "Ctrl+Shift+P", "Ctrl+S", "Ctrl+Shift+S", "Ctrl+O", "Ctrl+N",
  "Ctrl+Shift+N", "Ctrl+T", "Ctrl+Shift+T", "Ctrl+J", "Ctrl+U", "Ctrl+Shift+O", "Ctrl+Shift+B", "Ctrl+Shift+Delete", "Ctrl+=", "Ctrl+-", "Ctrl+0",
]);

function useKeybindings() {
  // Ctrl+wheel would zoom the whole page; the editor has its own zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => e.ctrlKey && e.preventDefault();
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyState.recording || e.isComposing) return;
      const combo = eventToCombo(e);
      if (!combo) return;
      const hasMod = e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(combo.split("+").pop()!);
      if (!hasMod) return;
      const inTerminal = e.target instanceof Element && !!e.target.closest(".xterm");
      const cmd = commandForCombo(combo, inTerminal);
      if (!cmd) {
        // Unbound, but the browser would reload / print / open a window. The
        // terminal keeps them: Ctrl+R, Ctrl+P, Ctrl+U… mean something to shells.
        if (!inTerminal && BROWSER_SHORTCUTS.has(combo)) e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void runCommand(cmd.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

function useAutoSave() {
  const mode = useSettings((s) => s.autoSave);
  const delay = useSettings((s) => s.autoSaveDelay);
  useEffect(() => {
    if (mode !== "afterDelay") return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const un = docHub.onAnyChange((id) => {
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => {
          const b = useEditor.getState().buffers[id];
          if (b?.dirty && b.path) void useEditor.getState().save(id);
        }, delay),
      );
    });
    return () => {
      un();
      timers.forEach(clearTimeout);
    };
  }, [mode, delay]);
  useEffect(() => {
    if (mode !== "onFocusChange") return;
    const saveClean = () => {
      for (const b of Object.values(useEditor.getState().buffers)) if (b.dirty && b.path) void useEditor.getState().save(b.id);
    };
    window.addEventListener("blur", saveClean);
    const un = useEditor.subscribe((s, p) => s.activePaneId !== p.activePaneId && saveClean());
    return () => {
      window.removeEventListener("blur", saveClean);
      un();
    };
  }, [mode]);
}

/** Startup: commands, save hooks, watcher wiring, session restore. */
let booted = false;

function useBoot() {
  const [ready, setReady] = useState(booted);
  useEffect(() => {
    // StrictMode runs effects twice in development; boot exactly once.
    if (booted) return;
    booted = true;
    registerAppCommands();
    const unHook = registerSaveHook(async (buf, text) => {
      if (!isExtEnabled("prettier") || !canFormat(buf.langId) || !formatOnSaveFor(buf.path, buf.langId)) return null;
      const { formatted } = await formatText(text, buf.langId, prettierOptionsFor(buf.path, buf.langId));
      return formatted;
    });
    const unFs = backend().onFsChange((paths) => {
      void useWorkspace.getState().refreshPaths(paths);
      useProject.getState().onDiskChange(paths);
      reindexPaths(paths);
      void useEditor.getState().onDiskChange(paths.filter((p) => p !== ".git"));
    });
    // Forget editor state of closed buffers.
    const unBuf = useEditor.subscribe((s, p) => {
      if (s.buffers === p.buffers) return;
      for (const id of Object.keys(p.buffers)) if (!s.buffers[id]) forgetBufferStates(id);
    });
    let saveTimer: ReturnType<typeof setTimeout>;
    const unSession = useEditor.subscribe(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveSession, 500);
    });
    const unUpdates = startUpdateChecks();
    const unWs = useWorkspace.subscribe((s, p) => s.root !== p.root && saveSession());

    void (async () => {
      const settings = useSettings.getState();
      const session = settings.restoreSession ? loadSession() : null;
      const fromCli = await backend().startupPath().catch(() => null);
      const root = fromCli ?? session?.root ?? null;
      if (root && (await backend().exists(root))) {
        const isFile = !(await backend().listDir(root).then(() => true).catch(() => false));
        if (isFile) await useEditor.getState().openFile(root);
        else {
          await useWorkspace.getState().openFolder(root);
          if (session && session.root === root) await restoreTabs(session);
        }
      }
      setReady(true);
    })();

    return () => {
      unHook();
      unFs();
      unBuf();
      unSession();
      unWs();
      unUpdates();
    };
  }, []);
  return ready;
}

function useWindowTitle() {
  const root = useWorkspace((s) => s.root);
  const title = useEditor((s) => {
    const pane = s.panes.find((p) => p.id === s.activePaneId);
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
    const dirty = tab?.bufferId && s.buffers[tab.bufferId]?.dirty;
    return tab ? `${dirty ? "● " : ""}${tab.title}` : "";
  });
  useEffect(() => {
    void appWindow.setTitle([title, root ? basename(root) : "", "Nox Code"].filter(Boolean).join(" — "));
  }, [title, root]);
}

/** Closing with unsaved files asks first (the desktop window and the browser tab). */
function useCloseGuard() {
  useEffect(() => {
    const dirty = () => Object.values(useEditor.getState().buffers).filter((b) => b.dirty);
    if (!inTauri) {
      const onBefore = (e: BeforeUnloadEvent) => {
        if (dirty().length) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBefore);
      return () => window.removeEventListener("beforeunload", onBefore);
    }
    let un: (() => void) | undefined;
    let closing = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      void w
        .onCloseRequested(async (e) => {
          if (closing || !dirty().length) return;
          e.preventDefault();
          const n = dirty().length;
          const ans = await useUi.getState().ask({
            title: `Save changes to ${n} file${n > 1 ? "s" : ""} before closing?`,
            message: "Your changes will be lost if you don't save them.",
            buttons: [
              { id: "save", label: "Save All", variant: "primary" },
              { id: "discard", label: "Don't Save", variant: "danger" },
              { id: "cancel", label: "Cancel" },
            ],
            cancelId: "cancel",
          });
          if (ans === "cancel") return;
          if (ans === "save") {
            await useEditor.getState().saveAll();
            if (dirty().length) return;
          }
          closing = true;
          await w.destroy();
        })
        .then((f) => (un = f));
    });
    return () => un?.();
  }, []);
}

export function App() {
  useAppearance();
  useKeybindings();
  useAutoSave();
  useWindowTitle();
  useCloseGuard();
  const ready = useBoot();
  const zen = useUi((s) => s.zen);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const panelOpen = useUi((s) => s.panelOpen);
  const panelMax = useUi((s) => s.panelMaximized);
  const sidebarHidden = useSettings((s) => s.sidebarHidden);
  const sidebarSide = useSettings((s) => s.sidebarSide);
  const statusBar = useSettings((s) => s.showStatusBar);
  const scale = useSettings((s) => s.uiScale);
  const themeId = useSettings((s) => s.themeId);
  void findTheme;
  void themeId;

  const { docked } = useWindowEdges();
  const showSidebar = !sidebarHidden && !zen;

  return (
    <div className="flex h-full flex-col" style={{ zoom: scale }} data-ready={ready || undefined}>
      {!zen && <TitleBar />}
      <div className="flex min-h-0 flex-1">
        {showSidebar && sidebarSide === "left" && <Sidebar />}
        <main
          className={cx(
            "flex min-w-0 flex-1 flex-col gap-1.5",
            // No gap under the title bar; docked is also flush with the bottom and outer edge.
            docked ? "" : "px-1.5 pb-1.5",
            !docked && showSidebar && sidebarSide === "left" && "pl-0",
            !docked && showSidebar && sidebarSide === "right" && "pr-0",
            zen && "p-6",
          )}
        >
          {!(panelOpen && panelMax) && <EditorArea />}
          {panelOpen && !zen && <TerminalPanel />}
        </main>
        {showSidebar && sidebarSide === "right" && <Sidebar />}
      </div>
      {statusBar && !zen && <StatusBar />}

      {zen && (
        <button
          className="fixed right-4 top-3 z-50 flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] opacity-0 shadow-[var(--shadow-popup)] transition-opacity hover:opacity-100 hover:text-[var(--text-main)]"
          onClick={() => useUi.getState().toggleZen()}
        >
          <Minimize2 size={13} /> Exit Zen Mode
        </button>
      )}

      <Palette />
      <AnimatePresence>{settingsOpen && <SettingsModal />}</AnimatePresence>
      <DialogHost />
      <Toasts />
    </div>
  );
}
