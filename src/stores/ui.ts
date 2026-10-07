import { create } from "zustand";
import type { ReactNode } from "react";
import { useSettings } from "./settings";

export type SideView = "explorer" | "git" | "extensions";
export type SettingsSection =
  | "appearance"
  | "layout"
  | "themes"
  | "icons"
  | "editor"
  | "typing"
  | "files"
  | "terminal"
  | "keybindings"
  | "extensions"
  | "about";

export interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  icon?: ReactNode;
  /** Right-aligned hint (shortcut, kind…). */
  hint?: ReactNode;
  group?: string;
}

export interface QuickPickRequest {
  placeholder: string;
  items: QuickPickItem[];
  /** Pre-selected item id. */
  activeId?: string;
  onAccept(item: QuickPickItem): void;
  /** Live preview while moving through the list (themes). */
  onHighlight?(item: QuickPickItem): void;
  onCancel?(): void;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  message: string;
  detail?: string;
}

export interface DialogButton {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
}

export interface DialogRequest {
  title: string;
  message?: ReactNode;
  buttons: DialogButton[];
  /** Button chosen by Escape / clicking outside. */
  cancelId: string;
  resolve(id: string): void;
}

interface UiState {
  sideView: SideView;
  panelOpen: boolean;
  panelMaximized: boolean;
  zen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  /** Element to scroll to inside the settings page (extension id, theme id…). */
  settingsFocus: string | null;
  paletteOpen: boolean;
  paletteQuery: string;
  /** Bumps on every open: the palette remounts with fresh state. */
  paletteNonce: number;
  quickPick: QuickPickRequest | null;
  toasts: Toast[];
  dialog: DialogRequest | null;
  /** Text the search view should search for when it opens. */
  aboutOpen: boolean;

  setSideView(v: SideView): void;
  showSideView(v: SideView): void;
  togglePanel(open?: boolean): void;
  setPanelMaximized(v: boolean): void;
  toggleZen(): void;
  openSettings(section?: SettingsSection, focus?: string | null): void;
  closeSettings(): void;
  openPalette(query?: string): void;
  closePalette(): void;
  pick(req: QuickPickRequest): void;
  closeQuickPick(): void;
  toast(message: string, kind?: Toast["kind"], detail?: string): void;
  dismissToast(id: number): void;
  ask(req: Omit<DialogRequest, "resolve">): Promise<string>;
  closeDialog(id: string): void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  sideView: "explorer",
  panelOpen: false,
  panelMaximized: false,
  zen: false,
  settingsOpen: false,
  settingsSection: "appearance",
  settingsFocus: null,
  paletteOpen: false,
  paletteQuery: "",
  paletteNonce: 0,
  quickPick: null,
  toasts: [],
  dialog: null,
  aboutOpen: false,

  setSideView: (v) => set({ sideView: v }),
  showSideView: (v) => {
    if (useSettings.getState().sidebarHidden) useSettings.getState().set("sidebarHidden", false);
    set({ sideView: v, zen: false });
  },
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen, panelMaximized: open === false ? false : s.panelMaximized })),
  setPanelMaximized: (v) => set({ panelMaximized: v }),
  toggleZen: () => set((s) => ({ zen: !s.zen })),
  openSettings: (section, focus = null) =>
    set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection, settingsFocus: focus })),
  closeSettings: () => set({ settingsOpen: false, settingsFocus: null }),
  openPalette: (query = "") => set((s) => ({ paletteOpen: true, paletteQuery: query, quickPick: null, paletteNonce: s.paletteNonce + 1 })),
  closePalette: () => set({ paletteOpen: false }),
  pick: (req) => set((s) => ({ quickPick: req, paletteOpen: false, paletteNonce: s.paletteNonce + 1 })),
  closeQuickPick: () => set({ quickPick: null }),
  toast: (message, kind = "info", detail) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message, detail }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (req) =>
    new Promise<string>((resolve) => {
      // A dialog already open is answered with its cancel button first.
      get().dialog?.resolve(get().dialog!.cancelId);
      set({ dialog: { ...req, resolve } });
    }),
  closeDialog: (id) => {
    const d = get().dialog;
    set({ dialog: null });
    d?.resolve(id);
  },
}));

export const toast = (message: string, kind?: Toast["kind"], detail?: string) => useUi.getState().toast(message, kind, detail);

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}
