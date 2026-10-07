import { AlertTriangle, ArrowDown, ArrowUp, Bell, Check, GitBranch, Palette, Paintbrush, Terminal } from "lucide-react";
import { runCommand } from "@/core/commands";
import { languageName } from "@/editor/languages";
import { useActiveBuffer, useActiveTab } from "@/stores/editor";
import { useCursor } from "@/stores/cursor";
import { useActiveTheme, useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { isExtEnabled } from "@/extensions/registry";
import { canFormat } from "@/extensions/prettier";
import { cx } from "@/components/ui";

function Item({ children, onClick, title, className, testId }: { children: React.ReactNode; onClick?: () => void; title?: string; className?: string; testId?: string }) {
  return (
    <button
      data-testid={testId}
      title={title}
      onClick={onClick}
      className={cx("flex h-full shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]", className)}
    >
      {children}
    </button>
  );
}

export function StatusBar() {
  const tab = useActiveTab();
  const buffer = useActiveBuffer();
  const cursor = useCursor();
  const git = useWorkspace((s) => s.git);
  const tabSize = useSettings((s) => s.tabSize);
  const spaces = useSettings((s) => s.insertSpaces);
  const extEnabled = useSettings((s) => s.extEnabled);
  const theme = useActiveTheme();
  const changes = git?.files.length ?? 0;
  const isText = tab?.kind === "text" && !!buffer;
  void extEnabled;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-0.5 bg-[var(--bg-sidebar)] px-1.5 py-[3px]" data-testid="status-bar">
      {git?.isRepo && (
        <Item onClick={() => useUi.getState().showSideView("git")} title="Source Control" testId="status-branch">
          <GitBranch size={12} />
          <span>{git.branch ?? "detached"}</span>
          {changes > 0 && <span className="text-[var(--diff-mod)]">{changes}</span>}
          {git.ahead > 0 && (
            <span className="flex items-center">
              <ArrowUp size={11} />
              {git.ahead}
            </span>
          )}
          {git.behind > 0 && (
            <span className="flex items-center">
              <ArrowDown size={11} />
              {git.behind}
            </span>
          )}
        </Item>
      )}
      {buffer?.diskChanged && (
        <Item className="text-[var(--diff-mod)]" title="The file changed on disk" onClick={() => void runCommand("file.revert")}>
          <AlertTriangle size={12} /> Changed on disk
        </Item>
      )}
      <div className="flex-1" />
      {isText && cursor.vimMode && isExtEnabled("vim") && (
        <span className="mr-1 rounded-md bg-[var(--accent)] px-1.5 font-mono text-[10.5px] font-semibold text-[var(--accent-fg)]">{cursor.vimMode}</span>
      )}
      {isText && (
        <>
          <Item onClick={() => void runCommand("editor.gotoLine")} title="Go to Line" testId="status-cursor">
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selected > 0 && <span className="text-[var(--text-dim)]">({cursor.selected} selected{cursor.selections > 1 ? `, ${cursor.selections} cursors` : ""})</span>}
          </Item>
          {cursor.words !== null && <Item title="Word count">{cursor.words.toLocaleString()} words</Item>}
          <Item onClick={() => void runCommand("editor.changeIndentation")} title="Select Indentation">
            {spaces ? "Spaces" : "Tab Size"}: {tabSize}
          </Item>
          <Item title="Encoding">UTF-8{buffer!.bom ? " BOM" : ""}</Item>
          <Item onClick={() => void runCommand("editor.changeEol")} title="Select End of Line Sequence">
            {buffer!.lineEnding}
          </Item>
          <Item onClick={() => void runCommand("editor.changeLanguage")} title="Select Language Mode" testId="status-language">
            {languageName(buffer!.langId)}
          </Item>
          {isExtEnabled("prettier") && canFormat(buffer!.langId) && (
            <Item onClick={() => void runCommand("editor.format")} title="Format with Prettier (Shift+Alt+F)">
              <Paintbrush size={11} /> Prettier
            </Item>
          )}
        </>
      )}
      <Item onClick={() => void runCommand("settings.theme")} title="Color Theme" testId="status-theme">
        <Palette size={12} /> {theme.name}
      </Item>
      <Item onClick={() => void runCommand("terminal.toggle")} title="Toggle Terminal">
        <Terminal size={12} />
      </Item>
      <Item title="Ready">
        {changes === 0 && git?.isRepo ? <Check size={12} /> : <Bell size={12} />}
      </Item>
    </footer>
  );
}
