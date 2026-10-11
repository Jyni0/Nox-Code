/**
 * Discord status ("Rich Presence"): what you're working on, shown on your
 * Discord profile — the file, the project, the branch, errors, time spent.
 * Talks to the Discord app on this computer; nothing goes through a server.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { basename } from "@/lib/path";
import { languageName } from "@/editor/languages";
import { activeTabInfo, useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useCursor } from "@/stores/cursor";
import { useSettings } from "@/stores/settings";
import { useProblems } from "@/editor/intel/problems";
import { extSettings, isExtEnabled } from "@/extensions/registry";

export const DISCORD_EXT = "discord-presence";

export type DiscordStatus = "off" | "needs-id" | "connecting" | "connected" | "error";
export const useDiscord = create<{ status: DiscordStatus; message: string }>(() => ({ status: "off", message: "" }));

export interface PresenceInput {
  file: string | null;
  langId: string | null;
  workspace: string | null;
  branch: string | null;
  line: number;
  col: number;
  lines: number;
  errors: number;
  warnings: number;
  idle: boolean;
}

export interface PresenceOptions {
  details: string;
  state: string;
  showNames: boolean;
  elapsed: "session" | "file" | "none";
  largeImage: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Editing {file}" → "Editing App.tsx". Unknown or empty variables vanish with their separators. */
export function fill(template: string, v: Record<string, string>): string {
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
  // Separators left dangling by an empty variable: "App.tsx · " → "App.tsx".
  return out
    .replace(/(\s*[·|•-]\s*){2,}/g, " · ")
    .replace(/^\s*[·|•:-]\s*|\s*[·|•:-]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Discord wants 2–128 characters per text field. */
const field = (s: string) => (s.length < 2 ? undefined : s.length > 128 ? s.slice(0, 127) + "…" : s);

/** The Discord activity for what's open now (pure: easy to test). */
export function buildActivity(i: PresenceInput, o: PresenceOptions, started: { session: number; file: number }): Record<string, unknown> {
  const lang = i.langId ? languageName(i.langId) : "";
  const vars: Record<string, string> = {
    file: i.file ? (o.showNames ? i.file : `a ${lang || "text"} file`) : "",
    lang,
    workspace: i.workspace ? (o.showNames ? i.workspace : "a project") : "",
    branch: i.branch && o.showNames ? i.branch : "",
    line: i.file ? String(i.line) : "",
    col: i.file ? String(i.col) : "",
    lines: i.file ? plural(i.lines, "line") : "",
    errors: i.errors ? plural(i.errors, "error") : "",
    warnings: i.warnings ? plural(i.warnings, "warning") : "",
    problems: i.errors || i.warnings ? [i.errors && plural(i.errors, "error"), i.warnings && plural(i.warnings, "warning")].filter(Boolean).join(", ") : "no problems",
  };
  const details = i.idle ? "Idle" : i.file ? fill(o.details, vars) : i.workspace ? "Browsing files" : "Starting up";
  const state = fill(o.state, vars);
  const activity: Record<string, unknown> = { type: 0 };
  if (field(details)) activity.details = field(details);
  if (field(state)) activity.state = field(state);
  const start = o.elapsed === "session" ? started.session : o.elapsed === "file" ? started.file : 0;
  if (start) activity.timestamps = { start };
  const image = o.largeImage.trim();
  if (image) activity.assets = { large_image: image, large_text: field(i.file && lang ? `Editing ${lang}` : "Nox Code") };
  return activity;
}

/* ---------------- the live service ---------------- */

const MIN_GAP = 4000; // Discord allows 5 updates per 20 seconds.
const RETRY = 20_000;

let started = { session: Date.now(), file: Date.now() };
let lastFile: string | null = null;
let lastActivity = Date.now();
let lastKey = "";
let lastSent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let connected = false;

function options(): PresenceOptions & { clientId: string; idleMinutes: number } {
  const s = extSettings(DISCORD_EXT);
  return {
    clientId: String(s.clientId ?? "").trim(),
    details: String(s.details ?? ""),
    state: String(s.state ?? ""),
    showNames: s.showNames !== false,
    elapsed: (s.elapsed as PresenceOptions["elapsed"]) ?? "session",
    largeImage: String(s.largeImage ?? ""),
    idleMinutes: Number(s.idleMinutes ?? 5),
  };
}

function input(idleMinutes: number): PresenceInput {
  const { buffer } = activeTabInfo();
  const ws = useWorkspace.getState();
  const cur = useCursor.getState();
  const path = buffer?.path ?? null;
  const mine = useProblems.getState().problems.filter((p) => path && p.path === path);
  return {
    file: buffer ? basename(buffer.path ?? buffer.name) : null,
    langId: buffer?.langId ?? null,
    workspace: ws.root ? basename(ws.root) : null,
    branch: ws.git?.branch ?? null,
    line: cur.line,
    col: cur.col,
    lines: cur.lines,
    errors: mine.filter((p) => p.severity === "error").length,
    warnings: mine.filter((p) => p.severity === "warning").length,
    idle: idleMinutes > 0 && Date.now() - lastActivity > idleMinutes * 60_000,
  };
}

function schedule(delay = 1000) {
  clearTimeout(timer);
  timer = setTimeout(() => void push(), delay);
}

async function push() {
  if (!isExtEnabled(DISCORD_EXT)) {
    if (connected) await backend().discordClose().catch(() => {});
    connected = false;
    lastKey = "";
    useDiscord.setState({ status: "off", message: "" });
    return;
  }
  const o = options();
  if (!o.clientId) {
    useDiscord.setState({ status: "needs-id", message: "Add your Discord Application ID in the extension's settings" });
    return;
  }
  const now = input(o.idleMinutes);
  if (now.file !== lastFile) {
    lastFile = now.file;
    started.file = Date.now();
  }
  const activity = buildActivity(now, o, started);
  const key = o.clientId + JSON.stringify(activity);
  if (key === lastKey && connected) return;
  const wait = lastSent + MIN_GAP - Date.now();
  if (wait > 0) return schedule(wait);
  lastSent = Date.now();
  if (!connected) useDiscord.setState({ status: "connecting", message: "" });
  try {
    await backend().discordSetActivity(o.clientId, activity);
    connected = true;
    lastKey = key;
    useDiscord.setState({ status: "connected", message: "" });
  } catch (e) {
    connected = false;
    lastKey = "";
    useDiscord.setState({ status: "error", message: String(e).replace(/^Error:\s*/, "") });
    // Discord not running yet, or just closed: try again later.
    schedule(RETRY);
  }
}

let startedService = false;

/** Starts following the editor; cheap and quiet while the extension is off. */
export function startDiscordPresence() {
  if (startedService || typeof window === "undefined" || backend().kind !== "tauri") return;
  startedService = true;
  started = { session: Date.now(), file: Date.now() };
  const kick = () => schedule();
  useEditor.subscribe((s, p) => (s.activePaneId !== p.activePaneId || s.panes !== p.panes || s.buffers !== p.buffers) && kick());
  useWorkspace.subscribe((s, p) => {
    if (s.root !== p.root) started.session = Date.now();
    if (s.root !== p.root || s.git?.branch !== p.git?.branch) kick();
  });
  useCursor.subscribe((s, p) => (s.line !== p.line || s.lines !== p.lines) && schedule(3000));
  useProblems.subscribe((s, p) => s.version !== p.version && kick());
  useSettings.subscribe((s, p) => {
    if (s.extEnabled !== p.extEnabled || s.extSettings !== p.extSettings) {
      lastKey = "";
      kick();
    }
  });
  // Idle tracking: any input counts as activity; coming back from idle updates at once.
  const active = () => {
    const wasIdle = Date.now() - lastActivity > 60_000;
    lastActivity = Date.now();
    if (wasIdle) kick();
  };
  for (const ev of ["keydown", "mousedown", "wheel", "focus"]) window.addEventListener(ev, active, { passive: true });
  setInterval(kick, 60_000);
  kick();
}

/** Re-tries now (the status bar item / settings). */
export function reconnectDiscord() {
  lastKey = "";
  lastSent = 0;
  connected = false;
  schedule(0);
}
