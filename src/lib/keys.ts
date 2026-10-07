/**
 * Keyboard shortcuts as strings like "Ctrl+Shift+P". Matching uses the
 * physical key (e.code), so Ctrl+P works on a Russian layout too.
 */

/** True while the keybinding editor records a shortcut (global handlers stand down). */
export const keyState = { recording: false };

const PUNCT: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  IntlBackslash: "\\",
};

const NAMED: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};

export function keyName(e: Pick<KeyboardEvent, "key" | "code">): string {
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (code === "NumpadAdd") return "=";
  if (code === "NumpadSubtract") return "-";
  if (PUNCT[code]) return PUNCT[code];
  if (NAMED[e.key]) return NAMED[e.key];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "OS"]);

/** "Ctrl+Shift+P" for a key event, or null for a lone modifier. */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(keyName(e));
  return parts.join("+");
}

const ORDER = ["Ctrl", "Shift", "Alt"];

/** Canonical spelling: modifiers in a fixed order, key upper-cased. */
export function normalizeCombo(combo: string): string {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  // "Ctrl++" style: a trailing empty part after split means the key is "+".
  if (combo.endsWith("++")) parts.push("+");
  const mods = parts.slice(0, -1).map((m) => {
    const l = m.toLowerCase();
    return l === "cmd" || l === "meta" || l === "control" || l === "mod" ? "Ctrl" : l === "option" ? "Alt" : m[0].toUpperCase() + m.slice(1).toLowerCase();
  });
  const key = parts[parts.length - 1] ?? "";
  mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...new Set(mods), key.length === 1 ? key.toUpperCase() : key].join("+");
}

export { isMac } from "./platform";
import { isMac } from "./platform";

/** Display form; on macOS shows ⌘ ⇧ ⌥. */
export function formatCombo(combo: string): string[] {
  const parts = normalizeCombo(combo).split("+");
  if (!isMac) return parts;
  return parts.map((p) => (p === "Ctrl" ? "⌘" : p === "Shift" ? "⇧" : p === "Alt" ? "⌥" : p));
}
