import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, CaseSensitive, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListFilter, Regex, Replace, ReplaceAll, Search, WholeWord, X } from "lucide-react";
import { backend } from "@/lib/backend";
import type { SearchFile } from "@/lib/types";
import { basename, dirname, samePath } from "@/lib/path";
import { detectLanguage } from "@/editor/languages";
import { highlightLines, type Token } from "@/editor/staticHighlight";
import { FileIcon } from "@/icons/FileIcon";
import { useSearch } from "@/stores/search";
import { useEditor } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { errorMessage, toast, useUi } from "@/stores/ui";
import { Kbd, Spinner, cx } from "@/components/ui";
import { SearchToggle, searchFieldCls, searchIconBtnCls, searchInputCls } from "./searchUi";

/** Lines of context around each match, and how many more each expand arrow shows. */
const CONTEXT = 2;
const EXPAND = 6;
const LINE_H = 20;

interface Excerpt {
  /** First line of the excerpt before any expanding: the key for its expand state. */
  key: number;
  start: number;
  end: number;
}

/** Match lines ± context, grown by the expand arrows, overlapping ranges merged. */
function excerpts(lines: number[], lineCount: number, grow: Record<number, { up: number; down: number }>, context: number): Excerpt[] {
  const base: Excerpt[] = [];
  for (const l of lines) {
    const start = Math.max(1, l - context);
    const end = Math.min(lineCount, l + context);
    const last = base[base.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else base.push({ key: start, start, end });
  }
  const out: Excerpt[] = [];
  for (const e of base) {
    const g = grow[e.key];
    const x = { key: e.key, start: Math.max(1, e.start - (g?.up ?? 0)), end: Math.min(lineCount, e.end + (g?.down ?? 0)) };
    const last = out[out.length - 1];
    if (last && x.start <= last.end + 1) last.end = Math.max(last.end, x.end);
    else out.push(x);
  }
  return out;
}

/** Indent depth of every line, for the guides; blank lines continue the guides around them. */
function indentLevels(lines: Token[][], tabSize: number): number[] {
  const raw = lines.map((l) => {
    const text = l.map((t) => t.text).join("");
    if (!text.trim()) return -1;
    let cols = 0;
    for (const ch of text) {
      if (ch === " ") cols++;
      else if (ch === "\t") cols += tabSize - (cols % tabSize);
      else break;
    }
    return Math.floor(cols / tabSize);
  });
  const out = [...raw];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] >= 0) continue;
    let a = i - 1;
    while (a >= 0 && raw[a] < 0) a--;
    let b = i + 1;
    while (b < raw.length && raw[b] < 0) b++;
    out[i] = Math.min(a >= 0 ? raw[a] : 0, b < raw.length ? raw[b] : 0);
  }
  return out;
}

interface Mark {
  col: number;
  len: number;
  id: string;
  current: boolean;
}

/** Syntax tokens with the matches painted over them. */
function renderLine(tokens: Token[], marks: Mark[]) {
  const out: React.ReactNode[] = [];
  let pos = 0;
  let k = 0;
  for (const t of tokens) {
    const end = pos + t.text.length;
    let at = pos;
    while (at < end) {
      const m = marks.find((x) => x.col <= at && at < x.col + Math.max(1, x.len));
      const next = m ? Math.min(end, m.col + Math.max(1, m.len)) : Math.min(end, ...marks.filter((x) => x.col > at).map((x) => x.col), end);
      const text = t.text.slice(at - pos, next - pos);
      out.push(
        m ? (
          <mark
            key={k++}
            data-match={m.id}
            className={cx(t.cls, "rounded-[3px] text-inherit", m.current ? "bg-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline outline-1 outline-[var(--accent)]" : "bg-[color-mix(in_srgb,var(--diff-mod)_32%,transparent)]")}
          >
            {text}
          </mark>
        ) : (
          <span key={k++} className={t.cls || undefined}>
            {text}
          </span>
        ),
      );
      at = next;
    }
    pos = end;
  }
  return out;
}

const FileResult = memo(function FileResult({
  file,
  index,
  currentId,
  showReplace,
  onOpen,
  onReplace,
  onDismiss,
}: {
  file: SearchFile;
  index: number;
  currentId: string | null;
  showReplace: boolean;
  onOpen: (file: SearchFile, line: number, col?: number, len?: number) => void;
  onReplace: (file: SearchFile) => void;
  onDismiss: (file: SearchFile) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [lines, setLines] = useState<Token[][] | null>(null);
  const collapsed = useSearch((s) => !!s.collapsed[file.path]);
  const setCollapsed = (v: boolean) => useSearch.setState((s) => ({ collapsed: { ...s.collapsed, [file.path]: v } }));
  const [grow, setGrow] = useState<Record<number, { up: number; down: number }>>({});
  const fontFamily = useSettings((s) => s.fontFamily);
  const tabSize = useSettings((s) => s.tabSize);

  // Read and highlight the file once it scrolls near the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void backend()
      .readFile(file.path)
      .then((c) => (c.binary ? null : highlightLines(c.content, detectLanguage(basename(file.path)))))
      .then((l) => live && setLines(l))
      .catch(() => live && setLines(null));
    return () => {
      live = false;
    };
  }, [visible, file]);

  const indents = useMemo(() => (lines ? indentLevels(lines, tabSize) : null), [lines, tabSize]);

  const byLine = useMemo(() => {
    const m = new Map<number, Array<{ col: number; len: number; i: number }>>();
    file.matches.forEach((x, i) => m.set(x.line, [...(m.get(x.line) ?? []), { col: x.col, len: x.len, i }]));
    return m;
  }, [file]);
  const matchLines = [...byLine.keys()].sort((a, b) => a - b);

  // Until the file is read, show just the matched lines from the search itself.
  const lineCount = lines ? lines.length : Number.MAX_SAFE_INTEGER;
  const tokensAt = (n: number): Token[] => lines?.[n - 1] ?? [{ text: file.matches.find((m) => m.line === n)?.preview ?? "", cls: "" }];
  const parts = lines ? excerpts(matchLines, lineCount, grow, CONTEXT) : matchLines.map((l) => ({ key: l, start: l, end: l }));
  const gutter = Math.max(3, String(lines ? lineCount : matchLines[matchLines.length - 1] ?? 1).length);
  const expand = (key: number, dir: "up" | "down") => setGrow((g) => ({ ...g, [key]: { up: (g[key]?.up ?? 0) + (dir === "up" ? EXPAND : 0), down: (g[key]?.down ?? 0) + (dir === "down" ? EXPAND : 0) } }));

  const arrow = (key: number, dir: "up" | "down") => (
    <button
      title={dir === "up" ? "Show more lines above" : "Show more lines below"}
      aria-label={dir === "up" ? "Expand up" : "Expand down"}
      className="flex h-full w-4 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
      onClick={(e) => {
        e.stopPropagation();
        expand(key, dir);
      }}
    >
      {dir === "up" ? <ArrowUpToLine size={12} /> : <ArrowDownToLine size={12} />}
    </button>
  );

  const rel = file.rel;
  const dir = dirname(rel);
  return (
    <div ref={ref} className="flex flex-col" data-testid="search-file">
      <div className="sticky top-0 z-10 bg-[var(--bg-editor)] px-1.5 pt-1.5">
      <div className="group flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[12.5px]">
        <button aria-label={collapsed ? "Expand" : "Collapse"} className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]" onClick={() => setCollapsed(!collapsed)}>
          <ChevronDown size={14} className={cx("transition-transform", collapsed && "-rotate-90")} />
        </button>
        <FileIcon name={basename(file.path)} size={16} />
        <button className="truncate font-medium text-[var(--text-main)] hover:underline" onClick={() => onOpen(file, file.matches[0]?.line ?? 1)}>
          {basename(rel)}
        </button>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-dim)]">{dir === "." ? "" : dir}</span>
        <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 font-mono text-[10px] text-[var(--text-muted)]">{file.matches.length}</span>
        {showReplace && (
          <button title="Replace All in File" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]" onClick={() => onReplace(file)}>
            <ReplaceAll size={13} />
          </button>
        )}
        <button
          className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
          onClick={() => onOpen(file, file.matches[0]?.line ?? 1)}
          title="Open File"
        >
          Open File <Kbd combo="Alt+Enter" />
        </button>
        <button title="Dismiss" aria-label="Dismiss" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]" onClick={() => onDismiss(file)}>
          <X size={13} />
        </button>
      </div>
      </div>
      {!collapsed && (
        <div className="no-native-scrollbar overflow-x-auto pb-1 pt-1.5" style={{ fontFamily, fontSize: 12.5, tabSize }}>
          <div className="min-w-max">
            {parts.map((p, pi) => (
              <div key={p.key} className={cx("py-0.5", pi > 0 && "border-t border-[var(--border-soft)]")}>
                {Array.from({ length: p.end - p.start + 1 }, (_, k) => {
                  const n = p.start + k;
                  const ms = byLine.get(n) ?? [];
                  const marks = ms.map((m) => ({ col: m.col, len: m.len, id: `${index}:${m.i}`, current: currentId === `${index}:${m.i}` }));
                  // Zed puts the expand arrows in the gutter of the excerpt's first and last line.
                  const up = !!lines && k === 0 && p.start > 1;
                  const down = !!lines && n === p.end && p.end < lineCount && !(up && p.start === p.end);
                  return (
                    <div
                      key={n}
                      data-testid={ms.length ? "search-match" : undefined}
                      className={cx("flex cursor-pointer items-center whitespace-pre hover:bg-[var(--hover-bg)]", ms.length ? "text-[var(--text-main)]" : "text-[var(--text-muted)]")}
                      style={{ height: LINE_H }}
                      onClick={() => onOpen(file, n, ms[0]?.col, ms[0]?.len)}
                    >
                      <span className="flex h-full w-6 shrink-0 select-none items-center justify-center">{up ? arrow(p.key, "up") : down ? arrow(p.key, "down") : null}</span>
                      <span className={cx("shrink-0 select-none pr-4 text-right", ms.length ? "text-[var(--text-main)]" : "text-[var(--text-dim)]")} style={{ width: `${gutter + 2}ch` }}>
                        {n}
                      </span>
                      <span className="relative h-full pr-6 leading-[20px]">
                        {Array.from({ length: indents?.[n - 1] ?? 0 }, (_, g) => (
                          <span key={g} aria-hidden data-guide className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--text-dim)_35%,transparent)]" style={{ left: `${g * tabSize + 0.5}ch` }} />
                        ))}
                        {renderLine(tokensAt(n), marks)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/** Project search as an editor tab, like Zed: a query bar over excerpts of every match. */
export function SearchTab({ paneId }: { paneId: string }) {
  const root = useWorkspace((s) => s.root);
  const s = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [s.focusNonce]);

  // Search as you type.
  useEffect(() => {
    const t = setTimeout(() => void useSearch.getState().run(), 250);
    return () => clearTimeout(t);
  }, [s.query, s.caseSensitive, s.wholeWord, s.regex, s.include, s.exclude, root]);

  const files = useMemo(() => (s.result?.files ?? []).filter((f) => !s.dismissed.some((d) => samePath(d, f.path))), [s.result, s.dismissed]);
  const flat = useMemo(() => files.flatMap((f, fi) => f.matches.map((m, mi) => ({ file: f, fi, mi, m }))), [files]);
  const total = flat.length;
  const allCollapsed = files.length > 0 && files.every((f) => s.collapsed[f.path]);
  const cur = total ? Math.min(s.current, total - 1) : -1;
  const currentId = cur >= 0 ? `${flat[cur].fi}:${flat[cur].mi}` : null;

  const go = (dir: 1 | -1) => {
    if (!total) return;
    const next = (cur + dir + total) % total;
    // Stepping into a folded file unfolds it.
    useSearch.setState((st) => ({ current: next, collapsed: { ...st.collapsed, [flat[next].file.path]: false } }));
    const id = `${flat[next].fi}:${flat[next].mi}`;
    // Scroll only the result list: scrollIntoView would also shift the pane and the tab bar.
    requestAnimationFrame(() => {
      const list = listRef.current;
      const el = list?.querySelector(`[data-match="${id}"]`);
      if (!list || !el) return;
      const r = el.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      if (r.top < l.top + 48 || r.bottom > l.bottom - 8) list.scrollTop += r.top - l.top - l.height / 2;
    });
  };

  const open = (file: SearchFile, line: number, col?: number, len?: number) =>
    void useEditor.getState().openFile(file.path, { paneId, preview: true, reveal: { line, col, len } });

  const openCurrent = () => {
    const x = cur >= 0 ? flat[cur] : null;
    if (x) open(x.file, x.m.line, x.m.col, x.m.len);
  };

  const doReplace = async (only?: SearchFile[]) => {
    if (!root || !s.query) return;
    const targets = only ?? files;
    const count = targets.reduce((n, f) => n + f.matches.length, 0);
    const dirty = Object.values(useEditor.getState().buffers).filter((b) => b.dirty && b.path && targets.some((f) => samePath(f.path, b.path!)));
    if (dirty.length) {
      const ans = await useUi.getState().ask({
        title: "Save files before replacing?",
        message: `${dirty.length} file(s) with matches have unsaved changes.`,
        buttons: [
          { id: "save", label: "Save and Replace", variant: "primary" },
          { id: "cancel", label: "Cancel" },
        ],
        cancelId: "cancel",
      });
      if (ans !== "save") return;
      for (const b of dirty) await useEditor.getState().save(b.id);
    }
    if (!only) {
      const ans = await useUi.getState().ask({
        title: `Replace ${count} occurrence${count === 1 ? "" : "s"} across ${targets.length} file${targets.length === 1 ? "" : "s"}?`,
        message: `“${s.query}” → “${s.replace}”`,
        buttons: [
          { id: "replace", label: "Replace", variant: "primary" },
          { id: "cancel", label: "Cancel" },
        ],
        cancelId: "cancel",
      });
      if (ans !== "replace") return;
    }
    try {
      const paths = targets.map((f) => f.path);
      const r = await backend().replace(root, useSearch.getState().options(), s.replace, paths);
      toast(`Replaced ${r.replacements} occurrence${r.replacements === 1 ? "" : "s"} in ${r.filesChanged} file${r.filesChanged === 1 ? "" : "s"}`, "success");
      await useEditor.getState().onDiskChange(paths);
      await useWorkspace.getState().refreshPaths(paths);
      await useSearch.getState().run();
    } catch (e) {
      toast("Replace failed", "error", errorMessage(e));
    }
  };

  const patch = useSearch.getState().patch;
  const iconBtn = searchIconBtnCls;

  return (
    <div
      className="absolute inset-0 flex flex-col"
      data-testid="search-tab"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.altKey) {
          e.preventDefault();
          openCurrent();
        }
      }}
    >
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            className={iconBtn}
            title={allCollapsed ? "Expand All" : "Collapse All"}
            aria-label={allCollapsed ? "Expand all" : "Collapse all"}
            data-testid="search-collapse-all"
            disabled={!files.length}
            onClick={() => patch({ collapsed: Object.fromEntries(files.map((f) => [f.path, !allCollapsed])) })}
          >
            {allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </button>
          <div className={searchFieldCls}>
            <Search size={13} className="shrink-0 text-[var(--text-dim)]" />
            <input
              ref={inputRef}
              aria-label="Search"
              data-testid="search-input"
              className={searchInputCls}
              placeholder="Search all files…"
              value={s.query}
              onChange={(e) => patch({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.altKey) return;
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              }}
            />
            <SearchToggle on={s.caseSensitive} label="Match Case" onClick={() => patch({ caseSensitive: !s.caseSensitive })}>
              <CaseSensitive size={15} />
            </SearchToggle>
            <SearchToggle on={s.wholeWord} label="Match Whole Word" onClick={() => patch({ wholeWord: !s.wholeWord })}>
              <WholeWord size={15} />
            </SearchToggle>
            <SearchToggle on={s.regex} label="Use Regular Expression" onClick={() => patch({ regex: !s.regex })}>
              <Regex size={14} />
            </SearchToggle>
          </div>
          <SearchToggle on={s.showFilters} label="Toggle Filters" testId="search-filters" onClick={() => patch({ showFilters: !s.showFilters })}>
            <ListFilter size={14} />
          </SearchToggle>
          <SearchToggle on={s.showReplace} label="Toggle Replace" testId="search-replace-toggle" onClick={() => patch({ showReplace: !s.showReplace })}>
            <Replace size={14} />
          </SearchToggle>
          <button className={iconBtn} title="Previous Match (Shift+Enter)" aria-label="Previous match" disabled={!total} onClick={() => go(-1)}>
            <ChevronLeft size={15} />
          </button>
          <button className={iconBtn} title="Next Match (Enter)" aria-label="Next match" disabled={!total} onClick={() => go(1)}>
            <ChevronRight size={15} />
          </button>
          <span className="min-w-[44px] text-center font-mono text-[11.5px] text-[var(--text-muted)]" data-testid="search-counter">
            {s.busy ? <Spinner size={11} /> : total ? `${cur + 1}/${total}` : "0/0"}
          </span>
        </div>
        {s.showReplace && (
          <div className="flex items-center gap-1.5">
            <div className={searchFieldCls}>
              <Replace size={13} className="shrink-0 text-[var(--text-dim)]" />
              <input aria-label="Replace" className={searchInputCls} placeholder="Replace with…" value={s.replace} onChange={(e) => patch({ replace: e.target.value })} />
            </div>
            <button className={iconBtn} title="Replace All" aria-label="Replace all" disabled={!total} onClick={() => void doReplace()}>
              <ReplaceAll size={14} />
            </button>
          </div>
        )}
        {s.showFilters && (
          <div className="flex items-center gap-1.5">
            <div className={searchFieldCls}>
              <input aria-label="Files to include" className={searchInputCls} placeholder="Include, e.g. src/**, *.ts" value={s.include} onChange={(e) => patch({ include: e.target.value })} />
            </div>
            <div className={searchFieldCls}>
              <input aria-label="Files to exclude" className={searchInputCls} placeholder="Exclude, e.g. **/dist/**" value={s.exclude} onChange={(e) => patch({ exclude: e.target.value })} />
            </div>
          </div>
        )}
        {(s.result || s.error) && (
          <div className="truncate px-1 text-[11.5px] text-[var(--text-dim)]" data-testid="search-summary">
            {s.error ? (
              <span className="text-[var(--diff-del)]">{s.error}</span>
            ) : total ? (
              `${total} result${total === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}${s.result?.truncated ? " (limited)" : ""}`
            ) : (
              "No results"
            )}
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {!root ? (
          <div className="px-6 py-10 text-center text-[12.5px] text-[var(--text-dim)]">Open a folder to search its files.</div>
        ) : !s.query ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-[12.5px] text-[var(--text-dim)]">
            <Search size={28} strokeWidth={1.4} className="opacity-60" />
            <span>Search every file in the project.</span>
            <span className="flex items-center gap-1.5">
              <Kbd combo="Enter" /> next match · <Kbd combo="Shift+Enter" /> previous · <Kbd combo="Alt+Enter" /> open file
            </span>
          </div>
        ) : (
          files.map((f, i) => (
            <FileResult
              key={f.path}
              file={f}
              index={i}
              currentId={currentId?.startsWith(`${i}:`) ? currentId : null}
              showReplace={s.showReplace}
              onOpen={open}
              onReplace={(file) => void doReplace([file])}
              onDismiss={(file) => patch({ dismissed: [...s.dismissed, file.path] })}
            />
          ))
        )}
      </div>
    </div>
  );
}
