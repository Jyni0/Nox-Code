import { useContext, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Braces, Brush, FolderTree, Info, Keyboard, Palette, PanelsTopLeft, Puzzle, Save, Search, Shapes, SquareCode, SquareTerminal, X, type LucideIcon } from "lucide-react";
import { useUi, type SettingsSection } from "@/stores/ui";
import { DEFAULT_SETTINGS, allThemes, useSettings } from "@/stores/settings";
import { EXTENSIONS, EXT_CATEGORIES, isExtEnabled } from "@/extensions/registry";
import { themeSwatch } from "@/themes/apply";
import { Button, Combobox, IconButton, Input, NavItem, ScrollArea, SectionHeading, Segmented, SettingRow, SettingsCard, SettingsQuery, Switch, cx } from "@/components/ui";
import { NoxMark } from "@/components/layout/Logo";
import { ExtIcon, ExtensionDetails } from "@/components/sidebar/ExtensionsView";
import { inTauri } from "@/lib/backend";
import { isMac } from "@/lib/keys";
import { CUSTOM_PROFILE, useTerminal } from "@/stores/terminal";
import { exportSettings, importSettings } from "@/stores/settingsJson";
import { errorMessage, toast } from "@/stores/ui";
import { copyText } from "@/app/fileOps";
import { ThemeStudio } from "./ThemeStudio";
import { IconsSettings } from "./IconsSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { CodePreview, ThemeThumb } from "./shared";

const NAV: Array<{ group: string; items: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> }> = [
  {
    group: "General",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "layout", label: "Layout", icon: PanelsTopLeft },
    ],
  },
  {
    group: "Editor",
    items: [
      { id: "editor", label: "Text Editor", icon: SquareCode },
      { id: "typing", label: "Typing & Saving", icon: Save },
      { id: "files", label: "Files & Explorer", icon: FolderTree },
    ],
  },
  {
    group: "Tools",
    items: [
      { id: "terminal", label: "Terminal", icon: SquareTerminal },
      { id: "keybindings", label: "Keyboard Shortcuts", icon: Keyboard },
    ],
  },
  {
    group: "Customize",
    items: [
      { id: "themes", label: "Theme Studio", icon: Brush },
      { id: "icons", label: "File Icons", icon: Shapes },
      { id: "extensions", label: "Extensions", icon: Puzzle },
    ],
  },
];

const TITLES: Record<SettingsSection, [string, string]> = {
  appearance: ["Appearance", "Color theme, interface zoom and font"],
  layout: ["Layout", "Window style, title bar, sidebar and breadcrumbs"],
  editor: ["Text Editor", "How code looks: font, line numbers, cursor"],
  typing: ["Typing & Saving", "Indentation and what happens on save"],
  files: ["Files & Explorer", "The file tree, tabs and sessions"],
  terminal: ["Terminal", "The integrated terminal"],
  keybindings: ["Keyboard Shortcuts", "Click the pencil, press the new keys, Enter to save"],
  themes: ["Theme Studio", "Edit every color, import VS Code themes, generate your own"],
  icons: ["File Icons", "Icon themes and your own icons for any file or folder"],
  extensions: ["Extensions", "Built-in extensions and their settings"],
  about: ["About", "Nox Code — a code editor for the night shift"],
};

const FONT_PRESETS = [
  "JetBrains Mono, Cascadia Code, Fira Code, SF Mono, Menlo, Consolas, DejaVu Sans Mono, Ubuntu Mono, monospace",
  "Cascadia Code, Consolas, monospace",
  "Fira Code, monospace",
  "Consolas, monospace",
  "Source Code Pro, monospace",
  "IBM Plex Mono, monospace",
  "SF Mono, Menlo, monospace",
  "ui-monospace, monospace",
];

function Num({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex w-[240px] items-center gap-3">
      <input
        type="range"
        className="range-theme flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-12 text-right font-mono text-[11.5px] text-[var(--text-muted)]">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function useS<K extends keyof typeof DEFAULT_SETTINGS>(key: K): [(typeof DEFAULT_SETTINGS)[K], (v: (typeof DEFAULT_SETTINGS)[K]) => void] {
  const v = useSettings((s) => s[key]);
  return [v, (nv) => useSettings.getState().set(key, nv)];
}

/** Miniature of the window: sidebar, editor and terminal. */
/** SVG path for a rectangle with its own radius per corner (tl, tr, br, bl). */
function roundRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) {
  return `M${x + tl},${y}H${x + w - tr}Q${x + w},${y} ${x + w},${y + tr}V${y + h - br}Q${x + w},${y + h} ${x + w - br},${y + h}H${x + bl}Q${x},${y + h} ${x},${y + h - bl}V${y + tl}Q${x},${y} ${x + tl},${y}Z`;
}

/** Miniature of the window: title bar, sidebar (on its real side), editor and terminal. */
function LayoutThumb({ docked }: { docked: boolean }) {
  const right = useSettings((s) => s.sidebarSide) === "right";
  const g = 3;
  const r = 4;
  const sideX = right ? 90 : 0;
  // The editor column: the sidebar side has no margin; docked drops the outer and bottom ones too.
  const x = right ? (docked ? 0 : g) : 30;
  const w = 90 - (docked ? 0 : g);
  const top = 7 + g;
  const bottom = docked ? 72 : 72 - g;
  const split = 46;
  // Corners on the sidebar side stay round; docked squares the ones touching the window.
  const outer = docked ? 0 : r;
  const low = docked ? 0 : r;
  // [tl, tr, br, bl]
  const editor = roundRect(x, top, w, split - top, right ? [outer, r, r, outer] : [r, outer, outer, r]);
  const terminal = roundRect(x, split + g, w, bottom - split - g, right ? [outer, r, low, outer] : [r, outer, outer, low]);
  const textX = x + 6;
  return (
    <svg viewBox="0 0 120 72" className="h-auto w-full rounded-xl" aria-hidden>
      <rect width="120" height="72" fill="var(--bg-titlebar)" />
      <rect x={sideX} y="7" width="30" height="65" fill="var(--bg-sidebar)" />
      <path d={editor} fill="var(--bg-editor)" />
      <path d={terminal} fill="var(--bg-editor)" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={textX} y={top + 6 + i * 6} width={[40, 28, 52, 20][i]} height="2" rx="1" fill="var(--accent)" opacity={0.25 + i * 0.12} />
      ))}
      <rect x={textX} y={split + g + 6} width="34" height="2" rx="1" fill="var(--diff-add)" opacity="0.5" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={sideX + 5} y={14 + i * 6} width={[18, 14, 16][i]} height="2" rx="1" fill="var(--text-dim)" opacity="0.5" />
      ))}
    </svg>
  );
}

function LayoutPicker() {
  const [layout, setLayout] = useS("layout");
  const options = [
    { id: "islands" as const, title: "Islands", hint: "Rounded panels with space all around" },
    { id: "docked" as const, title: "Docked", hint: "Flush with the window's bottom and outer edge" },
  ];
  return (
    <div className="grid max-w-[560px] grid-cols-2 gap-3" data-testid="layout-picker">
      {options.map((o) => (
        <button
          key={o.id}
          data-testid={`layout-${o.id}`}
          onClick={() => setLayout(o.id)}
          className={cx("flex flex-col gap-2 rounded-2xl p-2 text-left transition-colors hover:bg-[var(--hover-bg)]", layout === o.id && "bg-[var(--hover-bg)] ring-1 ring-[var(--accent)]")}
        >
          <LayoutThumb docked={o.id === "docked"} />
          <span className="px-1">
            <span className="block text-[12.5px] font-medium text-[var(--text-main)]">{o.title}</span>
            <span className="block text-[11.5px] text-[var(--text-dim)]">{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** A titled card of settings; the settings search hides it when none of its rows match. */
function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className="settings-group flex flex-col gap-2">
      <SectionHeading>{title}</SectionHeading>
      <SettingsCard className={className}>{children}</SettingsCard>
    </section>
  );
}

/** True while the settings search has a query: pictures and galleries step aside for matching rows. */
const useSearching = () => useContext(SettingsQuery).trim() !== "";

function Appearance() {
  const themeId = useSettings((s) => s.themeId);
  const customThemes = useSettings((s) => s.customThemes);
  const [followSystem, setFollow] = useS("followSystem");
  const [lightId, setLight] = useS("lightThemeId");
  const [darkId, setDark] = useS("darkThemeId");
  const [scale, setScale] = useS("uiScale");
  const [uiFont, setUiFont] = useS("uiFont");
  const searching = useSearching();
  const themes = allThemes({ customThemes });
  const opts = (kind: "dark" | "light") => themes.filter((t) => t.kind === kind).map((t) => ({ value: t.id, label: t.name, swatch: themeSwatch(t).slice(0, 3) }));

  return (
    <div className="flex flex-col gap-5">
      {!searching && (
        <section className="flex flex-col gap-2">
          <SectionHeading>Color theme · {themes.length}</SectionHeading>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="theme-gallery">
            {themes.map((t) => (
              <button
                key={t.id}
                data-testid="theme-card"
                data-theme-id={t.id}
                onClick={() => useSettings.getState().patch({ themeId: t.id, followSystem: false })}
                className={cx("flex flex-col gap-1.5 rounded-2xl p-1.5 text-left transition-colors hover:bg-[var(--hover-bg)]", t.id === themeId && "bg-[var(--hover-bg)] ring-1 ring-[var(--accent)]")}
              >
                <ThemeThumb theme={t} />
                <span className="flex items-center gap-1.5 px-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-main)]">{t.name}</span>
                  <span className="text-[10px] text-[var(--text-dim)]">{t.builtin ? t.kind : "custom"}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <Group title="Theme">
        <SettingRow title="Follow system appearance" hint="Switch between a light and a dark theme with the OS." keywords="color theme dark light mode auto">
          <Switch on={followSystem} onChange={setFollow} ariaLabel="Follow system" />
        </SettingRow>
        {followSystem && (
          <>
            <SettingRow title="Light theme" keywords="color theme">
              <Combobox className="w-[240px]" options={opts("light")} value={lightId} onChange={setLight} />
            </SettingRow>
            <SettingRow title="Dark theme" keywords="color theme">
              <Combobox className="w-[240px]" options={opts("dark")} value={darkId} onChange={setDark} />
            </SettingRow>
          </>
        )}
      </Group>
      <Group title="Interface">
        <SettingRow title="Interface zoom" hint="Ctrl+= / Ctrl+- / Ctrl+0" keywords="scale size ui">
          <Num value={Math.round(scale * 100)} min={70} max={160} step={5} suffix="%" onChange={(n) => setScale(n / 100)} />
        </SettingRow>
        <SettingRow title="Interface font" hint="Used for menus, tabs and panels" keywords="ui typeface">
          <Input className="w-[240px]" value={uiFont} onChange={(e) => setUiFont(e.target.value)} />
        </SettingRow>
      </Group>
      {!searching && (
        <SettingsCard className="p-2">
          <CodePreview height={260} />
        </SettingsCard>
      )}
    </div>
  );
}

function LayoutSettings() {
  const [side, setSide] = useS("sidebarSide");
  const [status, setStatus] = useS("showStatusBar");
  const [crumbs, setCrumbs] = useS("showBreadcrumbs");
  const [menus, setMenus] = useS("titleMenus");
  const [actions, setActions] = useS("titleActions");
  const [tabSplit, setTabSplit] = useS("tabBarSplit");
  const [tabMenu, setTabMenu] = useS("tabBarMenu");
  const searching = useSearching();
  const fold = [
    { value: "bar" as const, label: "Always shown" },
    { value: "compact" as const, label: "Behind a button" },
  ];
  return (
    <div className="flex flex-col gap-5">
      {!searching && (
        <section className="flex flex-col gap-2">
          <SectionHeading>Window</SectionHeading>
          <LayoutPicker />
        </section>
      )}
      <Group title="Title bar">
        <SettingRow title="Menus" hint="File, Edit, View… — behind one button, they show on click and hide after a pick or when the pointer leaves." keywords="navbar compact minimal hide menu bar">
          <Segmented size="sm" options={fold} value={menus} onChange={setMenus} />
        </SettingRow>
        <SettingRow title="View buttons and settings" hint="The Explorer / Search / Git / Extensions switcher and the gear on the right." keywords="navbar compact minimal hide activity bar icons">
          <Segmented size="sm" options={fold} value={actions} onChange={setActions} />
        </SettingRow>
      </Group>
      <Group title="Tab bar">
        <SettingRow title="Split button" hint="Splits the editor to the right — also Ctrl+\ or the tab's context menu" keywords="tabs open files columns">
          <Switch on={tabSplit} onChange={setTabSplit} ariaLabel="Split button" />
        </SettingRow>
        <SettingRow title="More actions button" hint="The … menu: Close All, Close Saved… — also in the tab's context menu" keywords="tabs open files dropdown menu ellipsis">
          <Switch on={tabMenu} onChange={setTabMenu} ariaLabel="More actions button" />
        </SettingRow>
      </Group>
      <Group title="Panels">
        <SettingRow title="Sidebar position" keywords="explorer left right">
          <Segmented
            size="sm"
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
            value={side}
            onChange={setSide}
          />
        </SettingRow>
        <SettingRow title="Breadcrumbs" hint="The file path above the editor: folder › folder › file" keywords="path navigation bar">
          <Switch on={crumbs} onChange={setCrumbs} ariaLabel="Breadcrumbs" />
        </SettingRow>
        <SettingRow title="Status bar" hint="Branch, cursor position, language and encoding at the bottom" keywords="footer">
          <Switch on={status} onChange={setStatus} ariaLabel="Status bar" />
        </SettingRow>
      </Group>
    </div>
  );
}

function EditorSettings() {
  const [font, setFont] = useS("fontFamily");
  const [size, setSize] = useS("fontSize");
  const [lh, setLh] = useS("lineHeight");
  const [lig, setLig] = useS("ligatures");
  const [wrap, setWrap] = useS("wordWrap");
  const [ln, setLn] = useS("lineNumbers");
  const [hl, setHl] = useS("highlightActiveLine");
  const [ws, setWs] = useS("renderWhitespace");
  const [cursor, setCursor] = useS("cursorStyle");
  const [blink, setBlink] = useS("cursorBlink");
  const [past, setPast] = useS("scrollPastEnd");
  const [brackets, setBrackets] = useS("bracketMatching");
  return (
    <div className="flex flex-col gap-5">
      <Group title="Font">
        <SettingRow title="Font family" keywords="typeface monospace">
          <Combobox className="w-[300px]" options={[...new Set([font, ...FONT_PRESETS])].map((f) => ({ value: f, label: f.split(",")[0] }))} value={font} onChange={setFont} searchable={false} />
        </SettingRow>
        <SettingRow title="Custom font stack" hint="Any installed font, comma separated" keywords="typeface family">
          <Input className="w-[300px] font-mono" value={font} onChange={(e) => setFont(e.target.value)} />
        </SettingRow>
        <SettingRow title="Font size" keywords="text">
          <Num value={size} min={10} max={28} onChange={setSize} suffix="px" />
        </SettingRow>
        <SettingRow title="Line height" keywords="spacing">
          <Num value={lh} min={1.1} max={2.4} step={0.05} onChange={setLh} />
        </SettingRow>
        <SettingRow title="Font ligatures" hint="=> !== >= rendered as single glyphs (needs a ligature font)">
          <Switch on={lig} onChange={setLig} ariaLabel="Ligatures" />
        </SettingRow>
      </Group>
      <Group title="Display">
        <SettingRow title="Line numbers" keywords="gutter relative">
          <Segmented
            size="sm"
            options={[
              { value: "on", label: "On" },
              { value: "relative", label: "Relative" },
              { value: "off", label: "Off" },
            ]}
            value={ln}
            onChange={setLn}
          />
        </SettingRow>
        <SettingRow title="Word wrap" hint="Wrap long lines at the edge of the editor" keywords="soft wrap">
          <Switch on={wrap} onChange={setWrap} ariaLabel="Word wrap" />
        </SettingRow>
        <SettingRow title="Highlight current line">
          <Switch on={hl} onChange={setHl} ariaLabel="Highlight current line" />
        </SettingRow>
        <SettingRow title="Render whitespace" keywords="spaces tabs dots">
          <Segmented
            size="sm"
            options={[
              { value: "none", label: "None" },
              { value: "boundary", label: "Trailing" },
              { value: "all", label: "All" },
            ]}
            value={ws}
            onChange={setWs}
          />
        </SettingRow>
        <SettingRow title="Bracket matching" hint="Highlight the bracket that pairs with the one at the cursor">
          <Switch on={brackets} onChange={setBrackets} ariaLabel="Bracket matching" />
        </SettingRow>
        <SettingRow title="Scroll past end" hint="Let the last line scroll up to the top">
          <Switch on={past} onChange={setPast} ariaLabel="Scroll past end" />
        </SettingRow>
      </Group>
      <Group title="Cursor">
        <SettingRow title="Cursor style" keywords="caret">
          <Segmented
            size="sm"
            options={[
              { value: "line", label: "Line" },
              { value: "block", label: "Block" },
              { value: "underline", label: "Underline" },
            ]}
            value={cursor}
            onChange={setCursor}
          />
        </SettingRow>
        <SettingRow title="Cursor blinking" keywords="caret blink">
          <Switch on={blink} onChange={setBlink} ariaLabel="Cursor blinking" />
        </SettingRow>
      </Group>
    </div>
  );
}

function TypingSettings() {
  const [tab, setTab] = useS("tabSize");
  const [spaces, setSpaces] = useS("insertSpaces");
  const [autoSave, setAutoSave] = useS("autoSave");
  const [delay, setDelay] = useS("autoSaveDelay");
  const [trim, setTrim] = useS("trimTrailingWhitespace");
  const [eol, setEol] = useS("insertFinalNewline");
  return (
    <div className="flex flex-col gap-5">
      <Group title="Indentation">
        <SettingRow title="Tab size" keywords="indent width">
          <Segmented size="sm" options={["2", "4", "8"] as const} value={String(tab) as "2"} onChange={(v) => setTab(Number(v))} />
        </SettingRow>
        <SettingRow title="Insert spaces" hint="Pressing Tab inserts spaces instead of a tab character" keywords="indent">
          <Switch on={spaces} onChange={setSpaces} ariaLabel="Insert spaces" />
        </SettingRow>
      </Group>
      <Group title="Saving">
        <SettingRow title="Auto save" keywords="save automatically">
          <Segmented
            size="sm"
            options={[
              { value: "off", label: "Off" },
              { value: "afterDelay", label: "After delay" },
              { value: "onFocusChange", label: "On focus change" },
            ]}
            value={autoSave}
            onChange={setAutoSave}
          />
        </SettingRow>
        {autoSave === "afterDelay" && (
          <SettingRow title="Auto save delay" keywords="save">
            <Num value={delay} min={200} max={5000} step={100} onChange={setDelay} suffix="ms" />
          </SettingRow>
        )}
        <SettingRow title="Trim trailing whitespace on save" keywords="spaces">
          <Switch on={trim} onChange={setTrim} ariaLabel="Trim trailing whitespace" />
        </SettingRow>
        <SettingRow title="Insert final newline on save" keywords="eol end of file">
          <Switch on={eol} onChange={setEol} ariaLabel="Insert final newline" />
        </SettingRow>
      </Group>
    </div>
  );
}

function FilesSettings() {
  const [guides, setGuides] = useS("explorerIndentGuides");
  const [preview, setPreview] = useS("previewTabs");
  const [restore, setRestore] = useS("restoreSession");
  const [confirm, setConfirm] = useS("confirmDelete");
  const [exclude, setExclude] = useS("filesExclude");
  return (
    <div className="flex flex-col gap-5">
      <Group title="Explorer">
        <SettingRow title="Indent guides" hint="Vertical lines under open folders, to see what belongs where" keywords="tree lines folders">
          <Switch on={guides} onChange={setGuides} ariaLabel="Indent guides" />
        </SettingRow>
        <SettingRow title="Hidden files" hint="Glob patterns hidden from the explorer, comma separated" keywords="exclude ignore">
          <Input className="w-[300px] font-mono" value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </SettingRow>
        <SettingRow title="Confirm before delete" keywords="trash remove">
          <Switch on={confirm} onChange={setConfirm} ariaLabel="Confirm delete" />
        </SettingRow>
      </Group>
      <Group title="Tabs and session">
        <SettingRow title="Preview tabs" hint="Single-click opens a temporary (italic) tab that the next file replaces">
          <Switch on={preview} onChange={setPreview} ariaLabel="Preview tabs" />
        </SettingRow>
        <SettingRow title="Restore session" hint="Reopen the last folder and tabs on start" keywords="startup">
          <Switch on={restore} onChange={setRestore} ariaLabel="Restore session" />
        </SettingRow>
      </Group>
    </div>
  );
}

function TerminalSettings() {
  const [shell, setShell] = useS("terminalShell");
  const [profile, setProfile] = useS("terminalProfile");
  const [size, setSize] = useS("terminalFontSize");
  const [cursor, setCursor] = useS("terminalCursor");
  const shells = useTerminal((s) => s.shells);
  useEffect(() => void useTerminal.getState().loadShells(), []);
  const value = profile || (shell.trim() ? CUSTOM_PROFILE : "");
  const options = [
    { value: "", label: `System default${shells[0] ? ` (${shells[0].name})` : ""}` },
    ...shells.map((p) => ({ value: p.id, label: p.name, hint: p.program })),
    { value: CUSTOM_PROFILE, label: "Custom command…" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Group title="Shell">
        <SettingRow title="Default shell" keywords="powershell bash zsh cmd profile" hint="What New Terminal opens. Pick any other shell from the arrow next to + in the terminal panel.">
          <Combobox className="w-[300px]" options={options} value={value} onChange={setProfile} />
        </SettingRow>
        {value === CUSTOM_PROFILE && (
          <SettingRow title="Command" hint="A full path or a command with arguments.">
            <Input
              className="w-[300px] font-mono"
              placeholder={isMac ? "/opt/homebrew/bin/fish -l" : "C:\\msys64\\usr\\bin\\bash.exe --login"}
              value={shell}
              onChange={(e) => setShell(e.target.value)}
            />
          </SettingRow>
        )}
      </Group>
      <Group title="Look">
        <SettingRow title="Terminal font size" keywords="text">
          <Num value={size} min={9} max={24} onChange={setSize} suffix="px" />
        </SettingRow>
        <SettingRow title="Terminal cursor" keywords="caret">
          <Segmented
            size="sm"
            options={[
              { value: "bar", label: "Bar" },
              { value: "block", label: "Block" },
              { value: "underline", label: "Underline" },
            ]}
            value={cursor}
            onChange={setCursor}
          />
        </SettingRow>
      </Group>
    </div>
  );
}

function ExtensionsSettings() {
  const enabledMap = useSettings((s) => s.extEnabled);
  const focus = useUi((s) => s.settingsFocus);
  useEffect(() => {
    if (focus) document.getElementById("ext-" + focus)?.scrollIntoView({ block: "center" });
  }, [focus]);
  return (
    <div className="flex flex-col gap-4">
      {EXT_CATEGORIES.filter((c) => c !== "Languages").map((cat) => (
        <div key={cat} className="flex flex-col gap-2">
          <SectionHeading>{cat}</SectionHeading>
          {EXTENSIONS.filter((e) => e.category === cat).map((e) => (
            <SettingsCard key={e.id} id={"ext-" + e.id} className={cx(focus === e.id && "ring-1 ring-[var(--accent)]")}>
              <div className="flex items-start gap-3">
                <ExtIcon ext={e} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--text-main)]">{e.name}</div>
                  <div className="text-[12px] text-[var(--text-dim)]">{e.description}</div>
                </div>
                <Switch on={isExtEnabled(e.id, { extEnabled: enabledMap })} onChange={(v) => useSettings.getState().setExtEnabled(e.id, v)} ariaLabel={`Enable ${e.name}`} />
              </div>
              {(e.settings?.length || e.commands?.length || e.details?.length) && <ExtensionDetails ext={e} />}
            </SettingsCard>
          ))}
        </div>
      ))}
      <SectionHeading>Languages</SectionHeading>
      <SettingsCard>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2">
          {EXTENSIONS.filter((e) => e.category === "Languages").map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-main)]" title={e.details?.[0]}>
                {e.name}
              </span>
              <Switch on={isExtEnabled(e.id, { extEnabled: enabledMap })} onChange={(v) => useSettings.getState().setExtEnabled(e.id, v)} ariaLabel={`Enable ${e.name}`} />
            </div>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

function About() {
  const [json, setJson] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard>
        <div className="flex items-center gap-4 py-2">
          <NoxMark size={56} />
          <div>
            <div className="text-[22px] font-semibold text-[var(--text-main)]">Nox Code</div>
            <div className="text-[12.5px] text-[var(--text-dim)]">Version 0.2.0 · {inTauri ? "Desktop" : "Browser preview"}</div>
          </div>
        </div>
        <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          Nox is Latin for night — an editor for the hours when the best code gets written. Built with Tauri 2 and Rust (file system, search, git, terminal), React, CodeMirror 6 and xterm.js — in the
          soft design language of Singularity.
        </div>
      </SettingsCard>
      <SettingsCard>
        <SettingRow title="Settings as JSON" hint="Copy them to move to another computer or keep a backup; paste JSON back to apply it." keywords="export import backup copy paste json sync">
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" data-testid="settings-copy-json" onClick={() => copyText(exportSettings(), "Settings copied as JSON")}>
              Copy JSON
            </Button>
            <Button size="sm" variant="secondary" data-testid="settings-edit-json" onClick={() => setJson(json === null ? exportSettings() : null)}>
              {json === null ? "Edit JSON…" : "Close editor"}
            </Button>
          </div>
        </SettingRow>
        {json !== null && (
          <div className="flex flex-col gap-2">
            <textarea
              data-testid="settings-json"
              spellCheck={false}
              className="h-[320px] w-full resize-y rounded-xl border border-transparent bg-[var(--bg-input)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-main)] outline-none focus:border-[var(--accent)]"
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="settings-apply-json"
                onClick={() => {
                  try {
                    const r = importSettings(json);
                    toast(`Applied ${r.applied.length} setting${r.applied.length === 1 ? "" : "s"}`, "success", r.skipped.length ? `Skipped: ${r.skipped.join(", ")}` : undefined);
                    setJson(null);
                  } catch (e) {
                    toast("Invalid settings JSON", "error", errorMessage(e));
                  }
                }}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJson(null)}>
                Cancel
              </Button>
              <span className="text-[11.5px] text-[var(--text-dim)]">Unknown keys and values of the wrong type are skipped.</span>
            </div>
          </div>
        )}
        <SettingRow title="Reset all settings" hint="Themes you made, icon rules and shortcuts are removed too.">
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={async () => {
              const ans = await useUi.getState().ask({
                title: "Reset all settings?",
                buttons: [
                  { id: "reset", label: "Reset", variant: "danger" },
                  { id: "cancel", label: "Cancel" },
                ],
                cancelId: "cancel",
              });
              if (ans === "reset") useSettings.getState().resetAll();
            }}
          >
            Reset…
          </Button>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

/** Sections made of plain setting rows: the search looks through these. */
const SEARCHABLE: Array<[SettingsSection, () => React.ReactNode]> = [
  ["appearance", () => <Appearance />],
  ["layout", () => <LayoutSettings />],
  ["editor", () => <EditorSettings />],
  ["typing", () => <TypingSettings />],
  ["files", () => <FilesSettings />],
  ["terminal", () => <TerminalSettings />],
  ["about", () => <About />],
];

export function SettingsModal() {
  const section = useUi((s) => s.settingsSection);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const close = () => useUi.getState().closeSettings();
  const searching = query.trim() !== "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useUi.getState().dialog) {
        e.stopPropagation();
        close();
      }
      // Ctrl+F jumps to the settings search, as in VS Code.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [section, searching]);

  const pick = (id: SettingsSection) => {
    setQuery("");
    useUi.setState({ settingsSection: id, settingsFocus: null });
  };

  const nav = (id: SettingsSection, label: string, Icon: LucideIcon) => (
    <NavItem key={id} active={!searching && section === id} data-testid={`settings-nav-${id}`} icon={<Icon size={15} strokeWidth={1.7} className="shrink-0" />} onClick={() => pick(id)}>
      <span className="truncate">{label}</span>
    </NavItem>
  );

  return (
    <motion.div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={close}
    >
      <motion.div
        role="dialog"
        aria-label="Settings"
        data-testid="settings"
        className="flex h-[min(780px,calc(100vh-40px))] w-[min(1240px,calc(100vw-40px))] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex w-[220px] shrink-0 flex-col">
          <div className="px-2 pt-3">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
              <Input
                ref={searchRef}
                size="sm"
                data-testid="settings-search"
                placeholder="Search settings"
                className="pl-7"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc clears the query first, then closes.
                  if (e.key === "Escape" && query) {
                    e.nativeEvent.stopImmediatePropagation();
                    setQuery("");
                  }
                }}
              />
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1" innerClassName="flex flex-col gap-4 px-2 py-3">
            {NAV.map((g) => (
              <div key={g.group} className="flex flex-col gap-0.5">
                <div className="px-2.5 pb-1 text-[11px] text-[var(--text-dim)]">{g.group}</div>
                {g.items.map((it) => nav(it.id, it.label, it.icon))}
              </div>
            ))}
          </ScrollArea>
          <div className="px-2 pb-3">{nav("about", "About", Info)}</div>
        </div>
        <div className="my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-app)]">
          <ScrollArea scrollRef={scrollRef} className="min-w-0 flex-1" innerClassName="min-w-0 px-8 py-6">
            <div className="mb-5 flex items-start">
              <div className="min-w-0">
                <div className="text-[17px] font-semibold text-[var(--text-main)]">{searching ? "Search results" : TITLES[section][0]}</div>
                <div className="mt-0.5 text-[12.5px] text-[var(--text-dim)]">{searching ? `Settings matching “${query.trim()}”` : TITLES[section][1]}</div>
              </div>
              <IconButton label="Copy settings as JSON" className="ml-auto" onClick={() => copyText(exportSettings(), "Settings copied as JSON")}>
                <Braces size={14} />
              </IconButton>
              <IconButton label="Close" onClick={close}>
                <X size={14} />
              </IconButton>
            </div>
            {searching ? (
              <SettingsQuery.Provider value={query}>
                <div className="settings-results flex flex-col gap-7" data-testid="settings-results">
                  {SEARCHABLE.map(([id, render]) => (
                    <div key={id} className="settings-result flex flex-col gap-3">
                      <button className="self-start text-[13px] font-semibold text-[var(--text-main)] transition-colors hover:text-[var(--accent)]" onClick={() => pick(id)}>
                        {TITLES[id][0]}
                      </button>
                      {render()}
                    </div>
                  ))}
                  <div className="settings-empty py-10 text-center text-[12.5px] text-[var(--text-dim)]">No settings match. Shortcuts live under Keyboard Shortcuts.</div>
                </div>
              </SettingsQuery.Provider>
            ) : (
              <>
                {section === "appearance" && <Appearance />}
                {section === "layout" && <LayoutSettings />}
                {section === "editor" && <EditorSettings />}
                {section === "typing" && <TypingSettings />}
                {section === "files" && <FilesSettings />}
                {section === "terminal" && <TerminalSettings />}
                {section === "keybindings" && <KeybindingsSettings />}
                {section === "themes" && <ThemeStudio />}
                {section === "icons" && <IconsSettings />}
                {section === "extensions" && <ExtensionsSettings />}
                {section === "about" && <About />}
              </>
            )}
          </ScrollArea>
        </div>
      </motion.div>
    </motion.div>
  );
}
