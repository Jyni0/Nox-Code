import { create } from "zustand";

/** Live caret info for the status bar, from the focused editor. */
interface CursorState {
  line: number;
  col: number;
  selections: number;
  selected: number;
  lines: number;
  words: number | null;
  vimMode: string | null;
  set(p: Partial<Omit<CursorState, "set">>): void;
}

export const useCursor = create<CursorState>((set) => ({
  line: 1,
  col: 1,
  selections: 1,
  selected: 0,
  lines: 1,
  words: null,
  vimMode: null,
  set: (p) => set(p),
}));
