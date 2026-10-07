import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setBackend } from "@/lib/backend";
import { createMemoryBackend } from "@/lib/memoryBackend";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { useUi } from "@/stores/ui";
import { DEFAULT_SETTINGS, useSettings } from "@/stores/settings";
import { registerAppCommands } from "@/app/commands";
import { Palette } from "@/components/overlays/Palette";
import { DialogHost, Toasts } from "@/components/overlays/Overlays";
import { ExtensionsView } from "@/components/sidebar/ExtensionsView";
import { ExplorerTree } from "@/components/sidebar/ExplorerTree";
import { SearchTab } from "@/components/editor/SearchTab";
import { GitView } from "@/components/sidebar/GitView";
import { KeybindingsSettings } from "@/components/settings/KeybindingsSettings";
import { IconsSettings } from "@/components/settings/IconsSettings";
import { Switch, Segmented } from "@/components/ui";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { TitleBar } from "@/components/layout/TitleBar";
import { useSearch } from "@/stores/search";
import { backend } from "@/lib/backend";
import { exportSettings, importSettings } from "@/stores/settingsJson";

const ROOT = "/p";

beforeEach(async () => {
  setBackend(
    createMemoryBackend({
      root: ROOT,
      files: { "src/main.ts": "const x = 1; // TODO\n", "src/util.ts": "export const y = 2;\n", "README.md": "# Readme\n" },
      working: { "src/main.ts": "const x = 2; // TODO\n" },
    }),
  );
  useSettings.setState({ ...DEFAULT_SETTINGS });
  useEditor.getState().reset();
  useUi.setState({ paletteOpen: false, quickPick: null, dialog: null, toasts: [] });
  useSearch.setState({ query: "", include: "", exclude: "", result: null, error: null, dismissed: [], current: 0, showFilters: false, showReplace: false });
  registerAppCommands();
  await useWorkspace.getState().openFolder(ROOT);
});

describe("ui primitives", () => {
  it("Switch toggles and Segmented selects", async () => {
    const user = userEvent.setup();
    let on = false;
    let seg = "a";
    const { rerender } = render(
      <>
        <Switch on={on} onChange={(v) => (on = v)} ariaLabel="power" />
        <Segmented options={["a", "b"] as const} value={seg as "a"} onChange={(v) => (seg = v)} />
      </>,
    );
    await user.click(screen.getByRole("switch", { name: "power" }));
    expect(on).toBe(true);
    await user.click(screen.getByRole("radio", { name: "b" }));
    expect(seg).toBe("b");
    rerender(<Switch on onChange={() => {}} ariaLabel="power" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("Palette", () => {
  it("finds files fuzzily and opens them", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    act(() => useUi.getState().openPalette(""));
    const input = await screen.findByTestId("palette-input");
    await user.type(input, "utl");
    await waitFor(() => expect(screen.getAllByTestId("palette-row")[0]).toHaveTextContent("util.ts"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(useEditor.getState().panes[0].tabs.map((t) => t.title)).toEqual(["util.ts"]));
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it("runs commands with the > prefix", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    act(() => useUi.getState().openPalette(">"));
    await user.type(await screen.findByTestId("palette-input"), "toggle word wrap");
    await waitFor(() => expect(screen.getAllByTestId("palette-row")[0]).toHaveTextContent("Toggle Word Wrap"));
    await user.keyboard("{Enter}");
    expect(useSettings.getState().wordWrap).toBe(true);
  });

  it("previews themes and restores the original on Escape", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    act(() => useUi.getState().openPalette(">"));
    await user.type(await screen.findByTestId("palette-input"), "color theme");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(useUi.getState().quickPick).not.toBeNull());
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(useSettings.getState().themeId).not.toBe("nox-dark"));
    await user.keyboard("{Escape}");
    expect(useSettings.getState().themeId).toBe("nox-dark");
  });
});

describe("Explorer indent guides", () => {
  it("draws a line per level under open folders", async () => {
    const user = userEvent.setup();
    render(<ExplorerTree />);
    const row = (name: string) => {
      const r = screen.getAllByTestId("tree-row").find((x) => x.textContent?.endsWith(name));
      if (!r) throw new Error(`no row ${name}`);
      return r;
    };
    const src = await waitFor(() => row("src"));
    if (src.getAttribute("aria-expanded") !== "true") await user.click(src);
    const child = await waitFor(() => row("util.ts"));
    expect(child.querySelectorAll("[data-guide]")).toHaveLength(1);
    act(() => useSettings.setState({ explorerIndentGuides: false }));
    expect(child.querySelectorAll("[data-guide]")).toHaveLength(0);
  });
});

describe("Explorer tree", () => {
  it("shows the project with git colors and opens files", async () => {
    const user = userEvent.setup();
    await useWorkspace.getState().refreshGit();
    render(<ExplorerTree />);
    const rows = screen.getAllByTestId("tree-row");
    expect(rows.map((r) => r.textContent)).toEqual(["src", "README.md"]);
    await user.click(rows[0]);
    await waitFor(() => expect(screen.getAllByTestId("tree-row")).toHaveLength(4));
    const main = screen.getAllByTestId("tree-row").find((r) => r.textContent?.includes("main.ts"))!;
    expect(main).toHaveTextContent("M");
    await user.dblClick(main);
    await waitFor(() => expect(useEditor.getState().panes[0].tabs[0]?.title).toBe("main.ts"));
  });

  it("creates a file through the inline input", async () => {
    const user = userEvent.setup();
    render(<ExplorerTree />);
    act(() => useWorkspace.getState().startCreate("file", ROOT));
    const input = await screen.findByTestId("explorer-input");
    await user.type(input, "new.ts{Enter}");
    await waitFor(() => expect(screen.getAllByTestId("tree-row").some((r) => r.textContent?.endsWith("new.ts"))).toBe(true));
  });
});

describe("Search tab", () => {
  it("searches the project and jumps to a match", async () => {
    const user = userEvent.setup();
    render(<SearchTab paneId={useEditor.getState().panes[0].id} />);
    await user.type(screen.getByTestId("search-input"), "const");
    await waitFor(() => expect(screen.getByTestId("search-summary")).toHaveTextContent("2 results in 2 files"));
    await user.click(screen.getAllByTestId("search-match")[0]);
    await waitFor(() => expect(useEditor.getState().panes[0].tabs).toHaveLength(1));
  });
});

describe("Search tab (excerpts)", () => {
  it("is a single editor tab", () => {
    act(() => useEditor.getState().openSearch());
    act(() => useEditor.getState().openSearch());
    const tabs = useEditor.getState().panes.flatMap((p) => p.tabs);
    expect(tabs.filter((t) => t.kind === "search")).toHaveLength(1);
  });

  it("shows context around a match, expands it and steps through matches", async () => {
    const user = userEvent.setup();
    const body = Array.from({ length: 40 }, (_, i) => (i === 19 || i === 29 ? `const needle${i + 1} = ${i + 1};` : `// line ${i + 1}`)).join("\n");
    await backend().writeFile(ROOT + "/src/long.ts", body);
    render(<SearchTab paneId={useEditor.getState().panes[0].id} />);
    await user.type(screen.getByTestId("search-input"), "needle");
    await waitFor(() => expect(screen.getByTestId("search-counter")).toHaveTextContent("1/2"));
    // Two lines of context on each side of line 20.
    await waitFor(() => expect(screen.getByText("// line 18")).toBeInTheDocument());
    expect(screen.queryByText("// line 17")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Expand up" })[0]);
    expect(screen.getByText("// line 12")).toBeInTheDocument();
    await user.click(screen.getByTestId("search-input"));
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("search-counter")).toHaveTextContent("2/2");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByTestId("search-counter")).toHaveTextContent("1/2");
    expect(document.querySelector('mark[data-match="0:0"]')).toHaveTextContent("needle");
  });
});

describe("Settings", () => {
  it("searches every section", async () => {
    const user = userEvent.setup();
    render(<SettingsModal />);
    await user.type(screen.getByTestId("settings-search"), "bread");
    expect(screen.getByText("Breadcrumbs")).toBeInTheDocument();
    expect(screen.queryByText("Font size")).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Breadcrumbs" }));
    expect(useSettings.getState().showBreadcrumbs).toBe(false);
  });

  it("folds the title bar behind buttons", async () => {
    const user = userEvent.setup();
    useSettings.setState({ titleMenus: "compact", titleActions: "compact" });
    render(<TitleBar />);
    expect(screen.queryByText("File")).toBeNull();
    expect(screen.queryByTestId("open-settings")).toBeNull();
    await user.click(screen.getByTestId("title-menus-toggle"));
    expect(screen.getByText("File")).toBeInTheDocument();
    await user.click(screen.getByTestId("title-actions-toggle"));
    await user.click(screen.getByTestId("open-settings"));
    expect(useUi.getState().settingsOpen).toBe(true);
    // Picking folds the group back.
    expect(screen.queryByTestId("open-settings")).toBeNull();
  });
});

describe("Settings JSON and tab bar buttons", () => {
  it("round-trips settings and skips bad values", () => {
    useSettings.setState({ fontSize: 17, recentProjects: ["/secret"] });
    const json = exportSettings();
    expect(JSON.parse(json).fontSize).toBe(17);
    expect(json).not.toContain("/secret");
    useSettings.setState({ fontSize: 12 });
    const r = importSettings(JSON.stringify({ fontSize: 17, wordWrap: "yes", nope: 1 }));
    expect(useSettings.getState().fontSize).toBe(17);
    expect(useSettings.getState().wordWrap).toBe(false);
    expect(r.skipped).toEqual(["wordWrap", "nope"]);
    expect(() => importSettings("{oops")).toThrow();
  });
});

describe("Source control", () => {
  it("stages and commits changes", async () => {
    const user = userEvent.setup();
    await useWorkspace.getState().refreshGit();
    render(
      <>
        <GitView />
        <Toasts />
      </>,
    );
    expect(screen.getAllByTestId("git-row")).toHaveLength(1);
    await user.click(screen.getByTestId("git-stage"));
    await waitFor(() => expect(screen.getByText("Staged Changes")).toBeInTheDocument());
    await user.type(screen.getByTestId("commit-message"), "feat: faster{Control>}{Enter}{/Control}");
    await waitFor(() => expect(screen.queryAllByTestId("git-row")).toHaveLength(0));
    expect(screen.getByText(/working tree clean/)).toBeInTheDocument();
  });
});

describe("Extensions view", () => {
  it("filters and toggles extensions", async () => {
    const user = userEvent.setup();
    render(<ExtensionsView />);
    await user.type(screen.getByLabelText("Search extensions"), "vim");
    const card = screen.getAllByTestId("ext-card").find((c) => c.getAttribute("data-ext") === "vim")!;
    const sw = within(card).getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(useSettings.getState().extEnabled.vim).toBe(true);
    await user.clear(screen.getByLabelText("Search extensions"));
    await user.click(screen.getByRole("button", { name: "Languages" }));
    expect(screen.getAllByTestId("ext-card").every((c) => c.getAttribute("data-ext")!.startsWith("lang-"))).toBe(true);
  });

  it("edits extension settings inline", async () => {
    const user = userEvent.setup();
    render(<ExtensionsView />);
    const card = screen.getAllByTestId("ext-card").find((c) => c.getAttribute("data-ext") === "minimap")!;
    await user.click(within(card).getByText("Minimap"));
    await user.click(within(card).getByRole("radio", { name: "Characters" }));
    expect(useSettings.getState().extSettings.minimap.displayText).toBe("characters");
  });
});

describe("Keybindings editor", () => {
  it("records a new shortcut and resets it", async () => {
    render(<KeybindingsSettings />);
    const input = screen.getByLabelText("Search keybindings");
    fireEvent.change(input, { target: { value: "Toggle Word Wrap" } });
    const table = screen.getByTestId("keybindings");
    fireEvent.click(within(table).getByTitle("Change keybinding"));
    fireEvent.keyDown(window, { key: "w", code: "KeyW", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(useSettings.getState().keybindings["editor.toggleWordWrap"]).toBe("Ctrl+Alt+W");
    fireEvent.click(within(table).getByTitle(/Reset to/));
    expect("editor.toggleWordWrap" in useSettings.getState().keybindings).toBe(false);
  });
});

describe("Icon settings", () => {
  it("switches icon theme and adds a custom rule", async () => {
    const user = userEvent.setup();
    render(
      <>
        <IconsSettings />
        <Toasts />
      </>,
    );
    await user.click(screen.getAllByTestId("icon-theme-card")[2]);
    expect(useSettings.getState().iconTheme).toBe("badges");
    await user.type(screen.getByLabelText("Pattern"), "proto");
    await user.click(screen.getByRole("radio", { name: "Emoji" }));
    await user.clear(screen.getByLabelText("Emoji"));
    await user.type(screen.getByLabelText("Emoji"), "🛰");
    await user.click(screen.getByRole("button", { name: /Add rule/ }));
    expect(useSettings.getState().iconRules).toEqual([expect.objectContaining({ match: "ext", pattern: "proto", icon: { type: "emoji", char: "🛰" } })]);
    expect(screen.getByTestId("icon-rules")).toHaveTextContent("*.proto");
  });
});

describe("Dialogs", () => {
  it("resolve with the clicked button", async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    let answer = "";
    act(() => {
      void useUi
        .getState()
        .ask({ title: "Sure?", buttons: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], cancelId: "no" })
        .then((a) => (answer = a));
    });
    await user.click(await screen.findByRole("button", { name: "Yes" }));
    await waitFor(() => expect(answer).toBe("yes"));
  });
});
