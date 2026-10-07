/** Project search: the state behind the Search tab, kept while the tab is closed. */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import type { SearchOptions, SearchResult } from "@/lib/types";
import { errorMessage } from "./ui";
import { useWorkspace } from "./workspace";

export interface SearchState {
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
  showReplace: boolean;
  showFilters: boolean;

  result: SearchResult | null;
  error: string | null;
  busy: boolean;
  /** Files hidden from the results with ×. */
  dismissed: string[];
  /** Files folded to just their header. */
  collapsed: Record<string, boolean>;
  /** Index of the selected match across all files. */
  current: number;
  /** Bumps when the query field should take focus. */
  focusNonce: number;
}

interface Actions {
  patch(p: Partial<SearchState>): void;
  options(): SearchOptions;
  run(): Promise<void>;
  /** Open with this text and/or folder filter (selection, "Find in Folder…"). */
  seed(s: { text?: string; include?: string }): void;
}

let runId = 0;

export const useSearch = create<SearchState & Actions>()((set, get) => ({
  query: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: "",
  exclude: "",
  showReplace: false,
  showFilters: false,
  result: null,
  error: null,
  busy: false,
  dismissed: [],
  collapsed: {},
  current: 0,
  focusNonce: 0,

  patch: (p) => set(p),

  options: () => {
    const s = get();
    return { query: s.query, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, regex: s.regex, include: s.include, exclude: s.exclude, maxResults: 5000 };
  },

  async run() {
    const root = useWorkspace.getState().root;
    const opts = get().options();
    const id = ++runId;
    if (!root || !opts.query) {
      set({ result: null, error: null, busy: false, current: 0 });
      return;
    }
    set({ busy: true });
    try {
      const result = await backend().search(root, opts);
      if (id !== runId) return;
      set({ result, error: null, dismissed: [], current: 0 });
    } catch (e) {
      if (id !== runId) return;
      set({ result: null, error: errorMessage(e) });
    } finally {
      if (id === runId) set({ busy: false });
    }
  },

  seed: ({ text, include }) =>
    set((s) => ({
      query: text ? text : s.query,
      include: include ?? s.include,
      showFilters: include ? true : s.showFilters,
      focusNonce: s.focusNonce + 1,
    })),
}));
