import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Theme } from "@/themes/types";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "@/themes/builtin";
import { DEFAULT_ICON_THEME, type IconRule } from "@/icons/iconThemes";

export type LineNumbers = "on" | "relative" | "off";
export type CursorStyle = "line" | "block" | "underline";
export type AutoSave = "off" | "afterDelay" | "onFocusChange";
export type Whitespace = "none" | "boundary" | "all";
export type IconWeight = "thin" | "regular" | "bold";

export interface SettingsState {
  themeId: string;
  customThemes: Theme[];
  /** Follow the OS light / dark preference with these two themes. */
  followSystem: boolean;
  lightThemeId: string;
  darkThemeId: string;
  iconTheme: string;
  iconRules: IconRule[];
  iconWeight: IconWeight;
  uiScale: number;
  uiFont: string;
  /** "islands": panels float with space all around; "docked": flush with the window edges away from the sidebar. */
  layout: "islands" | "docked";

  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  ligatures: boolean;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: LineNumbers;
  highlightActiveLine: boolean;
  renderWhitespace: Whitespace;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollPastEnd: boolean;
  bracketMatching: boolean;
  autoSave: AutoSave;
  autoSaveDelay: number;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;

  sidebarSide: "left" | "right";
  sidebarWidth: number;
  sidebarHidden: boolean;
  panelHeight: number;
  showStatusBar: boolean;
  showBreadcrumbs: boolean;
  /** The split button at the end of each group's tab bar. */
  tabBarSplit: boolean;
  /** The "…" menu at the end of each group's tab bar. */
  tabBarMenu: boolean;
  /** Vertical lines under expanded folders in the explorer. */
  explorerIndentGuides: boolean;
  /** "compact" hides the title bar menus behind a single button. */
  titleMenus: "bar" | "compact";
  /** "compact" hides the view switcher and settings behind a single button. */
  titleActions: "bar" | "compact";
  previewTabs: boolean;
  restoreSession: boolean;
  confirmDelete: boolean;
  filesExclude: string;

  /** Default shell profile id ("" = system default). */
  terminalProfile: string;
  /** Custom command line, used when no profile is chosen. */
  terminalShell: string;
  terminalFontSize: number;
  terminalCursor: "block" | "bar" | "underline";

  extEnabled: Record<string, boolean>;
  extSettings: Record<string, Record<string, unknown>>;
  keybindings: Record<string, string | null>;
  recentProjects: string[];
}

export const DEFAULT_SETTINGS: SettingsState = {
  themeId: DEFAULT_THEME_ID,
  customThemes: [],
  followSystem: false,
  lightThemeId: "nox-light",
  darkThemeId: DEFAULT_THEME_ID,
  iconTheme: DEFAULT_ICON_THEME,
  iconRules: [],
  iconWeight: "regular",
  uiScale: 1,
  uiFont: "Inter",
  layout: "islands",

  fontFamily: "JetBrains Mono, Cascadia Code, Fira Code, SF Mono, Menlo, Consolas, DejaVu Sans Mono, Ubuntu Mono, monospace",
  fontSize: 14,
  lineHeight: 1.6,
  ligatures: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: "on",
  highlightActiveLine: true,
  renderWhitespace: "none",
  cursorStyle: "line",
  cursorBlink: true,
  scrollPastEnd: true,
  bracketMatching: true,
  autoSave: "off",
  autoSaveDelay: 1000,
  trimTrailingWhitespace: false,
  insertFinalNewline: true,

  sidebarSide: "left",
  sidebarWidth: 272,
  sidebarHidden: false,
  panelHeight: 260,
  showStatusBar: true,
  showBreadcrumbs: true,
  tabBarSplit: true,
  tabBarMenu: true,
  explorerIndentGuides: true,
  titleMenus: "bar",
  titleActions: "bar",
  previewTabs: true,
  restoreSession: true,
  confirmDelete: true,
  filesExclude: ".git, .DS_Store, Thumbs.db",

  terminalProfile: "",
  terminalShell: "",
  terminalFontSize: 13,
  terminalCursor: "bar",

  extEnabled: {},
  extSettings: {},
  keybindings: {},
  recentProjects: [],
};

interface Actions {
  set<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void;
  patch(p: Partial<SettingsState>): void;
  saveCustomTheme(t: Theme): void;
  deleteCustomTheme(id: string): void;
  addIconRule(r: IconRule): void;
  updateIconRule(id: string, r: Partial<IconRule>): void;
  removeIconRule(id: string): void;
  setExtEnabled(id: string, on: boolean): void;
  setExtSetting(id: string, key: string, value: unknown): void;
  setKeybinding(command: string, combo: string | null | undefined): void;
  pushRecent(path: string): void;
  removeRecent(path: string): void;
  resetAll(): void;
}

export const useSettings = create<SettingsState & Actions>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      patch: (p) => set(p),
      saveCustomTheme: (t) =>
        set((s) => ({
          customThemes: s.customThemes.some((x) => x.id === t.id) ? s.customThemes.map((x) => (x.id === t.id ? t : x)) : [...s.customThemes, t],
        })),
      deleteCustomTheme: (id) =>
        set((s) => ({
          customThemes: s.customThemes.filter((t) => t.id !== id),
          themeId: s.themeId === id ? DEFAULT_THEME_ID : s.themeId,
        })),
      addIconRule: (r) => set((s) => ({ iconRules: [...s.iconRules, r] })),
      updateIconRule: (id, r) => set((s) => ({ iconRules: s.iconRules.map((x) => (x.id === id ? { ...x, ...r } : x)) })),
      removeIconRule: (id) => set((s) => ({ iconRules: s.iconRules.filter((x) => x.id !== id) })),
      setExtEnabled: (id, on) => set((s) => ({ extEnabled: { ...s.extEnabled, [id]: on } })),
      setExtSetting: (id, key, value) =>
        set((s) => ({ extSettings: { ...s.extSettings, [id]: { ...s.extSettings[id], [key]: value } } })),
      setKeybinding: (command, combo) =>
        set((s) => {
          const next = { ...s.keybindings };
          if (combo === undefined) delete next[command];
          else next[command] = combo;
          return { keybindings: next };
        }),
      pushRecent: (path) => set((s) => ({ recentProjects: [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, 12) })),
      removeRecent: (path) => set((s) => ({ recentProjects: s.recentProjects.filter((p) => p !== path) })),
      resetAll: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "nox.settings",
      version: 2,
      // v2: Nox Flow replaced Nox Glyphs as the default icon theme.
      migrate: (persisted, version) => {
        const p = persisted as Partial<SettingsState>;
        if (version < 2 && p.iconTheme === "glyphs") p.iconTheme = "flow";
        return p as SettingsState;
      },
      storage: createJSONStorage(() => localStorage),
      // Unknown keys from older versions are dropped, missing ones defaulted.
      merge: (persisted, current) => {
        const p = { ...(persisted as Partial<SettingsState>) };
        // 0.2.0 called the docked layout "flat".
        if ((p.layout as string) === "flat") p.layout = "docked";
        return { ...current, ...p };
      },
    },
  ),
);

export function allThemes(s: Pick<SettingsState, "customThemes"> = useSettings.getState()): Theme[] {
  return [...BUILTIN_THEMES, ...s.customThemes];
}

export function findTheme(id: string, s: Pick<SettingsState, "customThemes"> = useSettings.getState()): Theme {
  return allThemes(s).find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function useActiveTheme(): Theme {
  const themeId = useSettings((s) => s.themeId);
  const customThemes = useSettings((s) => s.customThemes);
  return findTheme(themeId, { customThemes });
}
