import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBackend } from "@/lib/backend";
import { createMemoryBackend } from "@/lib/memoryBackend";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useSettings, findTheme, DEFAULT_SETTINGS } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { docHub } from "@/editor/docHub";
import { commandForCombo, conflictsFor, keysFor, registerCommands, runCommand } from "@/core/commands";
import { BUILTIN_THEMES } from "@/themes/builtin";
import { cloneTheme } from "@/themes/convert";
import { createEntry, deleteEntry, moveEntry, renameEntry } from "@/app/fileOps";

const ROOT = "/p";
let backend: ReturnType<typeof createMemoryBackend>;

beforeEach(async () => {
  backend = createMemoryBackend({ root: ROOT, files: { "src/a.ts": "let a = 1;\n", "src/b.ts": "b\n", "notes.md": "# n\n" } });
  setBackend(backend);
  useSettings.setState({ ...DEFAULT_SETTINGS });
  useEditor.getState().reset();
  useUi.setState({ dialog: null, toasts: [] });
  await useWorkspace.getState().openFolder(ROOT);
});

const pane = () => useEditor.getState().panes[0];
const titles = (i = 0) => useEditor.getState().panes[i].tabs.map((t) => t.title);

describe("workspace", () => {
  it("opens a folder, loads children and git decorations", async () => {
    const ws = useWorkspace.getState();
    expect(ws.root).toBe(ROOT);
    expect(ws.children[ROOT].map((e) => e.name)).toEqual(["src", "notes.md"]);
    expect(useSettings.getState().recentProjects[0]).toBe(ROOT);
    await backend.writeFile("/p/src/a.ts", "changed\n");
    await ws.refreshGit();
    const deco = useWorkspace.getState().gitDecorations;
    expect(deco["src/a.ts"]).toMatchObject({ status: "M" });
    expect(deco.src).toBe("dirty-folder");
  });

  it("expands folders lazily and reveals nested paths", async () => {
    await useWorkspace.getState().revealPath("/p/src/b.ts");
    const ws = useWorkspace.getState();
    expect(ws.expanded["/p/src"]).toBe(true);
    expect(ws.children["/p/src"].map((e) => e.name)).toEqual(["a.ts", "b.ts"]);
    expect(ws.selected).toBe("/p/src/b.ts");
  });

  it("caches the file list for quick open", async () => {
    expect(await useWorkspace.getState().getFileList()).toEqual(["notes.md", "src/a.ts", "src/b.ts"]);
  });
});

describe("editor tabs", () => {
  it("opens a file once and reuses the buffer", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/src/a.ts");
    expect(titles()).toEqual(["a.ts"]);
    const buf = Object.values(useEditor.getState().buffers)[0];
    expect(buf.langId).toBe("typescript");
    expect(docHub.text(buf.id)).toBe("let a = 1;\n");
  });

  it("replaces preview tabs and pins them on double click / edit", async () => {
    await useEditor.getState().openFile("/p/src/a.ts", { preview: true });
    await useEditor.getState().openFile("/p/src/b.ts", { preview: true });
    expect(titles()).toEqual(["b.ts"]);
    expect(pane().tabs[0].preview).toBe(true);
    const bufId = pane().tabs[0].bufferId!;
    docHub.setText(bufId, "edited");
    expect(pane().tabs[0].preview).toBe(false);
    await useEditor.getState().openFile("/p/notes.md", { preview: true });
    expect(titles()).toEqual(["b.ts", "notes.md"]);
  });

  it("tracks dirty state against the saved text and saves", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    const id = pane().tabs[0].bufferId!;
    docHub.setText(id, "let a = 2;");
    expect(useEditor.getState().buffers[id].dirty).toBe(true);
    docHub.setText(id, "let a = 1;\n");
    expect(useEditor.getState().buffers[id].dirty).toBe(false);
    docHub.setText(id, "let a = 3;");
    expect(await useEditor.getState().save(id)).toBe(true);
    // insertFinalNewline is on by default.
    expect((await backend.readFile("/p/src/a.ts")).content).toBe("let a = 3;\n");
    expect(useEditor.getState().buffers[id].dirty).toBe(false);
  });

  it("asks before closing a dirty tab and honors Cancel / Don't Save", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    const { id: tabId, bufferId } = pane().tabs[0];
    docHub.setText(bufferId!, "dirty");
    let closing = useEditor.getState().closeTab(pane().id, tabId);
    await vi.waitFor(() => expect(useUi.getState().dialog).not.toBeNull());
    useUi.getState().closeDialog("cancel");
    expect(await closing).toBe(false);
    expect(titles()).toEqual(["a.ts"]);
    closing = useEditor.getState().closeTab(pane().id, tabId);
    await vi.waitFor(() => expect(useUi.getState().dialog).not.toBeNull());
    useUi.getState().closeDialog("discard");
    expect(await closing).toBe(true);
    expect(titles()).toEqual([]);
    expect(docHub.has(bufferId!)).toBe(false);
  });

  it("splits, moves tabs between groups and drops empty groups", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/src/b.ts");
    useEditor.getState().splitRight();
    expect(useEditor.getState().panes).toHaveLength(2);
    expect(titles(1)).toEqual(["b.ts"]);
    // Same buffer shared by both groups.
    expect(useEditor.getState().panes[1].tabs[0].bufferId).toBe(useEditor.getState().panes[0].tabs[1].bufferId);
    const left = useEditor.getState().panes[0];
    useEditor.getState().moveTab(left.id, left.tabs[0].id, useEditor.getState().panes[1].id);
    expect(titles(1)).toEqual(["b.ts", "a.ts"]);
    const p0 = useEditor.getState().panes[0];
    await useEditor.getState().closeTab(p0.id, p0.tabs[0].id);
    expect(useEditor.getState().panes).toHaveLength(1);
  });

  it("reopens the last closed tab", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().closeTab(pane().id, pane().tabs[0].id);
    await useEditor.getState().reopenClosed();
    expect(titles()).toEqual(["a.ts"]);
  });

  it("reloads clean buffers when the file changes on disk and flags dirty ones", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/src/b.ts");
    const [a, b] = pane().tabs.map((t) => t.bufferId!);
    docHub.setText(b, "mine");
    await backend.writeFile("/p/src/a.ts", "from disk\n");
    await backend.writeFile("/p/src/b.ts", "theirs\n");
    await useEditor.getState().onDiskChange(["/p/src/a.ts", "/p/src/b.ts"]);
    expect(docHub.text(a)).toBe("from disk\n");
    expect(useEditor.getState().buffers[a].dirty).toBe(false);
    expect(useEditor.getState().buffers[b].diskChanged).toBe(true);
    await useEditor.getState().revert(b);
    expect(docHub.text(b)).toBe("theirs\n");
  });

  it("creates untitled buffers with incrementing names", () => {
    useEditor.getState().newUntitled();
    useEditor.getState().newUntitled("x", "json");
    expect(titles()[0]).toMatch(/^Untitled-\d+$/);
    expect(Object.values(useEditor.getState().buffers)[1].langId).toBe("json");
  });
});

describe("file operations", () => {
  it("creates nested files and opens them", async () => {
    expect(await createEntry(ROOT, "lib/util.ts", "file")).toBe(true);
    expect(await backend.exists("/p/lib/util.ts")).toBe(true);
    expect(titles()).toEqual(["util.ts"]);
    expect(await createEntry(ROOT, "bad:name", "file")).toBe(false);
  });

  it("renames and moves open files, keeping their tabs", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    expect(await renameEntry("/p/src/a.ts", "renamed.ts")).toBe(true);
    expect(titles()).toEqual(["renamed.ts"]);
    expect(pane().tabs[0].path).toBe("/p/src/renamed.ts");
    expect(await moveEntry("/p/src", "/p/src/inner")).toBe(false);
    expect(await moveEntry("/p/src", "/p/code")).toBe(true);
    expect(pane().tabs[0].path).toBe("/p/code/renamed.ts");
  });

  it("deletes after confirmation and closes clean tabs", async () => {
    await useEditor.getState().openFile("/p/notes.md");
    const p = deleteEntry("/p/notes.md");
    await vi.waitFor(() => expect(useUi.getState().dialog).not.toBeNull());
    useUi.getState().closeDialog("delete");
    await p;
    expect(await backend.exists("/p/notes.md")).toBe(false);
    expect(titles()).toEqual([]);
  });
});

describe("settings", () => {
  it("saves, edits and deletes custom themes", () => {
    const t = cloneTheme(BUILTIN_THEMES[0], "Mine");
    useSettings.getState().saveCustomTheme(t);
    useSettings.getState().set("themeId", t.id);
    expect(findTheme(t.id).name).toBe("Mine");
    useSettings.getState().saveCustomTheme({ ...t, name: "Renamed" });
    expect(useSettings.getState().customThemes).toHaveLength(1);
    expect(findTheme(t.id).name).toBe("Renamed");
    useSettings.getState().deleteCustomTheme(t.id);
    expect(useSettings.getState().themeId).toBe("nox-dark");
  });

  it("persists to localStorage", () => {
    useSettings.getState().set("fontSize", 17);
    expect(JSON.parse(localStorage.getItem("nox.settings")!).state.fontSize).toBe(17);
  });
});

describe("commands & keybindings", () => {
  it("resolves shortcuts, honors overrides and terminal scope", async () => {
    const run = vi.fn();
    registerCommands([
      { id: "t.local", title: "Local", keybinding: "Ctrl+J", run },
      { id: "t.global", title: "Global", keybinding: "ctrl+shift+j", global: true, run },
    ]);
    expect(commandForCombo("Ctrl+J", false)?.id).toBe("t.local");
    expect(commandForCombo("Ctrl+J", true)).toBeNull();
    expect(commandForCombo("Ctrl+Shift+J", true)?.id).toBe("t.global");
    useSettings.getState().setKeybinding("t.local", "Alt+J");
    expect(keysFor("t.local")).toEqual(["Alt+J"]);
    expect(commandForCombo("Ctrl+J", false)).toBeNull();
    useSettings.getState().setKeybinding("t.local", null);
    expect(keysFor("t.local")).toEqual([]);
    useSettings.getState().setKeybinding("t.local", undefined);
    expect(keysFor("t.local")).toEqual(["Ctrl+J"]);
    expect(conflictsFor("ctrl+j").map((c) => c.id)).toEqual(["t.local"]);
    await runCommand("t.global");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hides extension commands while the extension is off", () => {
    registerCommands([{ id: "t.ext", title: "Ext", keybinding: "Ctrl+Alt+J", extension: "prettier", run: () => {} }]);
    expect(commandForCombo("Ctrl+Alt+J", false)?.id).toBe("t.ext");
    useSettings.getState().setExtEnabled("prettier", false);
    expect(commandForCombo("Ctrl+Alt+J", false)).toBeNull();
  });
});

describe("split by drag & drop", () => {
  it("moves a tab into a new group on either side", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/src/b.ts");
    const ed = useEditor.getState();
    const first = pane();
    const b = first.tabs.find((t) => t.title === "b.ts")!;
    ed.splitWithTab(first.id, b.id, first.id, "right");
    expect(useEditor.getState().panes).toHaveLength(2);
    expect(titles(0)).toEqual(["a.ts"]);
    expect(titles(1)).toEqual(["b.ts"]);
    expect(useEditor.getState().activePaneId).toBe(useEditor.getState().panes[1].id);

    // A group's only tab dragged to the left of the other group: it moves, its group closes.
    const right = useEditor.getState().panes[1];
    useEditor.getState().splitWithTab(right.id, right.tabs[0].id, useEditor.getState().panes[0].id, "left");
    expect(useEditor.getState().panes.map((p) => p.tabs.map((t) => t.title))).toEqual([["b.ts"], ["a.ts"]]);
  });

  it("copies when the only tab is dropped on its own edge", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    const p = pane();
    useEditor.getState().splitWithTab(p.id, p.tabs[0].id, p.id, "right");
    expect(useEditor.getState().panes.map((x) => x.tabs.map((t) => t.title))).toEqual([["a.ts"], ["a.ts"]]);
    // Both tabs share one buffer.
    expect(Object.keys(useEditor.getState().buffers)).toHaveLength(1);
  });

  it("opens a dropped file in a new group", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/notes.md", { split: { paneId: pane().id, side: "left" } });
    expect(useEditor.getState().panes.map((x) => x.tabs.map((t) => t.title))).toEqual([["notes.md"], ["a.ts"]]);
  });
});

describe("terminal shells", () => {
  it("starts the picked profile, the default one, or the custom command", async () => {
    const { useTerminal } = await import("@/stores/terminal");
    const spawn = vi.spyOn(backend, "ptySpawn");
    await useTerminal.getState().create(undefined, "demo-bash");
    expect(spawn).toHaveBeenLastCalledWith(ROOT, expect.any(Number), expect.any(Number), "bash", []);
    expect(useTerminal.getState().terms.at(-1)!.title).toBe("Bash (demo)");

    await useTerminal.getState().create();
    expect(spawn).toHaveBeenLastCalledWith(ROOT, expect.any(Number), expect.any(Number), "demo-shell", []);

    useSettings.setState({ terminalProfile: "custom", terminalShell: "fish -l" });
    await useTerminal.getState().create();
    expect(spawn).toHaveBeenLastCalledWith(ROOT, expect.any(Number), expect.any(Number), "fish -l", undefined);
    expect(useTerminal.getState().terms.at(-1)!.title).toBe("fish");

    for (const t of useTerminal.getState().terms) await useTerminal.getState().kill(t.id);
    expect(useTerminal.getState().terms).toHaveLength(0);
  });
});

describe("splitting down", () => {
  it("drops a tab on the bottom edge into a group below", async () => {
    await useEditor.getState().openFile("/p/src/a.ts");
    await useEditor.getState().openFile("/p/src/b.ts");
    const p = pane();
    useEditor.getState().splitWithTab(p.id, p.tabs[1].id, p.id, "bottom");
    const { layout, panes } = useEditor.getState();
    expect(layout).toMatchObject({ kind: "split", dir: "column" });
    expect(panes.map((x) => x.tabs.map((t) => t.title))).toEqual([["a.ts"], ["b.ts"]]);
    // Closing the lower group's last tab removes it from the layout too.
    await useEditor.getState().closeTab(panes[1].id, panes[1].tabs[0].id);
    expect(useEditor.getState().layout).toEqual({ kind: "pane", paneId: panes[0].id });
  });
});
