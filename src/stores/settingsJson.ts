/** Settings as plain JSON: copy them out, paste them back (another machine, a backup). */
import { DEFAULT_SETTINGS, useSettings, type SettingsState } from "./settings";

/** Machine-specific, so not part of an export. */
const LOCAL_ONLY: Array<keyof SettingsState> = ["recentProjects"];

export function exportSettings(): string {
  const s = useSettings.getState();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsState>) {
    if (!LOCAL_ONLY.includes(key)) out[key] = s[key];
  }
  return JSON.stringify(out, null, 2);
}

const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/**
 * Applies every known key whose value has the right type; the rest is
 * reported back instead of breaking the app. Throws on invalid JSON.
 */
export function importSettings(json: string): { applied: string[]; skipped: string[] } {
  const data: unknown = JSON.parse(json);
  if (kind(data) !== "object") throw new Error("Expected a JSON object");
  const patch: Partial<SettingsState> = {};
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const k = key as keyof SettingsState;
    if (!(key in DEFAULT_SETTINGS) || LOCAL_ONLY.includes(k) || kind(value) !== kind(DEFAULT_SETTINGS[k])) {
      skipped.push(key);
      continue;
    }
    (patch as Record<string, unknown>)[key] = value;
    applied.push(key);
  }
  useSettings.getState().patch(patch);
  return { applied, skipped };
}
