/** Explorer actions shared by the tree, its context menu and commands. */
import { backend } from "@/lib/backend";
import { basename, dirname, isInside, join, relative, samePath } from "@/lib/path";
import { useEditor } from "@/stores/editor";
import { useSettings } from "@/stores/settings";
import { errorMessage, toast, useUi } from "@/stores/ui";
import { uniqueSibling, useWorkspace } from "@/stores/workspace";

export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "A name is required";
  if (/[<>:"|?*\x00-\x1f]/.test(n)) return "The name contains characters that are not allowed";
  if (n === "." || n === "..") return "That name is reserved";
  if (/[. ]$/.test(n)) return "The name cannot end with a dot or a space";
  return null;
}

export async function createEntry(parent: string, name: string, kind: "file" | "folder"): Promise<boolean> {
  const err = validateName(name.replace(/[\\/]/g, ""));
  if (err) {
    toast(err, "error");
    return false;
  }
  // "a/b/c.ts" creates the folders on the way, like VS Code.
  const path = join(parent, ...name.trim().split(/[\\/]/));
  try {
    if (kind === "file") await backend().createFile(path);
    else await backend().createDir(path);
  } catch (e) {
    toast(errorMessage(e), "error");
    return false;
  }
  const ws = useWorkspace.getState();
  await ws.refreshPaths([path, dirname(path)]);
  await ws.revealPath(path);
  if (kind === "file") await useEditor.getState().openFile(path);
  return true;
}

export async function renameEntry(path: string, newName: string): Promise<boolean> {
  const n = newName.trim();
  if (n === basename(path)) return true;
  const err = validateName(n);
  if (err) {
    toast(err, "error");
    return false;
  }
  return moveEntry(path, join(dirname(path), n));
}

export async function moveEntry(from: string, to: string): Promise<boolean> {
  if (samePath(from, to)) return true;
  if (isInside(from, to)) {
    toast("Cannot move a folder into itself", "error");
    return false;
  }
  try {
    await backend().rename(from, to);
  } catch (e) {
    toast(errorMessage(e), "error");
    return false;
  }
  useEditor.getState().onPathRenamed(from, to);
  const ws = useWorkspace.getState();
  // Keep the moved folder expanded.
  const expanded = Object.fromEntries(
    Object.entries(ws.expanded).map(([p, v]) => [isInside(from, p) ? join(to, relative(from, p) ?? "") : p, v]),
  );
  useWorkspace.setState({ expanded, selected: to, renaming: null });
  await ws.refreshPaths([from, to, dirname(from), dirname(to)]);
  return true;
}

export async function deleteEntry(path: string): Promise<void> {
  const name = basename(path);
  if (useSettings.getState().confirmDelete) {
    const answer = await useUi.getState().ask({
      title: `Delete '${name}'?`,
      message: "It will be moved to the Recycle Bin. You can restore it from there.",
      buttons: [
        { id: "delete", label: "Move to Trash", variant: "danger" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });
    if (answer !== "delete") return;
  }
  try {
    await backend().remove(path, true);
  } catch (e) {
    toast(errorMessage(e), "error");
    return;
  }
  // Close clean tabs of the deleted files; dirty ones stay, marked deleted.
  const ed = useEditor.getState();
  ed.onPathDeleted(path);
  for (const p of ed.panes) {
    for (const t of p.tabs) {
      if (t.path && isInside(path, t.path)) {
        const b = t.bufferId ? useEditor.getState().buffers[t.bufferId] : null;
        if (!b?.dirty) await useEditor.getState().closeTab(p.id, t.id, true);
      }
    }
  }
  await useWorkspace.getState().refreshPaths([path, dirname(path)]);
}

export async function duplicateEntry(path: string): Promise<void> {
  const target = await uniqueSibling(path);
  try {
    await backend().copy(path, target);
  } catch (e) {
    toast(errorMessage(e), "error");
    return;
  }
  await useWorkspace.getState().refreshPaths([target, dirname(target)]);
  useWorkspace.getState().select(target);
  useWorkspace.getState().startRename(target);
}

export function copyText(text: string, what = "Copied") {
  void navigator.clipboard?.writeText(text).then(
    () => toast(what, "success"),
    () => toast("Clipboard is not available", "error"),
  );
}
