import { expect, test, type Page } from "@playwright/test";

/** The browser build opens the in-memory demo project. */
async function boot(page: Page) {
  await page.goto("/");
  await expect(page.locator("[data-ready]")).toBeVisible();
  await expect(page.getByTestId("tree-row").first()).toBeVisible();
}

/** A tree row by its exact name (icon tiles like "TS" are not part of it). */
const treeRow = (page: Page, name: string) => page.getByTestId("tree-row").filter({ has: page.getByTestId("tree-name").getByText(name, { exact: true }) });

async function openFromTree(page: Page, folder: string, file: string) {
  await treeRow(page, folder).click();
  await treeRow(page, file).dblclick();
  await expect(page.locator(`[data-testid=tab][data-title="${file}"]`)).toBeVisible();
}

test("opens a file, edits, shows dirty state and saves", async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await openFromTree(page, "src", "main.ts");
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("createTachyon");
  // Syntax highlighting, TODO highlighter and git gutter are live.
  await expect(page.locator(".todo-mark").first()).toBeVisible();
  await expect(page.locator(".git-marker-mod").first()).toBeVisible();

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// warp 9");
  await expect(page.getByTestId("dirty-dot")).toBeVisible();
  await page.keyboard.press("Control+S");
  await expect(page.getByTestId("dirty-dot")).toHaveCount(0);
  await expect(page.getByTestId("status-cursor")).toContainText("Ln");
});

test("quick open and the command palette", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+P");
  await page.getByTestId("palette-input").fill("partcl");
  await expect(page.getByTestId("palette-row").first()).toContainText("particle.ts");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid=tab][data-title="particle.ts"]')).toBeVisible();

  await page.keyboard.press("Control+Shift+P");
  await page.getByTestId("palette-input").fill(">toggle word wrap");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-lineWrapping")).toHaveCount(1);
});

test("switches themes from settings and the palette", async ({ page }) => {
  await boot(page);
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.locator('[data-testid=theme-card][data-theme-id="event-horizon"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "event-horizon");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings")).toHaveCount(0);
  await expect(page.getByTestId("status-theme")).toContainText("Event Horizon");
});

test("splits the editor and keeps both groups in sync", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  await page.keyboard.press("Control+\\");
  await expect(page.getByTestId("pane")).toHaveCount(2);
  const right = page.getByTestId("pane").nth(1).locator(".cm-content");
  await right.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("// synced\n");
  await expect(page.getByTestId("pane").nth(0).locator(".cm-content")).toContainText("// synced");
});

test("runs commands in the terminal", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+`");
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("nox@demo");
  await page.locator(".xterm").click();
  await page.keyboard.type("ls src\r");
  await expect(page.locator(".xterm-rows")).toContainText("physics/");
});

test("searches across files and toggles extensions", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+Shift+F");
  await page.getByTestId("search-input").fill("tachyon");
  await expect(page.getByTestId("search-summary")).toContainText(/\d+ results? in \d+ files?/);
  await page.getByTestId("search-match").first().click();
  await expect(page.getByTestId("tab").first()).toBeVisible();
  await expect(page.locator(".cm-minimap-gutter")).toHaveCount(1);

  await page.getByTestId("view-extensions").click();
  await page.getByLabel("Search extensions").fill("minimap");
  await page.locator('[data-ext="minimap"]').getByRole("switch").click();
  await expect(page.locator(".cm-minimap-gutter")).toHaveCount(0);
});

test("creates a file from the explorer and commits it", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+Alt+N");
  await page.getByTestId("explorer-input").fill("orbit.ts");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid=tab][data-title="orbit.ts"]')).toBeVisible();

  await page.getByTestId("view-git").click();
  await expect(page.getByTestId("git-row").filter({ hasText: "orbit.ts" })).toBeVisible();
  await page.getByTestId("commit-message").fill("feat: add orbit");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText(/working tree clean/)).toBeVisible();
});

test("dragging a tab to the editor's edge opens a split", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  await page.keyboard.press("Control+P");
  await page.getByTestId("palette-input").fill("particle");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid=tab][data-title="particle.ts"]').dblclick();
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await expect(page.getByTestId("pane")).toHaveCount(1);

  const body = page.getByTestId("pane-body").first();
  const box = (await body.boundingBox())!;
  await page.locator('[data-testid=tab][data-title="particle.ts"]').dragTo(body, { targetPosition: { x: box.width - 20, y: box.height / 2 } });
  await expect(page.getByTestId("pane")).toHaveCount(2);
  // The tab moved: main.ts stays left, particle.ts is alone on the right.
  await expect(page.getByTestId("pane").nth(0).getByTestId("tab")).toHaveCount(1);
  await expect(page.getByTestId("pane").nth(1).locator('[data-testid=tab][data-title="particle.ts"]')).toBeVisible();
  await expect(page.getByTestId("pane").nth(1)).toHaveAttribute("data-active", "true");

  // Typing goes to the group that was clicked, in either group.
  await page.getByTestId("pane").nth(0).locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("// left\n");
  await expect(page.getByTestId("pane").nth(0).locator(".cm-content")).toContainText("// left");
  await expect(page.getByTestId("pane").nth(0)).toHaveAttribute("data-active", "true");

  // Back into the left group's middle: the right group closes.
  await page.locator('[data-testid=tab][data-title="particle.ts"]').dragTo(page.getByTestId("pane-body").first());
  await expect(page.getByTestId("pane")).toHaveCount(1);
});

test("dragging a file from the explorer onto an edge opens it beside", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  const body = page.getByTestId("pane-body").first();
  const box = (await body.boundingBox())!;
  await treeRow(page, "README.md").dragTo(body, { targetPosition: { x: 20, y: box.height / 2 } });
  await expect(page.getByTestId("pane")).toHaveCount(2);
  await expect(page.getByTestId("pane").nth(0).locator('[data-testid=tab][data-title="README.md"]')).toBeVisible();
});

test("a simple title bar and a sidebar that is just the tree", async ({ page }) => {
  await boot(page);
  const bar = page.getByTestId("title-bar");
  await expect(bar.getByTestId("app-name")).toHaveText("Nox Code");
  await expect(bar.getByRole("button")).toHaveCount(5 + 1 + 3); // menus, settings, window controls
  await expect(bar.getByRole("tab")).toHaveCount(3); // explorer, git, extensions — search is an editor tab
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar.getByText("Open Editors")).toHaveCount(0);
  await expect(page.getByTestId("project-switcher")).toHaveCount(0);
  await expect(sidebar.getByTestId("tree-row").first()).toBeVisible();
  await expect(sidebar.getByTestId("tree-row").first().locator("svg.lucide-chevron-right")).toHaveCount(0);

  await bar.getByTestId("view-git").click();
  await expect(page.getByTestId("commit-message")).toBeVisible();
  // Clicking the open view again hides the sidebar.
  await bar.getByTestId("view-git").click();
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
});

test("docked layout: flush with the window away from the sidebar", async ({ page }) => {
  await boot(page);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-layout").click();
  await page.getByTestId("layout-docked").click();
  await page.keyboard.press("Escape");
  await openFromTree(page, "src", "main.ts");
  // Sidebar on the left: the right edge and the bottom are square.
  const pane = page.getByTestId("pane").first();
  await expect(pane).toHaveClass(/rounded-tr-none/);
  await expect(pane).toHaveClass(/rounded-br-none/);
  await expect(pane).not.toHaveClass(/rounded-tl-none/);
  await page.keyboard.press("Control+`");
  const term = page.getByTestId("terminal-panel");
  await expect(term).toHaveClass(/rounded-bl-none/);
  await expect(term).not.toHaveClass(/rounded-tl-none/);
  // With the terminal below, the editor's bottom corners round off again.
  await expect(pane).not.toHaveClass(/rounded-bl-none/);
  const box = (await term.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThanOrEqual(1440 - 1);
  expect(box.y + box.height).toBeGreaterThan(900 - 40);
  await expect(term).not.toContainText("Terminal");
});

test("browser shortcuts never reach the browser", async ({ page }) => {
  await boot(page);
  // A string, so the e2e tsconfig needs no DOM types.
  const prevented = await page.evaluate(`(() => {
    const ev = new KeyboardEvent("keydown", { key: "r", code: "KeyR", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`);
  expect(prevented).toBe(true);
});

test("picks a shell for a new terminal", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+`");
  await expect(page.getByRole("tab", { name: /Demo Shell/ })).toBeVisible();
  await page.getByTestId("choose-shell").click();
  await page.getByRole("menuitem", { name: /Bash \(demo\)/ }).click();
  await expect(page.getByRole("tab", { name: /Bash \(demo\)/ })).toBeVisible();
  await page.locator(".xterm:visible").click();
  await page.keyboard.type("echo second\r");
  await expect(page.locator(".xterm-rows:visible")).toContainText("second");
});

test("dragging a tab to the bottom edge opens a group below", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  await page.keyboard.press("Control+P");
  await page.getByTestId("palette-input").fill("particle");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid=tab][data-title="particle.ts"]').dblclick();

  const body = page.getByTestId("pane-body").first();
  const box = (await body.boundingBox())!;
  await page.locator('[data-testid=tab][data-title="particle.ts"]').dragTo(body, { targetPosition: { x: box.width / 2, y: box.height - 20 } });
  await expect(page.getByTestId("pane")).toHaveCount(2);
  const [top, bottom] = [await page.getByTestId("pane").nth(0).boundingBox(), await page.getByTestId("pane").nth(1).boundingBox()];
  // Stacked: same column, the new group underneath.
  expect(Math.abs(top!.x - bottom!.x)).toBeLessThan(2);
  expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 1);
  await expect(page.getByTestId("pane").nth(1).locator('[data-testid=tab][data-title="particle.ts"]')).toBeVisible();
});

test("Ctrl+J opens and closes the terminal without spawning new ones", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+J");
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
  await page.locator(".xterm").click();
  await page.keyboard.press("Control+J");
  await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
  await page.keyboard.press("Control+J");
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
  await expect(page.getByTestId("terminal-panel").getByRole("tab")).toHaveCount(1);
});

test("split groups sit one gap apart", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  await page.keyboard.press("Control+\\");
  const [a, b] = [(await page.getByTestId("pane").nth(0).boundingBox())!, (await page.getByTestId("pane").nth(1).boundingBox())!];
  expect(Math.round(b.x - (a.x + a.width))).toBe(6);
});

test("project search is an editor tab with excerpts", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator('[data-testid=tab][data-title="Search"]')).toBeVisible();
  await expect(page.getByTestId("sidebar").getByTestId("search-input")).toHaveCount(0);
  await page.getByTestId("search-input").fill("velocity");
  await expect(page.getByTestId("search-counter")).toHaveText(/^1\/\d+$/);
  await expect(page.getByTestId("search-file").first()).toContainText("Open File");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-counter")).toHaveText(/^2\/\d+$/);
  await page.keyboard.press("Alt+Enter");
  await expect(page.locator(".cm-content")).toContainText("velocity");
});

test("find in file looks like project search", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+F");
  await expect(page.getByTestId("find-panel")).toBeVisible();
  await page.keyboard.type("velocity");
  await expect(page.getByTestId("find-counter")).toHaveText(/^\d+\/\d+$/);
  const total = Number((await page.getByTestId("find-counter").textContent())!.split("/")[1]);
  expect(total).toBeGreaterThan(1);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("find-counter")).toHaveText(new RegExp(`^[1-9]\d*/${total}$`));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("find-panel")).toHaveCount(0);
});

test("the mouse wheel scrolls the tab strip sideways", async ({ page }) => {
  await boot(page);
  await page.locator("body").click();
  for (let i = 0; i < 14; i++) await page.keyboard.press("Control+N");
  const strip = page.getByTestId("pane").first().getByRole("tablist");
  await strip.evaluate((el: { scrollLeft: number }) => (el.scrollLeft = 0));
  await strip.hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => strip.evaluate((el: { scrollLeft: number }) => el.scrollLeft)).toBeGreaterThan(0);
});

test("tab bar buttons can be hidden", async ({ page }) => {
  await boot(page);
  await openFromTree(page, "src", "main.ts");
  const pane = page.getByTestId("pane").first();
  await expect(pane.getByRole("button", { name: /^Split Editor Right/ })).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-nav-layout").click();
  await page.getByRole("switch", { name: "Split button" }).click();
  await page.getByRole("switch", { name: "More actions button" }).click();
  await page.keyboard.press("Escape");
  await expect(pane.getByRole("button", { name: /^Split Editor Right/ })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "More Actions" })).toHaveCount(0);
});
