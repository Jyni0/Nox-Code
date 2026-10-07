import { useEffect, useMemo, useState } from "react";
import { Pencil, RotateCcw, Search, TriangleAlert, X } from "lucide-react";
import { allCommands, conflictsFor, defaultKeys, keysFor, onCommandsChanged } from "@/core/commands";
import { eventToCombo, keyState, normalizeCombo } from "@/lib/keys";
import { useSettings } from "@/stores/settings";
import { Kbd, cx } from "@/components/ui";

/** Captures the next key combo; Escape cancels, Backspace alone clears. */
function Recorder({ onDone, onCancel }: { onDone: (combo: string | null) => void; onCancel: () => void }) {
  const [combo, setCombo] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey) return onCancel();
      if (e.key === "Enter" && combo) return onDone(combo);
      if (e.key === "Backspace" && !e.ctrlKey && !e.shiftKey && !e.altKey) return onDone(null);
      const c = eventToCombo(e);
      if (c) setCombo(c);
    };
    keyState.recording = true;
    window.addEventListener("keydown", onKey, true);
    return () => {
      keyState.recording = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [combo, onDone, onCancel]);
  const conflicts = combo ? conflictsFor(combo) : [];
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex h-7 items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-muted)]">
        {combo ? <Kbd combo={combo} /> : "Press keys…"}
        <span className="text-[10.5px] text-[var(--text-dim)]">Enter ✓ · Esc ✕ · ⌫ remove</span>
      </div>
      {conflicts.length > 0 && (
        <span className="flex items-center gap-1 text-[11px] text-[var(--diff-mod)]">
          <TriangleAlert size={11} /> Also used by {conflicts[0].title}
        </span>
      )}
    </div>
  );
}

export function KeybindingsSettings() {
  const overrides = useSettings((s) => s.keybindings);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => onCommandsChanged(() => force((n) => n + 1)), []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allCommands(true)
      .filter((c) => {
        if (!q) return true;
        const keys = keysFor(c.id, overrides).join(" ").toLowerCase();
        return `${c.category ?? ""} ${c.title} ${c.id}`.toLowerCase().includes(q) || keys.includes(q);
      })
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.title.localeCompare(b.title));
  }, [query, overrides]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-9 items-center gap-2 rounded-xl border border-transparent bg-[var(--bg-input)] px-3 focus-within:border-[var(--accent)]">
        <Search size={14} className="text-[var(--text-dim)]" />
        <input
          aria-label="Search keybindings"
          className="h-full flex-1 bg-transparent text-[12.5px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)]"
          placeholder="Search commands or keys (e.g. 'ctrl+shift')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-[11px] text-[var(--text-dim)]">{rows.length} commands</span>
      </div>
      <div className="flex flex-col rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-1.5" data-testid="keybindings">
        {rows.map((c) => {
          const keys = keysFor(c.id, overrides);
          const changed = c.id in overrides;
          const defaults = defaultKeys(c);
          return (
            <div key={c.id} className="group flex min-h-9 items-center gap-3 rounded-xl px-2.5 py-1 hover:bg-[var(--hover-bg)]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-[var(--text-main)]">
                  {c.category && <span className="text-[var(--text-dim)]">{c.category}: </span>}
                  {c.title}
                </div>
                <div className="truncate font-mono text-[10.5px] text-[var(--text-dim)]">{c.id}</div>
              </div>
              {editing === c.id ? (
                <Recorder
                  onCancel={() => setEditing(null)}
                  onDone={(combo) => {
                    useSettings.getState().setKeybinding(c.id, combo ? normalizeCombo(combo) : null);
                    setEditing(null);
                  }}
                />
              ) : (
                <>
                  <div className={cx("flex items-center gap-1.5", changed && "rounded-md px-1 ring-1 ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]")}>
                    {keys.length ? keys.map((k) => <Kbd key={k} combo={k} />) : <span className="text-[11px] text-[var(--text-dim)]">—</span>}
                  </div>
                  <div className="flex w-[60px] justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                    <button title="Change keybinding" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--row-solid-hover)] hover:text-[var(--text-main)]" onClick={() => setEditing(c.id)}>
                      <Pencil size={12} />
                    </button>
                    {changed ? (
                      <button title={`Reset to ${defaults.join(", ") || "none"}`} className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--row-solid-hover)] hover:text-[var(--text-main)]" onClick={() => useSettings.getState().setKeybinding(c.id, undefined)}>
                        <RotateCcw size={12} />
                      </button>
                    ) : (
                      keys.length > 0 && (
                        <button title="Remove keybinding" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--row-solid-hover)] hover:text-[var(--diff-del)]" onClick={() => useSettings.getState().setKeybinding(c.id, null)}>
                          <X size={12} />
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
