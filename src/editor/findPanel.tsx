/**
 * Find / replace inside a file, drawn like the project search tab: one field
 * with Aa / whole word / regex toggles, prev / next arrows and an "n/N"
 * counter, replace on a second row.
 */
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import { CaseSensitive, ChevronLeft, ChevronRight, Regex, Replace, ReplaceAll, Search, WholeWord, X } from "lucide-react";
import { SearchToggle, searchFieldCls, searchIconBtnCls, searchInputCls } from "@/components/editor/searchUi";

/** Counting stops here, so huge files stay responsive. */
const MAX_COUNT = 9999;

function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
  if (!query.search || !query.valid) return { total: 0, current: 0 };
  const sel = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    if (total >= MAX_COUNT) break;
  }
  return { total, current };
}

function FindPanel({ view, state }: { view: EditorView; state: EditorState }) {
  const query = getSearchQuery(state);
  const [showReplace, setShowReplace] = useState(!!query.replace);
  const inputRef = useRef<HTMLInputElement>(null);
  const { total, current } = countMatches(state, query);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const set = (p: Partial<{ search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) =>
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: query.search, replace: query.replace, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regexp: query.regexp, ...p }),
      ),
    });

  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };

  const onKey = (e: React.KeyboardEvent, field: "find" | "replace") => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (field === "replace") {
        if (e.ctrlKey && e.altKey) replaceAll(view);
        else replaceNext(view);
      } else if (e.shiftKey) findPrevious(view);
      else findNext(view);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2" style={{ fontFamily: "var(--font-ui)" }} data-testid="find-panel">
      <div className="flex items-center gap-1.5">
        <div className={searchFieldCls}>
          <Search size={13} className="shrink-0 text-[var(--text-dim)]" />
          <input
            ref={inputRef}
            main-field="true"
            aria-label="Find"
            data-testid="find-input"
            className={searchInputCls}
            placeholder="Find in file…"
            value={query.search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => onKey(e, "find")}
          />
          <SearchToggle on={query.caseSensitive} label="Match Case" onClick={() => set({ caseSensitive: !query.caseSensitive })}>
            <CaseSensitive size={15} />
          </SearchToggle>
          <SearchToggle on={query.wholeWord} label="Match Whole Word" onClick={() => set({ wholeWord: !query.wholeWord })}>
            <WholeWord size={15} />
          </SearchToggle>
          <SearchToggle on={query.regexp} label="Use Regular Expression" onClick={() => set({ regexp: !query.regexp })}>
            <Regex size={14} />
          </SearchToggle>
        </div>
        <SearchToggle on={showReplace} label="Toggle Replace" testId="find-replace-toggle" onClick={() => setShowReplace(!showReplace)}>
          <Replace size={14} />
        </SearchToggle>
        <button className={searchIconBtnCls} title="Previous Match (Shift+Enter)" aria-label="Previous match" disabled={!total} onMouseDown={(e) => e.preventDefault()} onClick={() => findPrevious(view)}>
          <ChevronLeft size={15} />
        </button>
        <button className={searchIconBtnCls} title="Next Match (Enter)" aria-label="Next match" disabled={!total} onMouseDown={(e) => e.preventDefault()} onClick={() => findNext(view)}>
          <ChevronRight size={15} />
        </button>
        <span className="min-w-[44px] text-center font-mono text-[11.5px] text-[var(--text-muted)]" data-testid="find-counter">
          {query.search && !query.valid ? "—" : `${current}/${total >= MAX_COUNT ? `${MAX_COUNT}+` : total}`}
        </span>
        <button className={searchIconBtnCls} title="Close (Escape)" aria-label="Close find" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1.5">
          <div className={searchFieldCls}>
            <Replace size={13} className="shrink-0 text-[var(--text-dim)]" />
            <input
              aria-label="Replace"
              data-testid="find-replace-input"
              className={searchInputCls}
              placeholder="Replace with…"
              value={query.replace}
              onChange={(e) => set({ replace: e.target.value })}
              onKeyDown={(e) => onKey(e, "replace")}
            />
          </div>
          <button className={searchIconBtnCls} title="Replace (Enter)" aria-label="Replace" disabled={!total} onClick={() => replaceNext(view)}>
            <Replace size={14} />
          </button>
          <button className={searchIconBtnCls} title="Replace All (Ctrl+Alt+Enter)" aria-label="Replace all" disabled={!total} onClick={() => replaceAll(view)}>
            <ReplaceAll size={14} />
          </button>
          {/* Keeps the replace row lined up with the counter and close button above. */}
          <span className="w-[calc(44px+2rem+0.375rem)] shrink-0" />
        </div>
      )}
    </div>
  );
}

/** `search({ createPanel })` hook: a React panel living inside CodeMirror's panel area. */
export function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search nox-find";
  let root: Root | null = null;
  const render = (state: EditorState) => root?.render(<FindPanel view={view} state={state} />);
  return {
    dom,
    top: true,
    mount() {
      root = createRoot(dom);
      render(view.state);
    },
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) render(u.state);
    },
    destroy() {
      const r = root;
      root = null;
      // Unmounting during CodeMirror's own update would warn; do it right after.
      queueMicrotask(() => r?.unmount());
    },
  };
}
