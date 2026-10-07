import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Maximize2, Minimize2, Plus, Settings2, SquareTerminal, Trash2 } from "lucide-react";
import { CUSTOM_PROFILE, useTerminal } from "@/stores/terminal";
import { useSettings } from "@/stores/settings";
import { islandCorners, useWindowEdges } from "@/components/layout/islands";
import { useUi } from "@/stores/ui";
import { IconButton, RowMenu, cx, useWheelX, type MenuItem } from "@/components/ui";

/** "+" opens the default shell; the arrow next to it picks any installed one. */
function NewTerminalButton() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const shells = useTerminal((s) => s.shells);
  const profile = useSettings((s) => s.terminalProfile);
  const custom = useSettings((s) => s.terminalShell);
  useEffect(() => void useTerminal.getState().loadShells(), []);
  const defaultId = profile || (custom.trim() ? CUSTOM_PROFILE : shells[0]?.id);

  const items: MenuItem[] = [
    ...shells.map(
      (p): MenuItem => ({
        icon: p.id === defaultId ? <Check size={14} /> : <SquareTerminal size={14} />,
        label: p.name,
        hint: p.id === defaultId ? "default" : undefined,
        onClick: () => void useTerminal.getState().create(undefined, p.id),
      }),
    ),
    ...(shells.length ? ["separator" as const] : []),
    { icon: <Settings2 size={14} />, label: "Select Default Shell…", onClick: () => useUi.getState().openSettings("terminal") },
  ];

  return (
    <div className="flex items-center">
      <IconButton label="New Terminal (Ctrl+Shift+`)" data-testid="new-terminal" className="rounded-r-none" onClick={() => void useTerminal.getState().create()}>
        <Plus size={15} />
      </IconButton>
      <IconButton ref={anchor} label="Choose Shell" data-testid="choose-shell" className="w-5 rounded-l-none" active={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={12} />
      </IconButton>
      <RowMenu open={open} anchor={anchor} items={items} onClose={() => setOpen(false)} />
    </div>
  );
}

function TerminalHost({ id, visible }: { id: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const live = useTerminal.getState().live(id);
    const el = ref.current;
    if (!live || !el) return;
    el.appendChild(live.host);
    if (!live.host.querySelector(".xterm")) live.term.open(live.host);
    const fit = () => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      try {
        live.fit.fit();
      } catch {
        /* not measurable yet */
      }
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(el);
    requestAnimationFrame(() => {
      fit();
      if (useTerminal.getState().activeId === id) live.term.focus();
    });
    return () => {
      ro.disconnect();
      if (live.host.parentElement === el) el.removeChild(live.host);
    };
  }, [id]);
  useEffect(() => {
    if (!visible) return;
    const live = useTerminal.getState().live(id);
    requestAnimationFrame(() => {
      try {
        live?.fit.fit();
      } catch {
        /* hidden */
      }
      live?.term.focus();
    });
  }, [visible, id]);
  return <div ref={ref} className={cx("absolute inset-0", !visible && "invisible")} data-testid="terminal-host" />;
}

export function TerminalPanel() {
  const stripRef = useRef<HTMLDivElement>(null);
  useWheelX(stripRef);
  const terms = useTerminal((s) => s.terms);
  const activeId = useTerminal((s) => s.activeId);
  const maximized = useUi((s) => s.panelMaximized);
  const height = useSettings((s) => s.panelHeight);
  const edges = useWindowEdges();

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = useSettings.getState().panelHeight;
    const move = (ev: MouseEvent) => useSettings.getState().set("panelHeight", Math.max(120, Math.min(window.innerHeight - 200, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <section
      data-testid="terminal-panel"
      className={cx(
        "relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-editor)]",
        islandCorners({ tl: edges.left, tr: edges.right, bl: edges.docked, br: edges.docked }),
        maximized && "flex-1",
      )}
      style={maximized ? undefined : { height }}
    >
      {!maximized && <div className="resizer-y" style={{ top: -4 }} onMouseDown={startResize} />}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div ref={stripRef} className="no-native-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {terms.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              onClick={() => useTerminal.getState().activate(t.id)}
              className={cx(
                "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2 pr-1 text-[12px] transition-colors",
                t.id === activeId ? "bg-[var(--bg-input)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
              )}
            >
              <SquareTerminal size={13} className={t.exited ? "text-[var(--text-dim)]" : "text-[var(--diff-add)]"} />
              <span className="max-w-[160px] truncate">{t.title}</span>
              <button
                title="Kill Terminal"
                className="flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--bg-elevated)] group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void useTerminal.getState().kill(t.id);
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
        <NewTerminalButton />
        <IconButton label={maximized ? "Restore Panel" : "Maximize Panel"} onClick={() => useUi.getState().setPanelMaximized(!maximized)}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <IconButton label="Hide Panel (Ctrl+J)" onClick={() => useUi.getState().togglePanel(false)}>
          <ChevronDown size={15} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {terms.map((t) => (
          <TerminalHost key={t.id} id={t.id} visible={t.id === activeId} />
        ))}
        {!terms.length && (
          <div className="flex h-full items-center justify-center">
            <button className="rounded-xl bg-[var(--bg-input)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]" onClick={() => void useTerminal.getState().create()}>
              Start a terminal
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
