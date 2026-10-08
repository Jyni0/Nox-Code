/** The right-click menu inside the code (the browser's own menu never shows there). */
import { ArrowLeft, ClipboardPaste, Copy, Command, MessageSquareCode, Paintbrush, Scissors, Search, SquareTerminal, Target, TextSelect } from "lucide-react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getCommand, isAvailable, keysFor, runCommand } from "@/core/commands";
import { ContextMenu, type MenuItem } from "@/components/ui/Menus";
import { toast } from "@/stores/ui";
import { isMac } from "@/lib/keys";
import { canFormat } from "@/extensions/prettier";
import { isExtEnabled } from "@/extensions/registry";
import { resolveAt } from "./intel/navigation";

const mod = isMac ? "Cmd" : "Ctrl";

function selectedText(view: EditorView): string {
  const { state } = view;
  return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak);
}

async function copy(view: EditorView, cut: boolean) {
  const { state } = view;
  // Nothing selected: the whole line, like VS Code.
  const empty = state.selection.ranges.every((r) => r.empty);
  const text = empty ? state.doc.lineAt(state.selection.main.head).text + "\n" : selectedText(view);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast(`Clipboard is not available — use ${mod}+${cut ? "X" : "C"}`, "warning");
    return;
  }
  if (!cut || state.readOnly) return;
  if (empty) {
    const line = state.doc.lineAt(state.selection.main.head);
    view.dispatch({ changes: { from: line.from, to: Math.min(line.to + 1, state.doc.length) }, userEvent: "delete.cut" });
  } else view.dispatch(state.replaceSelection(""), { userEvent: "delete.cut" });
}

async function paste(view: EditorView) {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    toast(`Clipboard is not available — use ${mod}+V`, "warning");
    return;
  }
  if (view.state.readOnly) return;
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
}

function cmd(id: string, label: string, icon: React.ReactNode): MenuItem | null {
  const c = getCommand(id);
  if (!c || !isAvailable(c)) return null;
  return { label, icon, combo: keysFor(id)[0], onClick: () => void runCommand(id) };
}

export function editorMenuItems(view: EditorView, langId: string, pos: number): MenuItem[] {
  const hasSel = view.state.selection.ranges.some((r) => !r.empty);
  const r = isExtEnabled("code-navigation") ? resolveAt(view.state, pos) : null;
  const canGo = !!r && (r.defs.length > 0 || !!r.importSpec);
  const after = () => requestAnimationFrame(() => view.focus());
  const items: Array<MenuItem | null> = [
    canGo ? cmd("editor.goToDefinition", "Go to Definition", <Target size={14} />) : null,
    r && !r.importSpec ? cmd("editor.findReferences", "Find All References", <Search size={14} />) : null,
    cmd("editor.goBack", "Go Back", <ArrowLeft size={14} />),
    "separator",
    { label: "Cut", icon: <Scissors size={14} />, combo: `${mod}+X`, disabled: view.state.readOnly, onClick: () => void copy(view, true).then(after) },
    { label: "Copy", icon: <Copy size={14} />, combo: `${mod}+C`, onClick: () => void copy(view, false).then(after) },
    { label: "Paste", icon: <ClipboardPaste size={14} />, combo: `${mod}+V`, disabled: view.state.readOnly, onClick: () => void paste(view).then(after) },
    "separator",
    cmd("editor.selectAllOccurrences", "Change All Occurrences", <TextSelect size={14} />),
    cmd("editor.toggleComment", "Toggle Line Comment", <MessageSquareCode size={14} />),
    canFormat(langId) ? cmd("editor.format", "Format Document", <Paintbrush size={14} />) : null,
    hasSel ? cmd("terminal.runSelection", "Run Selection in Terminal", <SquareTerminal size={14} />) : null,
    "separator",
    cmd("workbench.commandPalette", "Command Palette…", <Command size={14} />),
  ];
  // Drop empty entries and doubled / dangling separators.
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it === "separator" && (!out.length || out[out.length - 1] === "separator")) continue;
    out.push(it);
  }
  while (out[out.length - 1] === "separator") out.pop();
  return out;
}

/** Right-click outside the selection moves the caret there first. */
export function placeCaretForMenu(view: EditorView, pos: number) {
  const inside = view.state.selection.ranges.some((r) => pos >= r.from && pos <= r.to && !r.empty);
  if (!inside) view.dispatch({ selection: EditorSelection.cursor(pos) });
}

export function EditorMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  return <ContextMenu at={at} items={items} onClose={onClose} />;
}
