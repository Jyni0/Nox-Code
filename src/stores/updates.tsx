/**
 * "Is there a newer Nox Code?" — answered from the main branch on GitHub,
 * no release needed. The app knows the commit it was built from; GitHub's
 * compare API says how many commits main is ahead of it. Builds made outside
 * git fall back to comparing package.json versions.
 */
import { create } from "zustand";
import { backend } from "@/lib/backend";
import { join } from "@/lib/path";
import { isMac } from "@/lib/keys";
import { useSettings } from "./settings";
import { useTerminal } from "./terminal";
import { useUi, errorMessage, toast } from "./ui";

export const APP_VERSION = __APP_VERSION__;
export const BUILD_SHA = __BUILD_SHA__;
export const REPO = __REPO__;
const BRANCH = __BUILD_BRANCH__ && __BUILD_BRANCH__ !== "HEAD" ? __BUILD_BRANCH__ : "main";

export interface RemoteCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface UpdateInfo {
  /** Version in package.json on the branch. */
  version: string | null;
  /** Head commit of the branch. */
  sha: string;
  /** Commits the branch is ahead of this build (newest first). */
  commits: RemoteCommit[];
  aheadBy: number;
}

type Status = "idle" | "checking" | "current" | "available" | "error";

interface UpdatesState {
  status: Status;
  info: UpdateInfo | null;
  error: string | null;
  checkedAt: number | null;
  /** The source checkout the app was built from, when it is on this machine. */
  checkout: string | null;

  check(manual?: boolean): Promise<void>;
  /** Pulls and rebuilds in the integrated terminal. */
  updateFromSource(): Promise<void>;
}

/** -1 / 0 / 1 for dotted versions ("1.10.0" > "1.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

interface GhCommit {
  sha: string;
  commit: { message: string; author?: { name?: string; date?: string }; committer?: { date?: string } };
}

const toCommit = (c: GhCommit): RemoteCommit => ({
  sha: c.sha,
  message: c.commit.message,
  date: c.commit.author?.date ?? c.commit.committer?.date ?? "",
  author: c.commit.author?.name ?? "",
});

async function remoteVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: "idle",
  info: null,
  error: null,
  checkedAt: null,
  checkout: null,

  async check(manual = false) {
    if (!REPO) {
      if (manual) toast("Update check is not available", "warning", "This build does not know its GitHub repository.");
      return;
    }
    if (get().status === "checking") return;
    set({ status: "checking", error: null });
    void backend()
      .sourceCheckout()
      .then((checkout) => set({ checkout }))
      .catch(() => {});
    try {
      const version = await remoteVersion();
      let info: UpdateInfo | null = null;
      if (BUILD_SHA) {
        const r = await getJson<{ status: string; ahead_by: number; commits: GhCommit[] }>(`https://api.github.com/repos/${REPO}/compare/${BUILD_SHA}...${BRANCH}`);
        if (r.ok) {
          const commits = r.data.commits.map(toCommit).reverse();
          const head = commits[0]?.sha ?? BUILD_SHA;
          info = { version, sha: head, commits, aheadBy: r.data.status === "ahead" || r.data.status === "diverged" ? r.data.ahead_by : 0 };
        } else if (r.status === 403 || r.status === 429) {
          throw new Error("GitHub rate limit reached — try again later");
        }
      }
      if (!info) {
        // Unknown build commit (not pushed, or built from a zip): versions decide.
        const head = await getJson<GhCommit>(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`).catch(() => null);
        const newer = !!version && compareVersions(version, APP_VERSION) > 0;
        info = { version, sha: head && head.ok ? head.data.sha : "", commits: newer && head && head.ok ? [toCommit(head.data)] : [], aheadBy: newer ? 1 : 0 };
      }
      const available = info.aheadBy > 0;
      set({ status: available ? "available" : "current", info, checkedAt: Date.now() });
      if (manual) {
        if (available) openUpdateDialog();
        else toast("Nox Code is up to date", "success", `Version ${APP_VERSION}${BUILD_SHA ? ` · ${BUILD_SHA.slice(0, 7)}` : ""}`);
      }
    } catch (e) {
      set({ status: "error", error: errorMessage(e), checkedAt: Date.now() });
      if (manual) toast("Could not check for updates", "error", errorMessage(e));
    }
  },

  async updateFromSource() {
    const dir = get().checkout;
    if (!dir) return;
    const shells = await useTerminal.getState().loadShells();
    const win = !isMac && navigator.userAgent.includes("Windows");
    // `&&` chains in cmd.exe and every POSIX shell; PowerShell 5 lacks it.
    const profile = win ? shells.find((s) => s.id === "cmd")?.id : undefined;
    const bundle = join(dir, "src-tauri", "target", "release", "bundle");
    const open = win ? `explorer "${bundle}"` : isMac ? `open "${bundle}"` : `xdg-open "${bundle}"`;
    const id = await useTerminal.getState().create(dir, profile);
    if (!id) return;
    useUi.getState().togglePanel(true);
    await useTerminal.getState().sendText(`git pull --ff-only && npm install && npm run tauri:build && ${open}\r`);
    toast("Updating from source", "info", "The new installer opens when the build finishes.");
  },
}));

export const useUpdateAvailable = () => useUpdates((s) => s.status === "available");

const firstLine = (m: string) => m.split("\n")[0];

export function openUpdateDialog() {
  const { info, checkout } = useUpdates.getState();
  if (!info) return;
  const shown = info.commits.slice(0, 12);
  void useUi
    .getState()
    .ask({
      title: info.version && compareVersions(info.version, APP_VERSION) > 0 ? `Nox Code ${info.version} is available` : "A new version of Nox Code is available",
      message: (
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px] text-[var(--text-muted)]">
            You have {APP_VERSION}
            {BUILD_SHA ? ` (${BUILD_SHA.slice(0, 7)})` : ""}. {info.aheadBy} new commit{info.aheadBy === 1 ? "" : "s"} on GitHub:
          </div>
          {shown.length > 0 && (
            <ul className="flex max-h-[220px] flex-col gap-1 overflow-auto rounded-xl bg-[var(--bg-input)] p-2 text-[12px]">
              {shown.map((c) => (
                <li key={c.sha} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[var(--accent)]">{c.sha.slice(0, 7)}</span>
                  <span className="min-w-0 truncate text-[var(--text-main)]">{firstLine(c.message)}</span>
                </li>
              ))}
              {info.commits.length > shown.length && <li className="text-[var(--text-dim)]">…and {info.commits.length - shown.length} more</li>}
            </ul>
          )}
          {checkout ? (
            <div className="text-[11.5px] text-[var(--text-dim)]">“Update now” pulls into {checkout}, rebuilds in the terminal and opens the new installer.</div>
          ) : (
            <div className="text-[11.5px] text-[var(--text-dim)]">Download the source from GitHub and build it, or pull it in your checkout.</div>
          )}
        </div>
      ),
      buttons: [
        ...(checkout ? [{ id: "source", label: "Update now", variant: "primary" as const }] : [{ id: "download", label: "Download", variant: "primary" as const }]),
        { id: "changes", label: "View changes", variant: "secondary" as const },
        { id: "later", label: "Later" },
      ],
      cancelId: "later",
    })
    .then((answer) => {
      const u = useUpdates.getState();
      if (answer === "source") void u.updateFromSource();
      if (answer === "download") void backend().openUrl(`https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`);
      if (answer === "changes") void backend().openUrl(BUILD_SHA ? `https://github.com/${REPO}/compare/${BUILD_SHA}...${BRANCH}` : `https://github.com/${REPO}/commits/${BRANCH}`);
    });
}

/** On start and every few hours, when enabled. */
export function startUpdateChecks(): () => void {
  if (!useSettings.getState().checkForUpdates || import.meta.env.MODE === "test") return () => {};
  const first = setTimeout(() => void useUpdates.getState().check(), 8000);
  const every = setInterval(() => useSettings.getState().checkForUpdates && void useUpdates.getState().check(), 6 * 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
