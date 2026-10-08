/** Every app command — palette, menus and keyboard shortcuts all run these. */
import { SquareTerminal } from "lucide-react";
import { EditorSelection } from "@codemirror/state";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel, selectSelectionMatches } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import { registerCommands, type Command } from "@/core/commands";
import { backend } from "@/lib/backend";
import { basename, relative } from "@/lib/path";
import { appWindow } from "@/lib/window";
import { FILE_MANAGER } from "@/lib/platform";
import { activeView } from "@/editor/viewRegistry";
import { goBack, goToDefinition, wordAtPos } from "@/editor/intel/navigation";
import { LANGUAGES, PLAIN_TEXT, languageName } from "@/editor/languages";
import { invalidateGitBases } from "@/editor/CodeEditor";
import { activeTabInfo, useEditor } from "@/stores/editor";
import { allThemes, findTheme, useSettings } from "@/stores/settings";
import { useTerminal } from "@/stores/terminal";
import { errorMessage, toast, useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { effectiveFor, useProject } from "@/stores/project";
import { useUpdates } from "@/stores/updates";
import { useSearch } from "@/stores/search";
import { exportSettings } from "@/stores/settingsJson";
import { canFormat, formatText, prettierOptionsFor } from "@/extensions/prettier";
import { ICON_THEMES } from "@/icons/iconThemes";
import { themeSwatch } from "@/themes/apply";
import { importTheme } from "@/themes/convert";
import { copyText } from "./fileOps";

const ui = () => useUi.getState();
const ed = () => useEditor.getState();
const ws = () => useWorkspace.getState();
const settings = () => useSettings.getState();

export async function openFolderDialog() {
  const path = await backend().pickFolder();
  if (path) await switchFolder(path);
}

export async function switchFolder(path: string) {
  // Unsaved work would be lost by the switch.
  const dirty = Object.values(ed().buffers).filter((b) => b.dirty);
  if (dirty.length) {
    const answer = await ui().ask({
      title: `Save changes to ${dirty.length} file${dirty.length > 1 ? "s" : ""}?`,
      message: "Opening another folder closes the current editors.",
      buttons: [
        { id: "save", label: "Save All", variant: "primary" },
        { id: "discard", label: "Don't Save", variant: "danger" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });
    if (answer === "cancel") return;
    if (answer === "save") await ed().saveAll();
  }
  ed().reset();
  await ws().openFolder(path);
}

/** Runs `fn` over the selected lines (or the whole file). */
function transformLines(fn: (lines: string[]) => string[]) {
  const view = activeView();
  if (!view) return;
  const { state } = view;
  const sel = state.selection.main;
  const from = sel.empty ? 0 : state.doc.lineAt(sel.from).from;
  const to = sel.empty ? state.doc.length : state.doc.lineAt(sel.to).to;
  const text = state.sliceDoc(from, to);
  const out = fn(text.split("\n")).join("\n");
  view.dispatch({ changes: { from, to, insert: out }, selection: EditorSelection.range(from, from + out.length) });
  view.focus();
}

function transformSelection(fn: (s: string) => string) {
  const view = activeView();
  if (!view) return;
  view.dispatch(
    view.state.changeByRange((r) => {
      const range = r.empty ? view.state.wordAt(r.head) ?? r : r;
      const text = fn(view.state.sliceDoc(range.from, range.to));
      return { changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.range(range.from, range.from + text.length) };
    }),
  );
  view.focus();
}

function insertText(text: string) {
  const view = activeView();
  if (!view) return;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

export async function formatActive() {
  const { buffer } = activeTabInfo();
  const view = activeView();
  if (!buffer || !view) return;
  if (!canFormat(buffer.langId)) {
    toast(`No formatter for ${languageName(buffer.langId)}`, "warning");
    return;
  }
  try {
    const { formatted, cursorOffset } = await formatText(
      view.state.doc.toString(),
      buffer.langId,
      prettierOptionsFor(buffer.path, buffer.langId),
      view.state.selection.main.head,
    );
    if (formatted !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
        selection: { anchor: Math.min(cursorOffset, formatted.length) },
        scrollIntoView: true,
      });
    }
  } catch (e) {
    toast("Format failed", "error", errorMessage(e).split("\n")[0]);
  }
}

export function pickTheme() {
  const original = settings().themeId;
  // Dark themes first, then light — one group each.
  const themes = [...allThemes()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dark" ? -1 : 1));
  let accepted = false;
  ui().pick({
    placeholder: "Select color theme (↑↓ to preview)",
    activeId: original,
    items: themes.map((t) => ({
      id: t.id,
      label: t.name,
      description: t.builtin ? undefined : "custom",
      group: t.kind === "dark" ? "Dark themes" : "Light themes",
      icon: (
        <span className="flex shrink-0 gap-[3px]">
          {themeSwatch(t).slice(0, 3).map((c, i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_var(--border)]" style={{ background: c }} />
          ))}
        </span>
      ),
    })),
    onHighlight: (it) => settings().set("themeId", it.id),
    onAccept: (it) => {
      accepted = true;
      settings().patch({ themeId: it.id, followSystem: false });
    },
    onCancel: () => {
      if (!accepted) settings().set("themeId", original);
    },
  });
}

export function pickIconTheme() {
  const original = settings().iconTheme;
  let accepted = false;
  ui().pick({
    placeholder: "Select file icon theme",
    activeId: original,
    items: ICON_THEMES.map((t) => ({ id: t.id, label: t.name, description: t.description })),
    onHighlight: (it) => settings().set("iconTheme", it.id),
    onAccept: (it) => {
      accepted = true;
      settings().set("iconTheme", it.id);
    },
    onCancel: () => {
      if (!accepted) settings().set("iconTheme", original);
    },
  });
}

export function pickLanguage() {
  const { buffer } = activeTabInfo();
  if (!buffer) return;
  ui().pick({
    placeholder: "Select language mode",
    activeId: buffer.langId,
    items: [{ id: PLAIN_TEXT.id, label: PLAIN_TEXT.name }, ...LANGUAGES.map((l) => ({ id: l.id, label: l.name, description: l.extensions.map((e) => "." + e).join(" ") }))],
    onAccept: (it) => ed().setLanguage(buffer.id, it.id),
  });
}

export function pickIndentation() {
  const s = settings();
  const { buffer } = activeTabInfo();
  const eff = effectiveFor(buffer?.path ?? null, buffer?.langId ?? "plaintext");
  ui().pick({
    placeholder: "Indentation",
    activeId: `${eff.insertSpaces ? "spaces" : "tabs"}-${eff.tabSize}`,
    items: [2, 4, 8].flatMap((n) => [
      { id: `spaces-${n}`, label: `Spaces: ${n}`, group: "Indent using spaces" },
      { id: `tabs-${n}`, label: `Tab size: ${n}`, group: "Indent using tabs" },
    ]),
    onAccept: (it) => {
      const [kind, n] = it.id.split("-");
      const value = { insertSpaces: kind === "spaces", tabSize: Number(n) };
      // A project that pins indentation keeps the change in its own file.
      const p = useProject.getState();
      const lang = buffer ? p.settings.languages?.[buffer.langId] : undefined;
      if (buffer && (lang?.tabSize !== undefined || lang?.insertSpaces !== undefined)) void p.setLanguage(buffer.langId, value);
      else if (p.root && (p.settings.tabSize !== undefined || p.settings.insertSpaces !== undefined)) void p.update(value);
      else s.patch(value);
    },
  });
}

export function pickEol() {
  const { buffer } = activeTabInfo();
  if (!buffer) return;
  ui().pick({
    placeholder: "Select end of line sequence",
    activeId: buffer.lineEnding,
    items: [
      { id: "LF", label: "LF", description: "\\n — Unix, macOS" },
      { id: "CRLF", label: "CRLF", description: "\\r\\n — Windows" },
    ],
    onAccept: (it) => ed().setLineEnding(buffer.id, it.id as "LF" | "CRLF"),
  });
}

export function openRecent() {
  const recents = settings().recentProjects;
  if (!recents.length) {
    toast("No recent folders yet");
    return;
  }
  ui().pick({
    placeholder: "Open recent folder",
    items: recents.map((p) => ({ id: p, label: basename(p), description: p })),
    onAccept: (it) => void switchFolder(it.id),
  });
}

export async function importThemeFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.jsonc,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const theme = importTheme(await file.text(), file.name);
      settings().saveCustomTheme(theme);
      settings().patch({ themeId: theme.id, followSystem: false });
      toast(`Imported "${theme.name}"`, "success");
    } catch (e) {
      toast("Could not import theme", "error", errorMessage(e));
    }
  };
  input.click();
}

function zoom(delta: number | null) {
  const s = settings();
  const next = delta === null ? 1 : Math.round(Math.max(0.7, Math.min(1.6, s.uiScale + delta)) * 100) / 100;
  s.set("uiScale", next);
}

export function registerAppCommands() {
  const cmds: Command[] = [
    /* ---- File ---- */
    { id: "file.newUntitled", title: "New Text File", category: "File", keybinding: "Ctrl+N", global: true, run: () => ed().newUntitled() },
    { id: "explorer.newFile", title: "New File…", category: "Explorer", keybinding: "Ctrl+Alt+N", when: () => !!ws().root, run: () => (ui().showSideView("explorer"), ws().startCreate("file")) },
    { id: "explorer.newFolder", title: "New Folder…", category: "Explorer", when: () => !!ws().root, run: () => (ui().showSideView("explorer"), ws().startCreate("folder")) },
    { id: "file.openFolder", title: "Open Folder…", category: "File", keybinding: "Ctrl+O", global: true, run: openFolderDialog },
    {
      id: "file.openFile",
      title: "Open File…",
      category: "File",
      run: async () => {
        const p = await backend().pickOpenFile();
        if (p) await ed().openFile(p);
      },
    },
    { id: "file.openRecent", title: "Open Recent…", category: "File", keybinding: "Ctrl+R", global: true, run: openRecent },
    { id: "file.closeFolder", title: "Close Folder", category: "File", when: () => !!ws().root, run: async () => (ed().reset(), await ws().closeFolder()) },
    {
      id: "file.save",
      title: "Save",
      category: "File",
      keybinding: "Ctrl+S",
      run: async () => {
        const { buffer } = activeTabInfo();
        if (buffer) await ed().save(buffer.id);
      },
    },
    {
      id: "file.saveAs",
      title: "Save As…",
      category: "File",
      keybinding: "Ctrl+Shift+S",
      run: async () => {
        const { buffer } = activeTabInfo();
        if (buffer) await ed().save(buffer.id, true);
      },
    },
    { id: "file.saveAll", title: "Save All", category: "File", keybinding: "Ctrl+Alt+S", run: () => ed().saveAll() },
    {
      id: "file.revert",
      title: "Revert File",
      category: "File",
      run: async () => {
        const { buffer } = activeTabInfo();
        if (buffer) await ed().revert(buffer.id);
      },
    },

    /* ---- Editor groups ---- */
    {
      id: "editor.close",
      title: "Close Editor",
      category: "View",
      keybinding: "Ctrl+W",
      run: async () => {
        const { pane, tab } = activeTabInfo();
        if (pane && tab) await ed().closeTab(pane.id, tab.id);
      },
    },
    {
      id: "editor.closeAll",
      title: "Close All Editors",
      category: "View",
      run: async () => {
        for (const p of [...ed().panes]) await ed().closeTabs(p.id, "all");
      },
    },
    {
      id: "editor.closeOthers",
      title: "Close Other Editors",
      category: "View",
      run: async () => {
        const { pane, tab } = activeTabInfo();
        if (pane && tab) await ed().closeTabs(pane.id, "others", tab.id);
      },
    },
    { id: "editor.reopenClosed", title: "Reopen Closed Editor", category: "View", keybinding: "Ctrl+Shift+T", global: true, run: () => ed().reopenClosed() },
    { id: "editor.split", title: "Split Editor Right", category: "View", keybinding: "Ctrl+\\", run: () => ed().splitRight() },
    { id: "editor.splitDown", title: "Split Editor Down", category: "View", keybinding: "Ctrl+Shift+\\", run: () => ed().split(undefined, "bottom") },
    { id: "editor.nextTab", title: "Next Editor", category: "View", keybinding: ["Ctrl+Tab", "Ctrl+PageDown"], global: true, run: () => ed().cycleTab(1) },
    { id: "editor.prevTab", title: "Previous Editor", category: "View", keybinding: ["Ctrl+Shift+Tab", "Ctrl+PageUp"], global: true, run: () => ed().cycleTab(-1) },
    ...[1, 2, 3, 4].map(
      (n): Command => ({
        id: `editor.focusGroup${n}`,
        title: `Focus Editor Group ${n}`,
        category: "View",
        keybinding: `Ctrl+${n}`,
        global: true,
        run: () => {
          const p = ed().panes[n - 1];
          if (p) {
            ed().focusPane(p.id);
            useEditor.setState((s) => ({ focusNonce: s.focusNonce + 1 }));
          }
        },
      }),
    ),

    /* ---- Editing ---- */
    { id: "editor.format", title: "Format Document", category: "Editor", keybinding: "Shift+Alt+F", extension: "prettier", run: formatActive },
    { id: "editor.gotoLine", title: "Go to Line…", category: "Go", keybinding: "Ctrl+G", run: () => ui().openPalette(":") },
    {
      id: "editor.find",
      title: "Find",
      category: "Editor",
      hidden: false,
      run: () => {
        const v = activeView();
        if (v) openSearchPanel(v);
      },
    },
    {
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      keybinding: "F12",
      extension: "code-navigation",
      run: () => {
        const v = activeView();
        if (v) void goToDefinition(v);
      },
    },
    { id: "editor.goBack", title: "Go Back", category: "Editor", keybinding: "Alt+Left", extension: "code-navigation", run: () => void goBack() },
    {
      id: "editor.findReferences",
      title: "Find All References",
      category: "Editor",
      keybinding: "Shift+F12",
      extension: "code-navigation",
      run: () => {
        const v = activeView();
        const { buffer } = activeTabInfo();
        if (!v || !buffer) return;
        const sel = v.state.selection.main;
        const w = sel.empty ? wordAtPos(v.state, sel.head, buffer.langId)?.text : v.state.sliceDoc(sel.from, sel.to);
        if (!w || w.includes("\n")) return;
        useSearch.getState().patch({ wholeWord: true, regex: false, caseSensitive: true });
        useSearch.getState().seed({ text: w });
        ed().openSearch();
        void useSearch.getState().run();
      },
    },
    {
      id: "editor.toggleComment",
      title: "Toggle Line Comment",
      category: "Editor",
      run: () => {
        const v = activeView();
        if (v) toggleComment(v);
      },
    },
    {
      id: "editor.selectAllOccurrences",
      title: "Select All Occurrences",
      category: "Selection",
      keybinding: "Ctrl+Shift+L",
      run: () => {
        const v = activeView();
        if (v) selectSelectionMatches(v);
      },
    },
    {
      id: "editor.foldAll",
      title: "Fold All",
      category: "Editor",
      run: () => {
        const v = activeView();
        if (v) foldAll(v);
      },
    },
    {
      id: "editor.unfoldAll",
      title: "Unfold All",
      category: "Editor",
      run: () => {
        const v = activeView();
        if (v) unfoldAll(v);
      },
    },
    { id: "editor.toggleWordWrap", title: "Toggle Word Wrap", category: "View", keybinding: "Alt+Z", run: () => settings().set("wordWrap", !settings().wordWrap) },
    { id: "editor.changeLanguage", title: "Change Language Mode", category: "Editor", run: pickLanguage },
    { id: "editor.changeIndentation", title: "Change Indentation", category: "Editor", run: pickIndentation },
    { id: "editor.changeEol", title: "Change End of Line Sequence", category: "Editor", run: pickEol },
    {
      id: "editor.copyPath",
      title: "Copy Path of Active File",
      category: "File",
      run: () => {
        const { tab } = activeTabInfo();
        if (tab?.path) copyText(tab.path, "Path copied");
      },
    },
    {
      id: "editor.copyRelativePath",
      title: "Copy Relative Path of Active File",
      category: "File",
      run: () => {
        const { tab } = activeTabInfo();
        const root = ws().root;
        if (tab?.path && root) copyText(relative(root, tab.path) ?? tab.path, "Relative path copied");
      },
    },
    {
      id: "editor.revealInExplorer",
      title: "Reveal Active File in Explorer View",
      category: "File",
      run: async () => {
        const { tab } = activeTabInfo();
        if (!tab?.path) return;
        ui().showSideView("explorer");
        await ws().revealPath(tab.path);
      },
    },
    {
      id: "editor.revealInOs",
      title: `Reveal Active File in ${FILE_MANAGER}`,
      category: "File",
      run: () => {
        const { tab } = activeTabInfo();
        if (tab?.path) void backend().revealInExplorer(tab.path);
      },
    },
    {
      id: "markdown.preview",
      title: "Markdown: Open Preview to the Side",
      category: "Markdown",
      keybinding: "Ctrl+Shift+V",
      extension: "markdown-preview",
      when: () => activeTabInfo().buffer?.langId === "markdown",
      run: () => {
        const { buffer } = activeTabInfo();
        if (buffer) ed().openPreview(buffer.id);
      },
    },

    /* ---- Text Power Tools ---- */
    { id: "text.sortLines", title: "Sort Lines Ascending", category: "Text", extension: "text-tools", run: () => transformLines((l) => [...l].sort((a, b) => a.localeCompare(b))) },
    { id: "text.sortLinesDesc", title: "Sort Lines Descending", category: "Text", extension: "text-tools", run: () => transformLines((l) => [...l].sort((a, b) => b.localeCompare(a))) },
    { id: "text.uniqueLines", title: "Remove Duplicate Lines", category: "Text", extension: "text-tools", run: () => transformLines((l) => [...new Set(l)]) },
    { id: "text.reverseLines", title: "Reverse Lines", category: "Text", extension: "text-tools", run: () => transformLines((l) => [...l].reverse()) },
    { id: "text.trimLines", title: "Trim Trailing Whitespace", category: "Text", extension: "text-tools", run: () => transformLines((l) => l.map((x) => x.replace(/\s+$/, ""))) },
    { id: "text.upper", title: "Transform to Uppercase", category: "Text", extension: "text-tools", run: () => transformSelection((s) => s.toUpperCase()) },
    { id: "text.lower", title: "Transform to Lowercase", category: "Text", extension: "text-tools", run: () => transformSelection((s) => s.toLowerCase()) },
    { id: "text.title", title: "Transform to Title Case", category: "Text", extension: "text-tools", run: () => transformSelection((s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase())) },
    { id: "text.snake", title: "Transform to snake_case", category: "Text", extension: "text-tools", run: () => transformSelection((s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase()) },
    { id: "text.camel", title: "Transform to camelCase", category: "Text", extension: "text-tools", run: () => transformSelection((s) => s.toLowerCase().replace(/[_\s-]+(\p{L})/gu, (_, c: string) => c.toUpperCase())) },
    { id: "text.timestamp", title: "Insert Timestamp (ISO)", category: "Text", extension: "text-tools", run: () => insertText(new Date().toISOString()) },
    { id: "text.uuid", title: "Insert UUID", category: "Text", extension: "text-tools", run: () => insertText(crypto.randomUUID()) },
    { id: "text.lorem", title: "Insert Lorem Ipsum", category: "Text", extension: "text-tools", run: () => insertText(LOREM) },

    /* ---- View ---- */
    { id: "workbench.commandPalette", title: "Show All Commands", category: "View", keybinding: ["Ctrl+Shift+P", "F1"], global: true, run: () => ui().openPalette(">") },
    { id: "workbench.quickOpen", title: "Go to File…", category: "Go", keybinding: "Ctrl+P", global: true, run: () => ui().openPalette("") },
    { id: "view.toggleSidebar", title: "Toggle Sidebar", category: "View", keybinding: "Ctrl+B", global: true, run: () => settings().set("sidebarHidden", !settings().sidebarHidden) },
    { id: "view.explorer", title: "Show Explorer", category: "View", keybinding: "Ctrl+Shift+E", global: true, run: () => ui().showSideView("explorer") },
    {
      id: "view.search",
      title: "Search in Files",
      category: "View",
      keybinding: "Ctrl+Shift+F",
      global: true,
      run: () => {
        const v = activeView();
        const sel = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : "";
        useSearch.getState().seed({ text: sel && !sel.includes("\n") ? sel : "" });
        useEditor.getState().openSearch();
      },
    },
    { id: "view.git", title: "Show Source Control", category: "View", keybinding: "Ctrl+Shift+G", global: true, run: () => ui().showSideView("git") },
    { id: "view.extensions", title: "Show Extensions", category: "View", keybinding: "Ctrl+Shift+X", global: true, run: () => ui().showSideView("extensions") },
    {
      id: "view.toggleIslands",
      title: "Toggle Docked Layout",
      category: "View",
      run: () => settings().set("layout", settings().layout === "docked" ? "islands" : "docked"),
    },
    { id: "view.toggleStatusBar", title: "Toggle Status Bar", category: "View", run: () => settings().set("showStatusBar", !settings().showStatusBar) },
    { id: "view.toggleBreadcrumbs", title: "Toggle Breadcrumbs", category: "View", run: () => settings().set("showBreadcrumbs", !settings().showBreadcrumbs) },
    { id: "view.sidebarSide", title: "Move Sidebar Left / Right", category: "View", run: () => settings().set("sidebarSide", settings().sidebarSide === "left" ? "right" : "left") },
    { id: "view.zen", title: "Toggle Zen Mode", category: "View", keybinding: "Ctrl+Alt+Z", global: true, extension: "zen-mode", run: () => ui().toggleZen() },
    { id: "view.zoomIn", title: "Zoom In", category: "View", keybinding: ["Ctrl+=", "Ctrl+Shift+="], global: true, run: () => zoom(0.1) },
    { id: "view.zoomOut", title: "Zoom Out", category: "View", keybinding: "Ctrl+-", global: true, run: () => zoom(-0.1) },
    { id: "view.zoomReset", title: "Reset Zoom", category: "View", keybinding: "Ctrl+0", global: true, run: () => zoom(null) },
    { id: "view.fullscreen", title: "Toggle Full Screen", category: "View", keybinding: "F11", global: true, run: () => appWindow.toggleFullscreen() },
    { id: "view.reload", title: "Reload Window", category: "Developer", run: () => location.reload() },

    /* ---- Terminal ---- */
    {
      id: "terminal.toggle",
      title: "Toggle Terminal",
      category: "Terminal",
      // Ctrl+J like VS Code; it works from inside the terminal too, to hide it again.
      keybinding: ["Ctrl+J", "Ctrl+`"],
      global: true,
      run: async () => {
        const open = ui().panelOpen;
        if (!open && !useTerminal.getState().terms.length) await useTerminal.getState().create();
        else ui().togglePanel();
      },
    },
    { id: "terminal.new", title: "New Terminal", category: "Terminal", keybinding: "Ctrl+Shift+`", global: true, run: () => void useTerminal.getState().create() },
    {
      id: "terminal.newWithShell",
      title: "New Terminal With Shell…",
      category: "Terminal",
      run: async () => {
        const shells = await useTerminal.getState().loadShells();
        ui().pick({
          placeholder: "Select the shell for the new terminal",
          items: shells.map((p) => ({ id: p.id, label: p.name, detail: [p.program, ...p.args].join(" "), icon: <SquareTerminal size={14} /> })),
          onAccept: (item) => void useTerminal.getState().create(undefined, item.id),
        });
      },
    },
    {
      id: "terminal.kill",
      title: "Kill Terminal",
      category: "Terminal",
      when: () => !!useTerminal.getState().activeId,
      run: () => {
        const id = useTerminal.getState().activeId;
        if (id) void useTerminal.getState().kill(id);
      },
    },
    { id: "terminal.maximize", title: "Maximize Panel", category: "Terminal", run: () => (ui().togglePanel(true), ui().setPanelMaximized(!ui().panelMaximized)) },
    {
      id: "terminal.runSelection",
      title: "Run Selected Text in Terminal",
      category: "Terminal",
      run: async () => {
        const v = activeView();
        if (!v) return;
        const sel = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) || v.state.doc.lineAt(v.state.selection.main.head).text;
        await useTerminal.getState().sendText(sel + "\r");
      },
    },

    /* ---- Preferences ---- */
    {
      id: "settings.copyJson",
      title: "Copy Settings as JSON",
      category: "Preferences",
      run: () => copyText(exportSettings(), "Settings copied as JSON"),
    },
    { id: "settings.open", title: "Open Settings", category: "Preferences", keybinding: "Ctrl+,", global: true, run: () => ui().openSettings() },
    { id: "settings.theme", title: "Color Theme", category: "Preferences", keybinding: "Ctrl+Alt+T", global: true, run: pickTheme },
    { id: "settings.iconTheme", title: "File Icon Theme", category: "Preferences", run: pickIconTheme },
    { id: "settings.themeStudio", title: "Theme Studio: Customize Current Theme", category: "Preferences", run: () => ui().openSettings("themes", "studio") },
    { id: "settings.importTheme", title: "Import Color Theme (VS Code or Nox JSON)…", category: "Preferences", run: importThemeFile },
    { id: "settings.icons", title: "Customize File Icons", category: "Preferences", run: () => ui().openSettings("icons") },
    { id: "settings.keybindings", title: "Keyboard Shortcuts", category: "Preferences", keybinding: "Ctrl+Alt+K", global: true, run: () => ui().openSettings("keybindings") },
    {
      id: "settings.toggleLightDark",
      title: "Toggle Light / Dark Theme",
      category: "Preferences",
      run: () => {
        const s = settings();
        const cur = findTheme(s.themeId);
        s.patch({ themeId: cur.kind === "dark" ? s.lightThemeId : s.darkThemeId, followSystem: false });
      },
    },

    /* ---- Git ---- */
    {
      id: "git.refresh",
      title: "Git: Refresh",
      category: "Git",
      run: async () => {
        await ws().refreshGit();
        invalidateGitBases();
      },
    },
    {
      id: "git.openChanges",
      title: "Git: Open Changes",
      category: "Git",
      when: () => !!activeTabInfo().tab?.path,
      run: () => {
        const p = activeTabInfo().tab?.path;
        if (p) void ed().openDiff(p);
      },
    },
    {
      id: "git.stageAll",
      title: "Git: Stage All Changes",
      category: "Git",
      when: () => !!ws().git?.isRepo,
      run: async () => {
        const root = ws().root!;
        await backend().gitStage(root, ws().git!.files.map((f) => f.path)).catch((e) => toast(errorMessage(e), "error"));
        await ws().refreshGit();
      },
    },
    { id: "git.init", title: "Git: Initialize Repository", category: "Git", when: () => !!ws().root && !ws().git?.isRepo, run: async () => (await backend().gitInit(ws().root!), await ws().refreshGit()) },

    /* ---- Help ---- */
    { id: "help.about", title: "About Nox Code", category: "Help", run: () => ui().openSettings("about") },
    { id: "settings.project", title: "Project Settings", category: "Preferences", when: () => !!ws().root, run: () => ui().openSettings("project") },
    { id: "help.checkUpdates", title: "Check for Updates…", category: "Help", run: () => void useUpdates.getState().check(true) },
    { id: "help.welcome", title: "Welcome", category: "Help", run: () => useEditor.setState((s) => ({ panes: s.panes.map((p) => (p.id === s.activePaneId ? { ...p, activeTabId: null } : p)) })) },
  ];
  registerCommands(cmds);
}
