import { FilePlus2, FolderOpen, History, Keyboard, Palette, Puzzle, Shapes, SquareTerminal } from "lucide-react";
import { runCommand, keysFor } from "@/core/commands";
import { useSettings, allThemes } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { basename } from "@/lib/path";
import { themeSwatch } from "@/themes/apply";
import { Kbd, cx } from "@/components/ui";
import { NoxMark } from "@/components/layout/Logo";
import { switchFolder } from "@/app/commands";

function Action({ icon, label, command, onClick }: { icon: React.ReactNode; label: string; command?: string; onClick?: () => void }) {
  const key = command ? keysFor(command)[0] : undefined;
  return (
    <button
      className="group flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
      onClick={onClick ?? (() => command && void runCommand(command))}
    >
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {key && <Kbd combo={key} className="opacity-60 group-hover:opacity-100" />}
    </button>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["workbench.commandPalette", "All commands"],
  ["workbench.quickOpen", "Go to file"],
  ["view.search", "Search in files"],
  ["terminal.toggle", "Terminal"],
  ["editor.split", "Split editor"],
  ["view.zen", "Zen mode"],
];

export function Welcome() {
  const recents = useSettings((s) => s.recentProjects);
  const themeId = useSettings((s) => s.themeId);
  const customThemes = useSettings((s) => s.customThemes);
  const themes = allThemes({ customThemes }).slice(0, 10);

  return (
    <div className="no-native-scrollbar h-full overflow-y-auto" data-testid="welcome">
      <div className="mx-auto flex max-w-[880px] flex-col gap-10 px-10 py-14">
        <div className="flex items-center gap-5">
          <div className="relative">
            <NoxMark size={68} />
            <div className="pointer-events-none absolute -inset-4 overflow-hidden rounded-full">
              <div className="welcome-streak absolute inset-y-1/2 left-0 h-px w-1/2 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />
            </div>
          </div>
          <div>
            <h1 className="text-[34px] font-semibold tracking-tight text-[var(--text-main)]">Nox Code</h1>
            <p className="text-[14px] text-[var(--text-dim)]">A code editor for the night shift. Quiet, fast, yours.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <section className="flex flex-col gap-1">
            <h2 className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">Start</h2>
            <Action icon={<FilePlus2 size={16} />} label="New File" command="file.newUntitled" />
            <Action icon={<FolderOpen size={16} />} label="Open Folder…" command="file.openFolder" />
            <Action icon={<History size={16} />} label="Open Recent…" command="file.openRecent" />
            <Action icon={<SquareTerminal size={16} />} label="New Terminal" command="terminal.new" />
            {recents.length > 0 && (
              <>
                <h2 className="mb-1 mt-5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">Recent</h2>
                {recents.slice(0, 5).map((p) => (
                  <button key={p} className="flex h-8 items-center gap-2 rounded-xl px-2.5 text-left text-[13px] hover:bg-[var(--hover-bg)]" onClick={() => void switchFolder(p)} title={p}>
                    <span className="text-[var(--accent)]">{basename(p)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-dim)]">{p}</span>
                  </button>
                ))}
              </>
            )}
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">Customize</h2>
            <Action icon={<Palette size={16} />} label="Color Theme" command="settings.theme" />
            <Action icon={<Shapes size={16} />} label="File Icon Theme" command="settings.iconTheme" />
            <Action icon={<Puzzle size={16} />} label="Extensions" command="view.extensions" />
            <Action icon={<Keyboard size={16} />} label="Keyboard Shortcuts" command="settings.keybindings" />
            <div className="mt-3 flex flex-wrap gap-2 px-2.5">
              {themes.map((t) => (
                <button
                  key={t.id}
                  title={t.name}
                  onClick={() => useSettings.getState().patch({ themeId: t.id, followSystem: false })}
                  className={cx(
                    "flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-110",
                    themeId === t.id && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-editor)]",
                  )}
                  style={{ background: t.ui["bg-editor"], boxShadow: "inset 0 0 0 1px var(--border)" }}
                >
                  <span className="flex gap-[2px]">
                    {themeSwatch(t).slice(1, 4).map((c, i) => (
                      <span key={i} className="h-2 w-2 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                </button>
              ))}
              <button
                className="flex h-9 items-center rounded-xl bg-[var(--bg-input)] px-3 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"
                onClick={() => useUi.getState().openSettings("themes")}
              >
                Theme Studio
              </button>
            </div>
          </section>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="px-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">Shortcuts</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 px-2.5 md:grid-cols-3">
            {SHORTCUTS.map(([cmd, label]) => {
              const k = keysFor(cmd)[0];
              return (
                <div key={cmd} className="flex h-8 items-center justify-between gap-3 text-[12.5px] text-[var(--text-muted)]">
                  <span>{label}</span>
                  {k && <Kbd combo={k} />}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
