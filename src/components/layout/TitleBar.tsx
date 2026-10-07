import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Ellipsis, FolderTree, GitBranch, Menu, Minus, Puzzle, Settings, Square, X, type LucideIcon } from "lucide-react";
import { appWindow } from "@/lib/window";
import { getCommand, keysFor, runCommand } from "@/core/commands";
import { useSettings } from "@/stores/settings";
import { useUi, type SideView } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { EXTENSIONS, isExtEnabled } from "@/extensions/registry";
import { isMac } from "@/lib/keys";
import { Kbd, cx } from "@/components/ui";

type Entry = string | "-";

/** Five menus; everything else is one Ctrl+Shift+P away. */
const MENUS: Record<string, Entry[]> = {
  File: ["file.newUntitled", "explorer.newFile", "explorer.newFolder", "-", "file.openFile", "file.openFolder", "file.openRecent", "-", "file.save", "file.saveAs", "file.saveAll", "file.revert", "-", "editor.close", "file.closeFolder", "-", "settings.open"],
  Edit: ["editor.find", "view.search", "-", "editor.toggleComment", "editor.selectAllOccurrences", "-", "editor.format", "editor.changeIndentation", "editor.changeEol", "-", "text.sortLines", "text.uniqueLines", "text.upper", "text.lower"],
  View: ["workbench.commandPalette", "workbench.quickOpen", "editor.gotoLine", "-", "view.toggleSidebar", "view.sidebarSide", "view.toggleIslands", "view.toggleStatusBar", "view.toggleBreadcrumbs", "editor.toggleWordWrap", "-", "editor.split", "editor.splitDown", "view.zen", "view.fullscreen", "-", "settings.theme", "settings.iconTheme", "settings.toggleLightDark", "-", "view.zoomIn", "view.zoomOut", "view.zoomReset"],
  Terminal: ["terminal.new", "terminal.newWithShell", "terminal.toggle", "-", "terminal.runSelection", "terminal.kill"],
  Help: ["help.welcome", "settings.keybindings", "-", "view.reload", "help.about"],
};

const VIEWS: Array<{ id: SideView; label: string; icon: LucideIcon; command: string }> = [
  { id: "explorer", label: "Explorer", icon: FolderTree, command: "view.explorer" },
  { id: "git", label: "Source Control", icon: GitBranch, command: "view.git" },
  { id: "extensions", label: "Extensions", icon: Puzzle, command: "view.extensions" },
];

const shortcut = (command: string) => {
  const k = keysFor(command)[0];
  return k ? ` (${k})` : "";
};

/** Explorer / Source Control / Extensions: VS Code's activity bar, in the title bar. */
function ViewSwitcher({ onPick }: { onPick?: () => void }) {
  const view = useUi((s) => s.sideView);
  const hidden = useSettings((s) => s.sidebarHidden);
  const enabledMap = useSettings((s) => s.extEnabled);
  const changes = useWorkspace((s) => s.git?.files.length ?? 0);
  const enabled = EXTENSIONS.filter((e) => isExtEnabled(e.id, { extEnabled: enabledMap })).length;
  const counts: Partial<Record<SideView, number>> = { git: changes, extensions: enabled };
  return (
    <div className="flex items-center gap-0.5" role="tablist" aria-label="Side views">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = !hidden && view === v.id;
        const count = counts[v.id];
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            data-testid={`view-${v.id}`}
            title={v.label + shortcut(v.command)}
            className={cx(
              "relative flex h-[28px] w-[30px] items-center justify-center rounded-lg transition-colors",
              active ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
            )}
            onClick={() => {
              // Clicking the open view again hides the sidebar, like the activity bar.
              if (active) useSettings.getState().set("sidebarHidden", true);
              else useUi.getState().showSideView(v.id);
              onPick?.();
            }}
          >
            <Icon size={15} strokeWidth={1.6} />
            {v.id === "git" && count !== undefined && count > 0 && (
              <span className="absolute -right-0.5 top-0 min-w-[14px] rounded-full bg-[var(--diff-mod)] px-[3px] text-center font-mono text-[9px] font-semibold leading-[14px] text-[var(--bg-app)]">
                {count > 99 ? "99+" : count}
              </span>
            )}
            {active && <span className="absolute bottom-[1px] left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full bg-[var(--accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compact title bar: a group folds into one button. Clicking it shows the
 * group in place; it folds back after a pick or once the pointer leaves.
 */
function Fold({
  compact,
  shown,
  setShown,
  busy = false,
  icon: Icon,
  label,
  testId,
  children,
}: {
  compact: boolean;
  shown: boolean;
  setShown: (v: boolean) => void;
  /** A dropdown is open inside: keep the group out while it is. */
  busy?: boolean;
  icon: LucideIcon;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Fold back once the pointer is anywhere outside: sturdier than mouseleave,
  // which never fires if the pointer was not over the group when it appeared.
  useEffect(() => {
    if (!compact || !shown || busy) return;
    const move = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setShown(false);
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, [compact, shown, busy, setShown]);
  if (!compact) return <>{children}</>;
  if (!shown)
    return (
      <button
        data-testid={testId}
        title={label}
        aria-label={label}
        className="flex h-[28px] w-[30px] items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
        onClick={() => setShown(true)}
      >
        <Icon size={15} strokeWidth={1.6} />
      </button>
    );
  return (
    <motion.div
      ref={ref}
      className="flex h-full items-center gap-0.5"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
    >
      {children}
    </motion.div>
  );
}

function MenuDropdown({ entries, onDone }: { entries: Entry[]; onDone: () => void }) {
  return (
    <motion.div
      role="menu"
      className="absolute left-0 top-[calc(100%+4px)] z-[650] flex min-w-[260px] flex-col gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-popup)]"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
    >
      {entries.map((id, i) => {
        if (id === "-") return <div key={"sep" + i} className="mx-1.5 my-0.5 h-px bg-[var(--border-soft)]" />;
        const cmd = getCommand(id);
        if (!cmd) return null;
        const key = keysFor(id)[0];
        return (
          <button
            key={id + i}
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12.5px] text-[var(--text-main)] transition-colors hover:bg-[var(--hover-bg)]"
            onClick={() => {
              onDone();
              void runCommand(id);
            }}
          >
            <span className="flex-1 truncate">{cmd.title}</span>
            {key && <Kbd combo={key} className="pl-4" />}
          </button>
        );
      })}
    </motion.div>
  );
}

export function TitleBar() {
  const [open, setOpen] = useState<string | null>(null);
  const compactMenus = useSettings((s) => s.titleMenus === "compact");
  const compactActions = useSettings((s) => s.titleActions === "compact");
  const [menusShown, setMenusShown] = useState(false);
  const [actionsShown, setActionsShown] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized);
    void appWindow.onResized(() => void appWindow.isMaximized().then(setMaximized)).then((f) => (un = f));
    return () => un?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Closing a menu from outside also folds the compact menu group.
    const close = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(null);
        setMenusShown(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      setMenusShown(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={barRef} data-tauri-drag-region data-testid="title-bar" className="relative flex h-[38px] shrink-0 select-none items-center bg-[var(--bg-titlebar)]">
      {/* macOS draws its traffic lights over this corner. */}
      <div className={cx("flex h-full items-center gap-0.5", isMac ? "pl-[78px]" : "pl-3")}>
        <span data-tauri-drag-region className="mr-2 text-[13px] font-semibold tracking-tight bg-[var(--text-muted)] bg-clip-text text-transparent" data-testid="app-name">
          Nox Code
        </span>
        <Fold compact={compactMenus} shown={menusShown} setShown={setMenusShown} busy={open !== null} icon={Menu} label="Menu" testId="title-menus-toggle">
          <div className="flex h-full items-center gap-0.5" data-testid="title-menus">
            {Object.keys(MENUS).map((m) => (
              <div key={m} className="relative flex h-full items-center">
                <button
                  className={`rounded-lg px-2.5 py-1 text-[12.5px] transition-colors ${
                    open === m ? "bg-[var(--hover-bg)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setOpen(open === m ? null : m);
                  }}
                  onMouseEnter={() => open && setOpen(m)}
                >
                  {m}
                </button>
                <AnimatePresence>
                  {open === m && (
                    <MenuDropdown
                      entries={MENUS[m]}
                      onDone={() => {
                        setOpen(null);
                        setMenusShown(false);
                      }}
                    />
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Fold>
      </div>

      <div data-tauri-drag-region className="h-full min-w-0 flex-1" />

      {/* What the sidebar shows, and settings. */}
      <div className="flex h-full items-center gap-0.5 pr-2">
        <Fold compact={compactActions} shown={actionsShown} setShown={setActionsShown} icon={Ellipsis} label="Views and settings" testId="title-actions-toggle">
          <ViewSwitcher onPick={() => setActionsShown(false)} />
          <button
            data-testid="open-settings"
            title={"Settings" + shortcut("settings.open")}
            className="flex h-[28px] w-[30px] items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
            onClick={() => {
              setActionsShown(false);
              useUi.getState().openSettings();
            }}
          >
            <Settings size={15} strokeWidth={1.6} />
          </button>
        </Fold>
      </div>

      {!isMac && (
        <div className="flex h-full items-stretch">
          <button
            className="flex w-[46px] items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
            onClick={() => void appWindow.minimize()}
            title="Minimize"
          >
            <Minus size={15} strokeWidth={1.2} />
          </button>
          <button
            className="flex w-[46px] items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
            onClick={() => void appWindow.toggleMaximize()}
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Copy size={12} strokeWidth={1.2} /> : <Square size={12} strokeWidth={1.2} />}
          </button>
          <button className="win-close flex w-[46px] items-center justify-center text-[var(--text-muted)] transition-colors" onClick={() => void appWindow.close()} title="Close">
            <X size={15} strokeWidth={1.2} />
          </button>
        </div>
      )}
    </div>
  );
}
