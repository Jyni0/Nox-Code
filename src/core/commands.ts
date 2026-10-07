/**
 * Command registry: everything in the palette, the menus and on a shortcut
 * is a command. Users rebind or unbind any of them (Settings → Keybindings).
 */
import { normalizeCombo } from "@/lib/keys";
import { isExtEnabled } from "@/extensions/registry";
import { useSettings } from "@/stores/settings";

export interface Command {
  id: string;
  title: string;
  category?: string;
  /** Default shortcut(s). */
  keybinding?: string | string[];
  /** Also fires while the terminal has focus (otherwise the shell gets the key). */
  global?: boolean;
  /** Only available while the extension is enabled. */
  extension?: string;
  /** Not listed in the command palette. */
  hidden?: boolean;
  when?: () => boolean;
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();
const listeners = new Set<() => void>();

export function registerCommands(list: Command[]) {
  for (const c of list) registry.set(c.id, c);
  listeners.forEach((l) => l());
}

export function onCommandsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const getCommand = (id: string) => registry.get(id);

export function isAvailable(c: Command): boolean {
  if (c.extension && !isExtEnabled(c.extension)) return false;
  return c.when ? c.when() : true;
}

export function allCommands(includeHidden = false): Command[] {
  return [...registry.values()].filter((c) => (includeHidden || !c.hidden) && (!c.extension || isExtEnabled(c.extension)));
}

export function defaultKeys(c: Command): string[] {
  const k = c.keybinding;
  return (Array.isArray(k) ? k : k ? [k] : []).map(normalizeCombo);
}

/** Effective shortcuts: a user override (or removal) replaces the defaults. */
export function keysFor(id: string, overrides = useSettings.getState().keybindings): string[] {
  const c = registry.get(id);
  if (!c) return [];
  if (id in overrides) {
    const o = overrides[id];
    return o ? [normalizeCombo(o)] : [];
  }
  return defaultKeys(c);
}

export function commandForCombo(combo: string, inTerminal: boolean): Command | null {
  const norm = normalizeCombo(combo);
  const overrides = useSettings.getState().keybindings;
  for (const c of registry.values()) {
    if (inTerminal && !c.global) continue;
    if (keysFor(c.id, overrides).includes(norm) && isAvailable(c)) return c;
  }
  return null;
}

/** Other commands already bound to `combo` (keybinding editor warnings). */
export function conflictsFor(combo: string, exceptId?: string): Command[] {
  const norm = normalizeCombo(combo);
  return [...registry.values()].filter((c) => c.id !== exceptId && keysFor(c.id).includes(norm));
}

export async function runCommand(id: string): Promise<void> {
  const c = registry.get(id);
  if (!c || !isAvailable(c)) return;
  await c.run();
}
