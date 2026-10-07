/**
 * Command palette + file finder + generic quick pick, one surface:
 *   ""  files   ">" commands   ":" go to line
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, CornerDownLeft, Hash, Search, TerminalSquare } from "lucide-react";
import { useUi, type QuickPickItem } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { allCommands, isAvailable, keysFor, runCommand } from "@/core/commands";
import { fuzzyFilter } from "@/lib/fuzzy";
import { basename, dirname, join } from "@/lib/path";
import { FileIcon } from "@/icons/FileIcon";
import { activeView } from "@/editor/viewRegistry";
import { Kbd, cx } from "@/components/ui";

interface Row {
  id: string;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  positions?: number[];
  group?: string;
  run: () => void;
}

const RECENT_KEY = "nox.recentCommands";
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const pushRecent = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* private mode */
  }
};

function Label({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {text.split("").map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-[var(--accent)]">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function Palette() {
  const open = useUi((s) => s.paletteOpen || !!s.quickPick);
  const nonce = useUi((s) => s.paletteNonce);
  return open ? <PaletteBody key={nonce} /> : null;
}

function PaletteBody() {
  const quickPick = useUi((s) => s.quickPick);
  const initialQuery = useUi((s) => s.paletteQuery);
  const open = true;
  const [query, setQuery] = useState(() => (useUi.getState().quickPick ? "" : useUi.getState().paletteQuery));
  const [cursor, setCursor] = useState(() => {
    const qp = useUi.getState().quickPick;
    return qp?.activeId ? Math.max(0, qp.items.findIndex((i) => i.id === qp.activeId)) : 0;
  });
  const [files, setFiles] = useState<string[]>(() => useWorkspace.getState().fileList ?? []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const root = useWorkspace((s) => s.root);
  const acceptedRef = useRef(false);
  void initialQuery;

  useEffect(() => {
    inputRef.current?.focus();
    if (!useUi.getState().quickPick && root) void useWorkspace.getState().getFileList().then(setFiles).catch(() => setFiles([]));
  }, [root]);

  const mode: "pick" | "commands" | "line" | "files" = quickPick ? "pick" : query.startsWith(">") ? "commands" : query.startsWith(":") ? "line" : "files";

  const rows: Row[] = useMemo(() => {
    if (!open) return [];
    if (mode === "pick" && quickPick) {
      const res = fuzzyFilter(query, quickPick.items, (i) => i.label, 500);
      return res.map(({ item, positions }) => ({
        id: item.id,
        label: item.label,
        detail: item.description,
        icon: item.icon,
        hint: item.hint,
        positions,
        group: query ? undefined : item.group,
        run: () => {
          acceptedRef.current = true;
          quickPick.onAccept(item as QuickPickItem);
        },
      }));
    }
    if (mode === "commands") {
      const q = query.slice(1).trim();
      const cmds = allCommands().filter(isAvailable);
      const recent = loadRecent();
      const ordered = q ? cmds : [...recent.map((id) => cmds.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c), ...cmds.filter((c) => !recent.includes(c.id)).sort((a, b) => a.title.localeCompare(b.title))];
      return fuzzyFilter(q, ordered, (c) => `${c.category ? c.category + ": " : ""}${c.title}`, 300).map(({ item, positions }) => {
        const k = keysFor(item.id)[0];
        return {
          id: item.id,
          label: `${item.category ? item.category + ": " : ""}${item.title}`,
          positions,
          icon: <TerminalSquare size={14} className="text-[var(--text-dim)]" />,
          hint: k ? <Kbd combo={k} /> : undefined,
          group: !q && recent.includes(item.id) ? "Recently used" : undefined,
          run: () => {
            pushRecent(item.id);
            void runCommand(item.id);
          },
        };
      });
    }
    if (mode === "line") {
      const n = parseInt(query.slice(1), 10);
      const view = activeView();
      const total = view?.state.doc.lines ?? 0;
      if (!view) return [{ id: "none", label: "Open a file to go to a line", run: () => {} }];
      const [line, col] = query.slice(1).split(/[:,]/).map((x) => parseInt(x, 10));
      return [
        {
          id: "line",
          label: Number.isNaN(n) ? `Type a line number between 1 and ${total}` : `Go to line ${Math.min(line, total)}${col ? `, column ${col}` : ""}`,
          icon: <Hash size={14} className="text-[var(--text-dim)]" />,
          run: () => {
            if (Number.isNaN(line)) return;
            const ln = view.state.doc.line(Math.max(1, Math.min(line, total)));
            const pos = Math.min(ln.from + Math.max(0, (col || 1) - 1), ln.to);
            view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
            requestAnimationFrame(() => view.focus());
          },
        },
      ];
    }
    // Files: open tabs first when the query is empty.
    if (!root) {
      return [{ id: "open-folder", label: "Open a folder to search its files", icon: <ArrowRight size={14} />, run: () => void runCommand("file.openFolder") }];
    }
    const res = fuzzyFilter(query.trim(), files, (f) => f, 80);
    return res.map(({ item, positions }) => {
      const name = basename(item);
      const nameStart = item.length - name.length;
      return {
        id: item,
        label: name,
        detail: dirname(item),
        positions: positions.filter((p) => p >= nameStart).map((p) => p - nameStart),
        icon: <FileIcon name={name} size={15} />,
        run: () => void useEditor.getState().openFile(join(root, item)),
      };
    });
  }, [open, mode, query, quickPick, files, root]);

  useEffect(() => setCursor((c) => Math.min(c, Math.max(0, rows.length - 1))), [rows.length]);

  // Live preview (themes) while moving.
  useEffect(() => {
    if (mode !== "pick" || !quickPick?.onHighlight) return;
    const row = rows[cursor];
    const item = row && quickPick.items.find((i) => i.id === row.id);
    if (item) quickPick.onHighlight(item);
  }, [cursor, rows, mode, quickPick]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const close = () => {
    if (quickPick && !acceptedRef.current) quickPick.onCancel?.();
    useUi.getState().closePalette();
    useUi.getState().closeQuickPick();
  };

  const accept = (i: number) => {
    const row = rows[i];
    if (!row) return;
    const qp = quickPick;
    acceptedRef.current = true;
    useUi.getState().closePalette();
    useUi.getState().closeQuickPick();
    row.run();
    void qp;
  };

  const placeholder = quickPick
    ? quickPick.placeholder
    : mode === "commands"
      ? "Type a command"
      : mode === "line"
        ? "Go to line[:column]"
        : "Search files by name  ·  > commands  ·  : go to line";

  let lastGroup: string | undefined;

  return (
    <div className="fixed inset-0 z-[680]" onMouseDown={close} data-testid="palette">
      <motion.div
        className="absolute left-1/2 top-[54px] flex max-h-[min(520px,70vh)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-popup)]"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
          <Search size={15} className="shrink-0 text-[var(--text-dim)]" />
          <input
            ref={inputRef}
            autoFocus
            data-testid="palette-input"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)]"
            placeholder={placeholder}
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "PageDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 10, rows.length - 1));
              } else if (e.key === "PageUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 10, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                accept(cursor);
              }
            }}
          />
        </div>
        <div ref={listRef} className="no-native-scrollbar flex min-h-0 flex-col gap-0.5 overflow-y-auto border-t border-[var(--border-soft)] p-1.5" role="listbox">
          {rows.length === 0 && <div className="px-3 py-3 text-[12.5px] text-[var(--text-dim)]">{mode === "files" ? "No matching files" : "No matching results"}</div>}
          {rows.map((r, i) => {
            const header = r.group && r.group !== lastGroup ? r.group : null;
            lastGroup = r.group ?? lastGroup;
            return (
              <div key={r.id + i}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-dim)]">{header}</div>}
                <button
                  role="option"
                  aria-selected={i === cursor}
                  data-index={i}
                  data-testid="palette-row"
                  className={cx(
                    "flex min-h-[34px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] transition-colors",
                    i === cursor ? "bg-[var(--hover-bg)] text-[var(--text-main)]" : "text-[var(--text-muted)]",
                  )}
                  onMouseMove={() => i !== cursor && setCursor(i)}
                  onClick={() => accept(i)}
                >
                  {r.icon && <span className="flex w-4 shrink-0 items-center justify-center">{r.icon}</span>}
                  <span className="min-w-0 truncate">
                    <Label text={r.label} positions={r.positions} />
                  </span>
                  {r.detail && <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-dim)]">{r.detail}</span>}
                  {!r.detail && <span className="flex-1" />}
                  {r.hint}
                  {i === cursor && !r.hint && <CornerDownLeft size={12} className="shrink-0 text-[var(--text-dim)]" />}
                </button>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
