/**
 * Discord status ("Rich Presence"): what you're working on, shown on your
 * Discord profile. Each piece — file, project, repository, branch, problems —
 * can be switched off. Talks to the Discord app on this computer; nothing
 * goes through a server.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { basename, join } from "@/lib/path";
import { languageName } from "@/editor/languages";
import { activeTabInfo, useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useSettings } from "@/stores/settings";
import { useProblems } from "@/editor/intel/problems";
import { extSettings, isExtEnabled } from "@/extensions/registry";

export const DISCORD_EXT = "discord-presence";
/** Nox Code's Discord application ("Playing Nox Code"). */
export const DISCORD_APP_ID = "1558888709284176045";
const IDLE_MINUTES = 5;

export type DiscordStatus = "off" | "connecting" | "connected" | "error";
export const useDiscord = create<{ status: DiscordStatus; message: string }>(() => ({ status: "off", message: "" }));

export interface Repo {
  /** "owner/name". */
  name: string;
  /** Web page, when the remote is on a web host. */
  url: string | null;
}

export interface PresenceInput {
  file: string | null;
  langId: string | null;
  project: string | null;
  repo: Repo | null;
  branch: string | null;
  errors: number;
  warnings: number;
  idle: boolean;
}

export interface PresenceOptions {
  showFile: boolean;
  showProject: boolean;
  showRepo: boolean;
  showBranch: boolean;
  showProblems: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Discord wants 2–128 characters per text field. */
const field = (s: string) => (s.length < 2 ? undefined : s.length > 128 ? s.slice(0, 127) + "…" : s);

/**
 * `git@github.com:me/app.git`, `https://github.com/me/app`, `ssh://git@host/me/app.git`
 * → { name: "me/app", url: "https://github.com/me/app" }.
 */
export function parseRemote(remote: string): Repo | null {
  const r = remote.trim();
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(r);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = m[2].replace(/^\/+/, "");
  if (!path.includes("/")) return null;
  const name = path.split("/").slice(-2).join("/");
  // Local paths ("C:/repos/x", "/srv/x") have no web page.
  const local = /^[a-z]$/i.test(host) || r.startsWith("/") || r.startsWith("file:");
  return { name, url: local ? null : `https://${host}/${path}` };
}

/** The `origin` remote (or the first one) from a .git/config. */
export function remoteFromConfig(config: string): string | null {
  let current: string | null = null;
  const remotes = new Map<string, string>();
  for (const line of config.split(/\r?\n/)) {
    const sec = /^\s*\[remote\s+"([^"]+)"\]/.exec(line);
    if (sec) current = sec[1];
    else if (/^\s*\[/.test(line)) current = null;
    else if (current) {
      const url = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
      if (url && !remotes.has(current)) remotes.set(current, url[1]);
    }
  }
  return remotes.get("origin") ?? remotes.values().next().value ?? null;
}

/** The Discord activity for what's open now (pure: easy to test). */
export function buildActivity(i: PresenceInput, o: PresenceOptions, started: number): Record<string, unknown> {
  const lang = i.langId ? languageName(i.langId) : "";
  const details = i.idle ? "Idle" : i.file ? (o.showFile ? `Editing ${i.file}` : lang ? `Writing ${lang}` : "Writing code") : i.project ? "Browsing files" : "Starting up";
  const parts: string[] = [];
  if (o.showProject && i.project) parts.push(i.project);
  if (o.showRepo && i.repo && i.repo.name !== i.project) parts.push(i.repo.name);
  if (o.showBranch && i.branch) parts.push(`⎇ ${i.branch}`);
  if (o.showProblems && i.file && !i.idle) {
    parts.push(i.errors || i.warnings ? [i.errors && plural(i.errors, "error"), i.warnings && plural(i.warnings, "warning")].filter(Boolean).join(", ") : "no problems");
  }
  const activity: Record<string, unknown> = { type: 0, timestamps: { start: started } };
  if (field(details)) activity.details = field(details);
  const state = field(parts.join(" · "));
  if (state) activity.state = state;
  activity.assets = { large_image: "logo", large_text: i.file && lang && o.showFile ? `Editing ${lang}` : "Nox Code" };
  if (o.showRepo && i.repo?.url) activity.buttons = [{ label: "View repository", url: i.repo.url }];
  return activity;
}

/* ---------------- the live service ---------------- */

const MIN_GAP = 4000; // Discord allows 5 updates per 20 seconds.
const RETRY = 20_000;

let started = Date.now();
let lastActivity = Date.now();
let lastKey = "";
let lastSent = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let connected = false;
let repo: { root: string; repo: Repo | null } | null = null;

function options(): PresenceOptions {
  const s = extSettings(DISCORD_EXT);
  return {
    showFile: s.showFile !== false,
    showProject: s.showProject !== false,
    showRepo: s.showRepo === true,
    showBranch: s.showBranch !== false,
    showProblems: s.showProblems !== false,
  };
}

/** The project's repository, read from .git/config once per folder. */
async function loadRepo(root: string) {
  let found: Repo | null = null;
  try {
    let gitDir = join(root, ".git");
    // A worktree or submodule: ".git" is a file pointing at the real folder.
    const file = await backend()
      .readFile(gitDir)
      .then((f) => f.content)
      .catch(() => null);
    const pointer = file && /^gitdir:\s*(.+)$/m.exec(file);
    if (pointer) {
      const target = pointer[1].trim();
      gitDir = /^(?:[A-Za-z]:)?[\\/]/.test(target) ? target : join(root, target);
    }
    const config = await backend()
      .readFile(join(gitDir, "config"))
      .catch(() => backend().readFile(join(gitDir, "..", "..", "config")));
    const remote = remoteFromConfig(config.content);
    found = remote ? parseRemote(remote) : null;
  } catch {
    found = null;
  }
  if (useWorkspace.getState().root === root) {
    repo = { root, repo: found };
    schedule();
  }
}

function input(): PresenceInput {
  const { buffer } = activeTabInfo();
  const ws = useWorkspace.getState();
  const path = buffer?.path ?? null;
  const mine = useProblems.getState().problems.filter((p) => path && p.path === path);
  if (ws.root && repo?.root !== ws.root) {
    repo = { root: ws.root, repo: null };
    void loadRepo(ws.root);
  }
  return {
    file: buffer ? basename(buffer.path ?? buffer.name) : null,
    langId: buffer?.langId ?? null,
    project: ws.root ? basename(ws.root) : null,
    repo: ws.root ? (repo?.repo ?? null) : null,
    branch: ws.git?.branch ?? null,
    errors: mine.filter((p) => p.severity === "error").length,
    warnings: mine.filter((p) => p.severity === "warning").length,
    idle: Date.now() - lastActivity > IDLE_MINUTES * 60_000,
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
  const activity = buildActivity(input(), options(), started);
  const key = JSON.stringify(activity);
  if (key === lastKey && connected) return;
  const wait = lastSent + MIN_GAP - Date.now();
  if (wait > 0) return schedule(wait);
  lastSent = Date.now();
  if (!connected) useDiscord.setState({ status: "connecting", message: "" });
  try {
    await backend().discordSetActivity(DISCORD_APP_ID, activity);
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
  started = Date.now();
  const kick = () => schedule();
  useEditor.subscribe((s, p) => (s.activePaneId !== p.activePaneId || s.panes !== p.panes || s.buffers !== p.buffers) && kick());
  useWorkspace.subscribe((s, p) => {
    if (s.root !== p.root) {
      started = Date.now();
      repo = null;
    }
    if (s.root !== p.root || s.git?.branch !== p.git?.branch) kick();
  });
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

/** Re-tries now (the status bar item). */
export function reconnectDiscord() {
  lastKey = "";
  lastSent = 0;
  connected = false;
  schedule(0);
}
