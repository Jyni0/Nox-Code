import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ClipboardCopy, Copy, Eye, FilePlus2, FolderOpen, FolderPlus, GitCompare, PanelRight, Pencil, Search, SquareTerminal, Trash2, ListCollapse, RefreshCw } from "lucide-react";
import type { DirEntry } from "@/lib/types";
import { basename, dirname, join, relative, samePath } from "@/lib/path";
import { matchesAny } from "@/lib/glob";
import { backend } from "@/lib/backend";
import { REVEAL_LABEL } from "@/lib/platform";
import { FileIcon } from "@/icons/FileIcon";
import { useWorkspace } from "@/stores/workspace";
import { useEditor, useActiveTab } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { effectiveExcludes, useProject } from "@/stores/project";
import { useSearch } from "@/stores/search";
import { useTerminal } from "@/stores/terminal";
import { ContextMenu, type MenuItem } from "@/components/ui";
import { copyText, createEntry, deleteEntry, duplicateEntry, moveEntry, renameEntry, validateName } from "@/app/fileOps";

const ROW_H = 28;
const INDENT = 18;

type Row = { kind: "entry"; entry: DirEntry; depth: number } | { kind: "create"; parent: string; depth: number; mode: "file" | "folder" };

function statusColor(code: string): string {
  if (code === "?" || code === "A") return "var(--diff-add)";
  if (code === "D" || code === "U") return "var(--diff-del)";
  return "var(--diff-mod)";
}

function InlineInput({ initial, depth, isDir, onCommit, onCancel }: { initial: string; depth: number; isDir: boolean; onCommit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without the extension, like VS Code.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 && !isDir ? dot : initial.length);
  }, [initial, isDir]);
  const error = value && validateName(value.replace(/[\\/]/g, ""));
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim() && !error) onCommit(value);
    else onCancel();
  };
  return (
    <div className="relative flex items-center gap-2 pr-2" style={{ height: ROW_H, paddingLeft: 8 + depth * INDENT }}>
      <FileIcon name={value || "file"} isDir={isDir} size={16} />
      <input
        ref={ref}
        data-testid="explorer-input"
        value={value}
        spellCheck={false}
        className={`h-[22px] min-w-0 flex-1 rounded-md border bg-[var(--bg-input)] px-1.5 text-[13px] text-[var(--text-main)] outline-none ${error ? "border-[var(--diff-del)]" : "border-[var(--accent)]"}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
      {error && <div className="absolute left-6 right-2 top-full z-10 rounded-md bg-[var(--diff-del)] px-2 py-1 text-[11px] text-white shadow-[var(--shadow-popup)]">{error}</div>}
    </div>
  );
}

export function ExplorerTree() {
  const root = useWorkspace((s) => s.root)!;
  const children = useWorkspace((s) => s.children);
  const expanded = useWorkspace((s) => s.expanded);
  const selected = useWorkspace((s) => s.selected);
  const creating = useWorkspace((s) => s.creating);
  const renaming = useWorkspace((s) => s.renaming);
  const deco = useWorkspace((s) => s.gitDecorations);
  const filesExclude = useSettings((s) => s.filesExclude);
  const projectSettings = useProject((s) => s.settings);
  const guides = useSettings((s) => s.explorerIndentGuides);
  const activeTab = useActiveTab();
  const dirtyPaths = useEditor(
    useShallow((s) =>
      Object.values(s.buffers)
        .filter((b) => b.dirty && b.path)
        .map((b) => b.path!),
    ),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entry: DirEntry | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const excludes = useMemo(() => effectiveExcludes(filesExclude, projectSettings), [filesExclude, projectSettings]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      if (creating && samePath(creating.parent, dir)) out.push({ kind: "create", parent: dir, depth, mode: creating.kind });
      for (const e of children[dir] ?? []) {
        const rel = relative(root, e.path);
        if (rel && excludes.length && matchesAny(rel, excludes)) continue;
        out.push({ kind: "entry", entry: e, depth });
        if (e.isDir && expanded[e.path]) walk(e.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [root, children, expanded, creating, excludes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row in view (reveal, keyboard).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selected) return;
    const i = rows.findIndex((r) => r.kind === "entry" && samePath(r.entry.path, selected));
    if (i < 0) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selected, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 8);

  const open = (e: DirEntry, preview: boolean) => {
    useWorkspace.getState().select(e.path);
    if (e.isDir) void useWorkspace.getState().toggleDir(e.path);
    else void useEditor.getState().openFile(e.path, { preview, focus: !preview });
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.kind === "entry" && selected && samePath(r.entry.path, selected));
    const cur = i >= 0 ? (rows[i] as Extract<Row, { kind: "entry" }>) : null;
    const move = (d: number) => {
      let j = i + d;
      while (j >= 0 && j < rows.length && rows[j].kind !== "entry") j += d;
      const r = rows[j];
      if (r?.kind === "entry") useWorkspace.getState().select(r.entry.path);
    };
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        ev.preventDefault();
        move(-1);
        break;
      case "ArrowRight":
        if (cur?.entry.isDir) void useWorkspace.getState().toggleDir(cur.entry.path, true);
        break;
      case "ArrowLeft":
        if (cur?.entry.isDir && expanded[cur.entry.path]) void useWorkspace.getState().toggleDir(cur.entry.path, false);
        else if (cur) useWorkspace.getState().select(samePath(dirname(cur.entry.path), root) ? cur.entry.path : dirname(cur.entry.path));
        break;
      case "Enter":
        if (cur) open(cur.entry, false);
        break;
      case "F2":
        if (cur) useWorkspace.getState().startRename(cur.entry.path);
        break;
      case "Delete":
        if (cur) void deleteEntry(cur.entry.path);
        break;
    }
  };

  const menuItems = (entry: DirEntry | null): MenuItem[] => {
    const target = entry ?? ({ path: root, isDir: true, name: basename(root) } as DirEntry);
    const dir = target.isDir ? target.path : dirname(target.path);
    const rel = relative(root, target.path) ?? target.path;
    const status = deco[rel];
    const items: MenuItem[] = [];
    if (entry && !entry.isDir) {
      items.push(
        { icon: <FolderOpen size={14} />, label: "Open", onClick: () => open(entry, false) },
        { icon: <PanelRight size={14} />, label: "Open to the Side", onClick: () => void useEditor.getState().openFile(entry.path, { side: true }) },
      );
      if (/\.(md|markdown|mdx)$/i.test(entry.name))
        items.push({
          icon: <Eye size={14} />,
          label: "Open Preview",
          onClick: async () => {
            await useEditor.getState().openFile(entry.path);
            const b = Object.values(useEditor.getState().buffers).find((x) => x.path && samePath(x.path, entry.path));
            if (b) useEditor.getState().openPreview(b.id);
          },
        });
      if (status && status !== "dirty-folder" && status.status !== "?")
        items.push({ icon: <GitCompare size={14} />, label: "Open Changes", onClick: () => void useEditor.getState().openDiff(entry.path) });
      items.push("separator");
    }
    items.push(
      { icon: <FilePlus2 size={14} />, label: "New File…", onClick: () => useWorkspace.getState().startCreate("file", dir) },
      { icon: <FolderPlus size={14} />, label: "New Folder…", onClick: () => useWorkspace.getState().startCreate("folder", dir) },
    );
    if (entry) {
      items.push(
        "separator",
        { icon: <Pencil size={14} />, label: "Rename…", combo: "F2", onClick: () => useWorkspace.getState().startRename(entry.path) },
        { icon: <Copy size={14} />, label: "Duplicate", onClick: () => void duplicateEntry(entry.path) },
        { icon: <Trash2 size={14} />, label: "Delete", combo: "Delete", danger: true, onClick: () => void deleteEntry(entry.path) },
      );
    }
    items.push(
      "separator",
      { icon: <ClipboardCopy size={14} />, label: "Copy Path", onClick: () => copyText(target.path, "Path copied") },
      { icon: <ClipboardCopy size={14} />, label: "Copy Relative Path", onClick: () => copyText(rel || ".", "Relative path copied") },
      { icon: <FolderOpen size={14} />, label: REVEAL_LABEL, onClick: () => void backend().revealInExplorer(target.path) },
      { icon: <SquareTerminal size={14} />, label: "Open in Terminal", onClick: () => void useTerminal.getState().create(dir) },
    );
    if (target.isDir)
      items.push({
        icon: <Search size={14} />,
        label: "Find in Folder…",
        onClick: () => {
          const rel = relative(root, dir) || "";
          useSearch.getState().seed({ include: rel ? rel + "/**" : "" });
          useEditor.getState().openSearch();
        },
      });
    if (!entry)
      items.push(
        "separator",
        { icon: <RefreshCw size={14} />, label: "Refresh", onClick: () => void useWorkspace.getState().refreshTree() },
        { icon: <ListCollapse size={14} />, label: "Collapse All", onClick: () => useWorkspace.getState().collapseAll() },
      );
    return items;
  };

  const onDrop = async (targetDir: string, ev: React.DragEvent) => {
    ev.preventDefault();
    setDropTarget(null);
    const src = ev.dataTransfer.getData("application/x-nox-path");
    if (!src || samePath(dirname(src), targetDir)) return;
    await moveEntry(src, join(targetDir, basename(src)));
  };

  return (
    <div
      ref={scrollRef}
      role="tree"
      tabIndex={0}
      data-testid="explorer-tree"
      className="no-native-scrollbar relative min-h-0 flex-1 overflow-y-auto outline-none"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ at: { x: e.clientX, y: e.clientY }, entry: null });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-nox-path")) {
          e.preventDefault();
          setDropTarget(root);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}
      onDrop={(e) => void onDrop(root, e)}
    >
      <div style={{ height: rows.length * ROW_H + 8, position: "relative" }} className={dropTarget === root ? "rounded-xl bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]" : ""}>
        {rows.slice(first, last).map((row, k) => {
          const index = first + k;
          const top = index * ROW_H;
          if (row.kind === "create") {
            return (
              <div key={"create:" + row.parent} style={{ position: "absolute", top, left: 0, right: 0 }}>
                <InlineInput
                  initial=""
                  depth={row.depth}
                  isDir={row.mode === "folder"}
                  onCommit={(v) => {
                    useWorkspace.getState().cancelEdit();
                    void createEntry(row.parent, v, row.mode);
                  }}
                  onCancel={() => useWorkspace.getState().cancelEdit()}
                />
              </div>
            );
          }
          const e = row.entry;
          const rel = relative(root, e.path) ?? "";
          const d = deco[rel];
          const isActive = !!activeTab?.path && samePath(activeTab.path, e.path);
          const isSelected = !!selected && samePath(selected, e.path);
          const isOpen = !!expanded[e.path];
          if (renaming && samePath(renaming, e.path)) {
            return (
              <div key={e.path} style={{ position: "absolute", top, left: 0, right: 0 }}>
                <InlineInput initial={e.name} depth={row.depth} isDir={e.isDir} onCommit={(v) => void renameEntry(e.path, v)} onCancel={() => useWorkspace.getState().startRename(null)} />
              </div>
            );
          }
          const nameColor = d && d !== "dirty-folder" ? statusColor(d.status) : undefined;
          const dirty = !e.isDir && dirtyPaths.some((p) => samePath(p, e.path));
          return (
            <div
              key={e.path}
              role="treeitem"
              aria-expanded={e.isDir ? isOpen : undefined}
              aria-selected={isSelected}
              data-path={e.path}
              data-testid="tree-row"
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData("application/x-nox-path", e.path);
                // Files can also be dropped on the editor (open / split).
                if (!e.isDir) ev.dataTransfer.setData("application/x-nox-file", e.path);
                ev.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(ev) => {
                if (!ev.dataTransfer.types.includes("application/x-nox-path")) return;
                ev.preventDefault();
                ev.stopPropagation();
                setDropTarget(e.isDir ? e.path : dirname(e.path));
              }}
              onDrop={(ev) => {
                ev.stopPropagation();
                void onDrop(e.isDir ? e.path : dirname(e.path), ev);
              }}
              onClick={() => open(e, true)}
              onDoubleClick={() => !e.isDir && open(e, false)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                useWorkspace.getState().select(e.path);
                setMenu({ at: { x: ev.clientX, y: ev.clientY }, entry: e });
              }}
              className={`group absolute left-0 right-0 flex cursor-pointer items-center gap-2 rounded-lg pr-2 text-[13.5px] text-[var(--text-main)] ${
                dropTarget && e.isDir && samePath(dropTarget, e.path)
                  ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : isActive
                    ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                    : isSelected
                      ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                      : "hover:bg-[var(--hover-bg)]"
              }`}
              style={{ top, height: ROW_H, paddingLeft: 8 + row.depth * INDENT }}
            >
              {guides &&
                Array.from({ length: row.depth }, (_, g) => (
                  <span key={g} aria-hidden data-guide className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--text-dim)_60%,transparent)]" style={{ left: 8 + g * INDENT + 7.5 }} />
                ))}
              <FileIcon name={e.name} isDir={e.isDir} open={isOpen} size={16} />
              <span data-testid="tree-name" className={`min-w-0 flex-1 truncate ${e.name.startsWith(".") ? "opacity-75" : ""}`} style={{ color: nameColor }}>
                {e.name}
              </span>
              {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-main)]" title="Unsaved changes" />}
              {d === "dirty-folder" && <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70" style={{ background: "var(--diff-mod)" }} />}
              {d && d !== "dirty-folder" && (
                <span className="w-3 shrink-0 text-center font-mono text-[10.5px] font-semibold" style={{ color: nameColor }}>
                  {d.status === "?" ? "U" : d.status}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu ? menuItems(menu.entry) : []} onClose={() => setMenu(null)} />
    </div>
  );
}
