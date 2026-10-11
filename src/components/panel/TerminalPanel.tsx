import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardPaste, Columns2, Copy, Eraser, Maximize2, Minimize2, Plus, Settings2, SquareTerminal, TextSelect, Trash2, X } from "lucide-react";
import { copySelection, pasteInto } from "@/terminal/links";
import { CUSTOM_PROFILE, termGroups, useTerminal, type DropSide, type TermInfo } from "@/stores/terminal";
import { useSettings } from "@/stores/settings";
import { islandCorners, useWindowEdges } from "@/components/layout/islands";
import { useUi } from "@/stores/ui";
import { ContextMenu, IconButton, RowMenu, cx, useWheelX, type MenuItem } from "@/components/ui";

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

/** What is being dragged: a whole tab, or one pane of a split. */
type Drag = { kind: "group"; group: string } | { kind: "term"; id: string };
let dragging: Drag | null = null;
const DRAG_MIME = "application/x-nox-terminal";

function TerminalHost({ id, focused }: { id: string; focused: boolean }) {
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
    requestAnimationFrame(fit);
    return () => {
      ro.disconnect();
      if (live.host.parentElement === el) el.removeChild(live.host);
    };
  }, [id]);
  useEffect(() => {
    if (!focused) return;
    const live = useTerminal.getState().live(id);
    requestAnimationFrame(() => live?.term.focus());
  }, [focused, id]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items = (): MenuItem[] => {
    const term = useTerminal.getState().live(id)?.term;
    if (!term) return [];
    const done = () => term.focus();
    return [
      { icon: <Copy size={14} />, label: "Copy", combo: "Ctrl+C", disabled: !term.hasSelection(), onClick: () => void copySelection(term).then(done) },
      { icon: <ClipboardPaste size={14} />, label: "Paste", combo: "Ctrl+V", onClick: () => void pasteInto(term).then(done) },
      { icon: <TextSelect size={14} />, label: "Select All", onClick: () => (term.selectAll(), done()) },
      "separator",
      { icon: <Columns2 size={14} />, label: "Split Terminal", combo: "Ctrl+Shift+5", onClick: () => void useTerminal.getState().split(id) },
      { icon: <Eraser size={14} />, label: "Clear", onClick: () => (term.clear(), done()) },
      { icon: <Trash2 size={14} />, label: "Kill Terminal", onClick: () => void useTerminal.getState().kill(id) },
    ];
  };
  return (
    <>
      <div
        ref={ref}
        className="nox-term-host absolute inset-0"
        data-testid="terminal-host"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      <ContextMenu at={menu} items={menu ? items() : []} onClose={() => setMenu(null)} />
    </>
  );
}

export function TerminalPanel() {
  const stripRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  useWheelX(stripRef);
  const terms = useTerminal((s) => s.terms);
  const activeId = useTerminal((s) => s.activeId);
  const maximized = useUi((s) => s.panelMaximized);
  const height = useSettings((s) => s.panelHeight);
  const edges = useWindowEdges();
  const groups = termGroups(terms);
  const current = groups.find((g) => g.terms.some((t) => t.id === activeId)) ?? groups[0];
  const split = (current?.terms.length ?? 0) > 1;
  /** Where a drop would land: half of a pane, or a slot in the tab strip. */
  const [drop, setDrop] = useState<{ id: string; side: DropSide; left: number; width: number } | null>(null);
  const [stripDrop, setStripDrop] = useState<number | null>(null);
  const endDrag = () => {
    dragging = null;
    setDrop(null);
    setStripDrop(null);
  };

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

  /** Drags the divider between two panes of a split. */
  const startSplitResize = (e: React.MouseEvent, a: TermInfo, b: TermInfo) => {
    e.preventDefault();
    const area = areaRef.current;
    const ea = area?.querySelector<HTMLElement>(`[data-term-pane="${a.id}"]`);
    const eb = area?.querySelector<HTMLElement>(`[data-term-pane="${b.id}"]`);
    if (!ea || !eb) return;
    const wa = ea.offsetWidth;
    const both = wa + eb.offsetWidth;
    const sum = a.weight + b.weight;
    const x0 = e.clientX;
    const move = (ev: MouseEvent) => {
      const na = Math.max(80, Math.min(both - 80, wa + ev.clientX - x0));
      useTerminal.getState().resize(a.id, (sum * na) / both, b.id, (sum * (both - na)) / both);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Dragging a tab (or a pane) over the terminals: the half it would split into.
  const overArea = (e: React.DragEvent) => {
    const pane = (e.target as HTMLElement).closest<HTMLElement>("[data-term-pane]");
    const area = areaRef.current;
    if (!dragging || !pane || !area) return setDrop(null);
    const id = pane.dataset.termPane!;
    const target = terms.find((t) => t.id === id);
    if (!target) return setDrop(null);
    // Onto itself, or a tab onto its own panes: nothing to do.
    if (dragging.kind === "term" ? dragging.id === id : dragging.group === target.group) return setDrop(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = pane.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    const side: DropSide = e.clientX < r.left + r.width / 2 ? "before" : "after";
    const left = r.left - box.left + (side === "after" ? r.width / 2 : 0);
    if (drop?.id !== id || drop.side !== side || drop.left !== left) setDrop({ id, side, left, width: r.width / 2 });
  };
  const dropOnArea = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drop;
    const what = dragging;
    endDrag();
    if (!d || !what) return;
    if (what.kind === "term") useTerminal.getState().place(what.id, d.id, d.side);
    else useTerminal.getState().placeGroup(what.group, d.id, d.side);
  };
  // A pane dropped on the tab strip leaves its split.
  const overStrip = (e: React.DragEvent, index: number | null) => {
    if (dragging?.kind !== "term") return;
    e.preventDefault();
    e.stopPropagation();
    const at = index ?? groups.length;
    if (stripDrop !== at) setStripDrop(at);
  };
  const dropOnStrip = (e: React.DragEvent) => {
    if (dragging?.kind !== "term") return;
    e.preventDefault();
    e.stopPropagation();
    const id = dragging.id;
    const at = stripDrop ?? undefined;
    endDrag();
    useTerminal.getState().detach(id, at);
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
        <div
          ref={stripRef}
          className="no-native-scrollbar flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto"
          onDragOver={(e) => overStrip(e, null)}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setStripDrop(null)}
          onDrop={dropOnStrip}
        >
          {groups.map((g, gi) => {
            const active = g === current;
            const many = g.terms.length > 1;
            return (
              <div
                key={g.id}
                role="tab"
                aria-selected={active}
                draggable
                title={`${g.terms.map((t) => t.title).join(" · ")} — drag onto the terminal to split`}
                onDragStart={(e) => {
                  dragging = { kind: "group", group: g.id };
                  e.dataTransfer.setData(DRAG_MIME, g.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => overStrip(e, gi)}
                onClick={() => !active && useTerminal.getState().activate(g.terms[0].id)}
                className={cx(
                  "group relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2 pr-1 text-[12px] transition-colors",
                  active ? "bg-[var(--bg-input)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
                  stripDrop === gi && "before:absolute before:inset-y-1 before:-left-[3px] before:w-[2px] before:rounded before:bg-[var(--accent)]",
                )}
              >
                {many ? (
                  <Columns2 size={13} className="text-[var(--diff-add)]" />
                ) : (
                  <SquareTerminal size={13} className={g.terms[0].exited ? "text-[var(--text-dim)]" : "text-[var(--diff-add)]"} />
                )}
                <span className="max-w-[220px] truncate">{g.terms.map((t) => t.title).join(" · ")}</span>
                <button
                  title={many ? "Kill Terminals" : "Kill Terminal"}
                  className="flex h-5 w-5 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-[var(--bg-elevated)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    for (const t of g.terms) void useTerminal.getState().kill(t.id);
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
          {stripDrop === groups.length && <span className="h-5 w-[2px] shrink-0 rounded bg-[var(--accent)]" />}
        </div>
        <NewTerminalButton />
        <IconButton label="Split Terminal (Ctrl+Shift+5)" data-testid="split-terminal" onClick={() => void useTerminal.getState().split()}>
          <Columns2 size={14} />
        </IconButton>
        <IconButton label={maximized ? "Restore Panel" : "Maximize Panel"} onClick={() => useUi.getState().setPanelMaximized(!maximized)}>
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <IconButton label="Hide Panel (Ctrl+J)" onClick={() => useUi.getState().togglePanel(false)}>
          <ChevronDown size={15} />
        </IconButton>
      </div>
      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1"
        onDragOver={overArea}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}
        onDrop={dropOnArea}
      >
        {current?.terms.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && (
              <div className="relative w-px shrink-0 cursor-col-resize bg-[var(--border)]" onMouseDown={(e) => startSplitResize(e, current.terms[i - 1], t)}>
                <div className="absolute inset-y-0 -left-1 -right-1 z-10" />
              </div>
            )}
            <div
              data-term-pane={t.id}
              data-testid="terminal-pane"
              className="flex min-w-0 flex-col"
              style={{ flex: `${t.weight} 1 0` }}
              onMouseDownCapture={() => t.id !== activeId && useTerminal.getState().activate(t.id)}
            >
              {split && (
                <div
                  draggable
                  title="Drag to move it — onto the tab bar to unsplit"
                  onDragStart={(e) => {
                    dragging = { kind: "term", id: t.id };
                    e.dataTransfer.setData(DRAG_MIME, t.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={endDrag}
                  className={cx(
                    "group flex h-6 shrink-0 cursor-grab items-center gap-1.5 border-b px-2 text-[11px]",
                    t.id === activeId ? "border-[var(--accent)] text-[var(--text-main)]" : "border-transparent text-[var(--text-dim)]",
                  )}
                >
                  <SquareTerminal size={11} className={t.exited ? "text-[var(--text-dim)]" : "text-[var(--diff-add)]"} />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <button
                    title="Kill Terminal"
                    className="flex h-4 w-4 items-center justify-center rounded opacity-0 hover:bg-[var(--bg-elevated)] group-hover:opacity-100"
                    onClick={() => void useTerminal.getState().kill(t.id)}
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
              <div className="relative min-h-0 flex-1">
                <TerminalHost id={t.id} focused={t.id === activeId} />
              </div>
            </div>
          </Fragment>
        ))}
        {drop && (
          <div
            className="pointer-events-none absolute inset-y-0 z-20 rounded-md bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] ring-1 ring-inset ring-[var(--accent)]"
            style={{ left: drop.left, width: drop.width }}
          />
        )}
        {!terms.length && (
          <div className="flex h-full flex-1 items-center justify-center">
            <button className="rounded-xl bg-[var(--bg-input)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]" onClick={() => void useTerminal.getState().create()}>
              Start a terminal
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
