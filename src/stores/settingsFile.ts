/**
 * settings.json: the settings as a real file in Nox's config folder. Opening
 * it writes the current settings out; saving it applies them back.
 */
import { backend } from "@/lib/backend";
import { dirname, join, samePath } from "@/lib/path";
import { docHub } from "@/editor/docHub";
import { registerSaveHook, useEditor } from "./editor";
import { useSettings } from "./settings";
import { exportSettings, importSettings } from "./settingsJson";
import { errorMessage, toast } from "./ui";

let resolved: string | null = null;

export async function settingsFilePath(): Promise<string> {
  if (resolved) return resolved;
  let dir = "/.nox";
  if (backend().kind === "tauri") {
    try {
      const { appConfigDir } = await import("@tauri-apps/api/path");
      dir = await appConfigDir();
    } catch {
      /* keep the fallback */
    }
  }
  return (resolved = join(dir, "settings.json"));
}

/** True for the settings file, once its path is known. */
export const isSettingsFile = (path: string | null) => !!path && !!resolved && samePath(path, resolved);

const fileText = () => exportSettings() + "\n";
const settingsBuffer = () => Object.values(useEditor.getState().buffers).find((b) => isSettingsFile(b.path));

async function writeOut(path: string) {
  const dir = dirname(path);
  if (!(await backend().exists(dir))) await backend().createDir(dir);
  await backend().writeFile(path, fileText());
}

/** Opens settings.json in the editor, filled with the current settings. */
export async function openSettingsFile() {
  try {
    const path = await settingsFilePath();
    const buf = settingsBuffer();
    // Unsaved edits in an open tab win over a fresh copy.
    if (!buf?.dirty) {
      await writeOut(path);
      if (buf) docHub.setText(buf.id, fileText(), { markSaved: true });
    }
    await useEditor.getState().openFile(path);
  } catch (e) {
    toast("Could not open settings.json", "error", errorMessage(e));
  }
}

function report(r: { applied: string[]; skipped: string[] }) {
  toast(`Applied ${r.applied.length} setting${r.applied.length === 1 ? "" : "s"}`, "success", r.skipped.length ? `Skipped: ${r.skipped.join(", ")}` : undefined);
}

/** Save hook: saving settings.json applies it. The file is written either way. */
function applySavedSettings(path: string | null, text: string) {
  if (!isSettingsFile(path)) return;
  try {
    report(importSettings(text));
  } catch (e) {
    toast("Invalid settings JSON", "error", errorMessage(e));
  }
}

/** Keeps an open, unedited settings.json tab in step with changes made elsewhere. */
function syncSettingsFile() {
  let timer: ReturnType<typeof setTimeout>;
  useSettings.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const buf = settingsBuffer();
      if (!buf?.path || buf.dirty || docHub.text(buf.id) === fileText()) return;
      docHub.setText(buf.id, fileText(), { markSaved: true });
      void writeOut(buf.path).catch(() => {});
    }, 300);
  });
}

let wired = false;

/** Once per app: saving settings.json applies it; an open tab follows changes. */
export function wireSettingsFile() {
  if (wired) return;
  wired = true;
  void settingsFilePath();
  registerSaveHook(async (buf, text) => (applySavedSettings(buf.path, text), null));
  syncSettingsFile();
}

/** Picks a JSON file from disk and applies the settings in it. */
export function loadSettingsFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.jsonc,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      report(importSettings(await file.text()));
    } catch (e) {
      toast(`Could not load ${file.name}`, "error", errorMessage(e));
    }
  };
  input.click();
}
