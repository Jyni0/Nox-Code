import { Fragment, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Columns2, Ellipsis, Eye, GitCompare, Search, X } from "lucide-react";
import { useEditor, type Pane, type Tab } from "@/stores/editor";
import type { LayoutNode, Side } from "@/editor/layout";
import { useSettings } from "@/stores/settings";
import { islandCorners, useWindowEdges } from "@/components/layout/islands";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { FileIcon } from "@/icons/FileIcon";
import { SearchTab } from "./SearchTab";
import { basename, relative } from "@/lib/path";
import { backend } from "@/lib/backend";
import { REVEAL_LABEL } from "@/lib/platform";
import { CodeEditor } from "@/editor/CodeEditor";
import { BinaryView, DiffView, ImageView, MarkdownPreview } from "@/editor/Views";
import { isExtEnabled } from "@/extensions/registry";
import { Button, ContextMenu, IconButton, OverlayScroll, RowMenu, cx, type MenuItem } from "@/components/ui";
import { copyText } from "@/app/fileOps";
import { Welcome } from "./Welcome";

const TAB_MIME = "application/x-nox-tab";
/** Set by the explorer for files (not folders) being dragged. */
const FILE_MIME = "application/x-nox-file";

type DropZone = Side | "center";
const draggable = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(FILE_MIME);

/**
 * The outer third on each side splits toward that side (the nearest edge
 * wins in the corners); the middle moves into this group — like VS Code.
 */
function zoneAt(e: React.DragEvent, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const near: Array<[DropZone, number]> = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ];
  const [side, dist] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
  return dist < 0.3 ? side : "center";
}

function dropInto(e: React.DragEvent, pane: Pane, zone: DropZone) {
  const tabData = e.dataTransfer.getData(TAB_MIME);
  const file = e.dataTransfer.getData(FILE_MIME);
  const ed = useEditor.getState();
  if (tabData) {
    const src = JSON.parse(tabData) as { paneId: string; tabId: string };
    if (zone === "center") {
      if (src.paneId !== pane.id) ed.moveTab(src.paneId, src.tabId, pane.id);
    } else {
      ed.splitWithTab(src.paneId, src.tabId, pane.id, zone);
    }
  } else if (file) {
    void ed.openFile(file, zone === "center" ? { paneId: pane.id } : { split: { paneId: pane.id, side: zone } });
  }
}

function TabItem({ pane, tab, active, focused }: { pane: Pane; tab: Tab; active: boolean; focused: boolean }) {
  const buffer = useEditor((s) => (tab.bufferId ? s.buffers[tab.bufferId] : undefined));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropSide, setDropSide] = useState<"l" | "r" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dirty = tab.kind === "text" && !!buffer?.dirty;
  const close = () => void useEditor.getState().closeTab(pane.id, tab.id);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const items: MenuItem[] = [
    { label: "Close", combo: "Ctrl+W", onClick: close },
    { label: "Close Others", onClick: () => void useEditor.getState().closeTabs(pane.id, "others", tab.id) },
    { label: "Close to the Right", onClick: () => void useEditor.getState().closeTabs(pane.id, "right", tab.id) },
    { label: "Close Saved", onClick: () => void useEditor.getState().closeTabs(pane.id, "saved") },
    { label: "Close All", onClick: () => void useEditor.getState().closeTabs(pane.id, "all") },
    "separator",
    { label: "Keep Open", disabled: !tab.preview, onClick: () => useEditor.getState().pinTab(pane.id, tab.id) },
    { label: "Split Right", combo: "Ctrl+\\", onClick: () => (useEditor.getState().activateTab(pane.id, tab.id), useEditor.getState().splitRight(pane.id)) },
    { label: "Split Down", combo: "Ctrl+Shift+\\", onClick: () => (useEditor.getState().activateTab(pane.id, tab.id), useEditor.getState().split(pane.id, "bottom")) },
  ];
  if (tab.path) {
    const p = tab.path;
    items.push(
      "separator",
      { label: "Copy Path", onClick: () => copyText(p, "Path copied") },
      {
        label: "Reveal in Explorer View",
        onClick: () => {
          useUi.getState().showSideView("explorer");
          void useWorkspace.getState().revealPath(p);
        },
      },
      { label: REVEAL_LABEL, onClick: () => void backend().revealInExplorer(p) },
    );
  }

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      data-testid="tab"
      data-title={tab.title}
      draggable
      title={tab.path ?? tab.title}
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_MIME, JSON.stringify({ paneId: pane.id, tabId: tab.id }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDropSide(e.clientX < r.left + r.width / 2 ? "l" : "r");
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropSide(null);
        const data = e.dataTransfer.getData(TAB_MIME);
        if (!data) return;
        const src = JSON.parse(data) as { paneId: string; tabId: string };
        const idx = pane.tabs.findIndex((t) => t.id === tab.id) + (dropSide === "r" ? 1 : 0);
        const from = pane.tabs.findIndex((t) => t.id === src.tabId);
        useEditor.getState().moveTab(src.paneId, src.tabId, pane.id, src.paneId === pane.id && from < idx ? idx - 1 : idx);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close();
        }
      }}
      onClick={() => useEditor.getState().activateTab(pane.id, tab.id)}
      onDoubleClick={() => useEditor.getState().pinTab(pane.id, tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      className={cx(
        "group relative flex h-[30px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[10px] pl-2.5 pr-1 text-[12.5px] transition-colors",
        active
          ? focused
            ? "bg-[var(--bg-input)] text-[var(--text-main)]"
            : "bg-[color-mix(in_srgb,var(--bg-input)_55%,transparent)] text-[var(--text-main)]"
          : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
      )}
    >
      {dropSide && <span className={`absolute inset-y-1 w-0.5 rounded-full bg-[var(--accent)] ${dropSide === "l" ? "-left-0.5" : "-right-0.5"}`} />}
      {tab.kind === "preview" ? (
        <Eye size={14} className="shrink-0 text-[var(--accent)]" />
      ) : tab.kind === "diff" ? (
        <GitCompare size={14} className="shrink-0 text-[var(--diff-mod)]" />
      ) : tab.kind === "search" ? (
        <Search size={14} className="shrink-0 text-[var(--text-muted)]" />
      ) : (
        <FileIcon name={tab.path ? basename(tab.path) : tab.title} size={14} />
      )}
      <span className={cx("truncate", tab.preview && "italic", buffer?.deleted && "line-through opacity-70")}>{tab.title}</span>
      <button
        title={dirty ? "Unsaved — click to close" : "Close"}
        aria-label={`Close ${tab.title}`}
        className={cx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-elevated)]",
          !dirty && !active && "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        {dirty ? (
          <>
            <span className="h-2 w-2 rounded-full bg-[var(--text-main)] group-hover:hidden" data-testid="dirty-dot" />
            <X size={12} className="hidden group-hover:block" />
          </>
        ) : (
          <X size={12} />
        )}
      </button>
      <ContextMenu at={menu} items={items} onClose={() => setMenu(null)} />
    </div>
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const root = useWorkspace((s) => s.root);
  const rel = root ? relative(root, path) : null;
  const parts = (rel ?? path).split(/[\\/]/).filter(Boolean);
  return (
    <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden px-3 text-[11.5px] text-[var(--text-dim)]" data-testid="breadcrumbs">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={11} className="shrink-0 opacity-60" />}
          <button
            className={cx("flex shrink-0 items-center gap-1 rounded px-1 hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]", i === parts.length - 1 && "text-[var(--text-muted)]")}
            onClick={() => {
              useUi.getState().showSideView("explorer");
              void useWorkspace.getState().revealPath(path);
            }}
          >
            {i === parts.length - 1 && <FileIcon name={p} size={12} />}
            {p}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Which outer edges of the editor area a group sits on. */
interface At {
  left: boolean;
  right: boolean;
  bottom: boolean;
}

function PaneView({ pane, index, total, at }: { pane: Pane; index: number; total: number; at: At }) {
  const edges = useWindowEdges();
  const left = at.left && edges.left;
  const right = at.right && edges.right;
  const bottom = at.bottom && edges.editorBottom;
  const corners = islandCorners({ tl: left, bl: left || bottom, tr: right, br: right || bottom });
  const activePaneId = useEditor((s) => s.activePaneId);
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
  const buffer = useEditor((s) => (tab?.bufferId ? s.buffers[tab.bufferId] : undefined));
  const showBreadcrumbs = useSettings((s) => s.showBreadcrumbs);
  const showSplit = useSettings((s) => s.tabBarSplit);
  const showMenu = useSettings((s) => s.tabBarMenu);
  const extEnabled = useSettings((s) => s.extEnabled);
  const focused = activePaneId === pane.id;
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [zone, setZone] = useState<DropZone | null>(null);
  // A drag cancelled with Esc or dropped elsewhere never sends dragleave here.
  useEffect(() => {
    if (!zone) return;
    const clear = () => setZone(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [zone]);
  const isMarkdown = buffer?.langId === "markdown" && tab?.kind === "text";
  void extEnabled;

  // The editor instance stays mounted while text tabs switch (fast swaps,
  // kept undo history); other kinds render their own views.
  const textTab = tab?.kind === "text" && buffer ? tab : null;

  return (
    <section
      className={cx("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-editor)]", corners)}
      data-testid="pane"
      data-active={focused}
      onMouseDown={() => useEditor.getState().focusPane(pane.id)}
      // The tab strip: dropping there moves the tab into this group.
      onDragOver={(e) => {
        if (!draggable(e)) return;
        e.preventDefault();
        setZone("center");
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        setZone(null);
        dropInto(e, pane, "center");
      }}
    >
      {pane.tabs.length > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-1 pl-1.5 pr-1.5">
          <OverlayScroll wheelX wrapperClassName="min-w-0 flex-1" className="flex items-center gap-1 overflow-x-auto py-1" role="tablist">
            {pane.tabs.map((t) => (
              <TabItem key={t.id} pane={pane} tab={t} active={t.id === pane.activeTabId} focused={focused} />
            ))}
          </OverlayScroll>
          <div className="flex shrink-0 items-center gap-0.5">
            {isMarkdown && isExtEnabled("markdown-preview") && (
              <IconButton label="Open Preview to the Side (Ctrl+Shift+V)" onClick={() => buffer && useEditor.getState().openPreview(buffer.id)}>
                <Eye size={15} />
              </IconButton>
            )}
            {showSplit && (
              <IconButton label="Split Editor Right (Ctrl+\)" onClick={() => useEditor.getState().splitRight(pane.id)}>
                <Columns2 size={15} />
              </IconButton>
            )}
            {showMenu && (
              <IconButton ref={moreRef} label="More Actions" onClick={() => setMore(!more)}>
                <Ellipsis size={15} />
              </IconButton>
            )}
            <RowMenu
              open={more}
              anchor={moreRef}
              onClose={() => setMore(false)}
              items={[
                { label: "Close All", onClick: () => void useEditor.getState().closeTabs(pane.id, "all") },
                { label: "Close Saved", onClick: () => void useEditor.getState().closeTabs(pane.id, "saved") },
                "separator",
                { label: "Toggle Word Wrap", combo: "Alt+Z", onClick: () => useSettings.getState().set("wordWrap", !useSettings.getState().wordWrap) },
                { label: total > 1 ? `Group ${index + 1} of ${total}` : "Single group", disabled: true, onClick: () => {} },
              ]}
            />
          </div>
        </div>
      )}

      {showBreadcrumbs && tab?.path && (tab.kind === "text" || tab.kind === "image") && <Breadcrumbs path={tab.path} />}

      {buffer?.diskChanged && tab?.kind === "text" && (
        <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-[color-mix(in_srgb,var(--diff-mod)_12%,transparent)] px-3 py-1.5 text-[12px] text-[var(--text-main)]">
          <AlertTriangle size={13} className="shrink-0 text-[var(--diff-mod)]" />
          <span className="flex-1">This file changed on disk while you had unsaved edits.</span>
          <Button size="xs" onClick={() => void useEditor.getState().revert(buffer.id)}>
            Reload from Disk
          </Button>
          <Button size="xs" variant="ghost" onClick={() => useEditor.setState((s) => ({ buffers: { ...s.buffers, [buffer.id]: { ...buffer, diskChanged: false } } }))}>
            Keep Mine
          </Button>
        </div>
      )}

      <div
        className="relative min-h-0 flex-1"
        data-testid="pane-body"
        // The editor body: its left / right edge opens a new group on that side.
        onDragOver={(e) => {
          if (!draggable(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setZone(zoneAt(e, e.currentTarget));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const z = zoneAt(e, e.currentTarget);
          setZone(null);
          dropInto(e, pane, z);
        }}
      >
        {zone && (
          <div
            data-testid="drop-zone"
            data-zone={zone}
            className={cx(
              "pointer-events-none absolute z-30 rounded-xl border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] transition-all duration-100",
              zone === "left" && "inset-y-1.5 left-1.5 right-1/2",
              zone === "right" && "inset-y-1.5 left-1/2 right-1.5",
              zone === "top" && "inset-x-1.5 top-1.5 bottom-1/2",
              zone === "bottom" && "inset-x-1.5 bottom-1.5 top-1/2",
              zone === "center" && "inset-1.5",
            )}
          />
        )}
        {textTab && buffer ? (
          <CodeEditor paneId={pane.id} buffer={buffer} active={focused} />
        ) : tab?.kind === "preview" && buffer ? (
          <MarkdownPreview buffer={buffer} />
        ) : tab?.kind === "diff" && tab.path ? (
          <DiffView buffer={buffer ?? null} path={tab.path} />
        ) : tab?.kind === "image" && tab.path ? (
          isExtEnabled("image-preview") ? <ImageView path={tab.path} /> : <BinaryView path={tab.path} />
        ) : tab?.kind === "search" ? (
          <SearchTab paneId={pane.id} />
        ) : tab?.kind === "binary" && tab.path ? (
          <BinaryView path={tab.path} onOpenAnyway={() => void backend().revealInExplorer(tab.path!)} />
        ) : (
          <Welcome />
        )}
      </div>
    </section>
  );
}

/** A split: children side by side (row) or stacked (column), with drag handles between. */
function SplitView({ node, at }: { node: LayoutNode; at: At }) {
  const panes = useEditor((s) => s.panes);
  const ref = useRef<HTMLDivElement>(null);

  if (node.kind === "pane") {
    // `panes` is in reading order, so its index is the group number.
    const i = panes.findIndex((p) => p.id === node.paneId);
    if (i < 0) return null;
    return <PaneView pane={panes[i]} index={i} total={panes.length} at={at} />;
  }

  const row = node.dir === "row";
  const startResize = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const sizes = [...node.sizes];
    const total = sizes.reduce((a, b) => a + b, 0);
    const pxPerWeight = (row ? el.clientWidth : el.clientHeight) / total;
    const min = total * 0.08;
    const start = row ? e.clientX : e.clientY;
    const [wa, wb] = [sizes[i], sizes[i + 1]];
    const move = (ev: MouseEvent) => {
      const d = ((row ? ev.clientX : ev.clientY) - start) / pxPerWeight;
      const na = Math.min(wa + wb - min, Math.max(min, wa + d));
      const next = [...sizes];
      next[i] = na;
      next[i + 1] = wa + wb - na;
      useEditor.getState().setSplitSizes(node.id, next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = row ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const last = node.children.length - 1;
  return (
    <div ref={ref} className={cx("flex min-h-0 min-w-0 flex-1 gap-1.5", row ? "flex-row" : "flex-col")}>
      {node.children.map((child, i) => (
        <Fragment key={child.kind === "pane" ? child.paneId : child.id}>
          <div className="relative flex min-h-0 min-w-0 flex-col" style={{ flex: `${node.sizes[i]} 1 0` }}>
            <SplitView
              node={child}
              at={
                row
                  ? { left: at.left && i === 0, right: at.right && i === last, bottom: at.bottom }
                  : { left: at.left, right: at.right, bottom: at.bottom && i === last }
              }
            />
            {/* The handle fills the gap after this child, so it adds no extra space. */}
            {i < last &&
              (row ? (
                <div className="resizer-x rounded-full" style={{ right: -6 }} onMouseDown={startResize(i)} />
              ) : (
                <div className="resizer-y rounded-full" style={{ bottom: -6 }} onMouseDown={startResize(i)} />
              ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function EditorArea() {
  const layout = useEditor((s) => s.layout);
  const zen = useUi((s) => s.zen);
  return (
    <div
      className={cx("flex min-h-0 min-w-0 flex-1", zen && "mx-auto w-full")}
      style={zen ? { maxWidth: Number(useSettings.getState().extSettings["zen-mode"]?.width ?? 900) } : undefined}
    >
      <SplitView node={layout} at={{ left: true, right: true, bottom: true }} />
    </div>
  );
}
