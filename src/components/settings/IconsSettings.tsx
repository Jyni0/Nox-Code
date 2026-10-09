import { useEffect, useMemo, useState } from "react";
import { Check, FolderOpen, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { DEFAULT_ICON_THEME, ICON_THEMES, findIconTheme, resolveIcon, type IconRule, type IconSpec } from "@/icons/iconThemes";
import { discoverInstalled, readExtension, unloadVsTheme, useVsIcons, type VsIconThemeRef } from "@/icons/vscodeThemes";
import { backend } from "@/lib/backend";
import { IconView } from "@/icons/FileIcon";
import { ICON_LIBRARY, ICON_NAMES } from "@/icons/library";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/ui";
import { Button, Input, Segmented, SectionHeading, SettingRow, SettingsCard, Sep, cx } from "@/components/ui";
import { ColorField } from "./shared";

const SAMPLE: Array<[string, boolean, boolean]> = [
  ["src", true, true],
  ["components", true, false],
  ["node_modules", true, false],
  ["main.ts", false, false],
  ["App.tsx", false, false],
  ["theme.css", false, false],
  ["package.json", false, false],
  ["README.md", false, false],
  ["lib.rs", false, false],
  ["build.py", false, false],
  ["logo.svg", false, false],
  [".env", false, false],
];

type IconKind = IconSpec["type"];

const emptyDraft = (): { id: string | null; match: IconRule["match"]; pattern: string; kind: IconKind; glyph: string; color: string; text: string; bg: string; fg: string; emoji: string; svg: string } => ({
  id: null,
  match: "ext",
  pattern: "",
  kind: "glyph",
  glyph: "Rocket",
  color: "#7ee7ff",
  text: "AB",
  bg: "#5b8cff",
  fg: "#ffffff",
  emoji: "🚀",
  svg: "",
});

function specOf(d: ReturnType<typeof emptyDraft>): IconSpec {
  switch (d.kind) {
    case "badge":
      return { type: "badge", text: d.text.slice(0, 3) || "?", bg: d.bg, fg: d.fg };
    case "emoji":
      return { type: "emoji", char: [...d.emoji][0] ?? "•" };
    case "svg":
      return { type: "svg", markup: d.svg, color: d.color };
    case "dot":
      return { type: "dot", color: d.color };
    case "none":
      return { type: "none" };
    default:
      return { type: "glyph", icon: d.glyph, color: d.color };
  }
}

function draftOf(r: IconRule): ReturnType<typeof emptyDraft> {
  const d = { ...emptyDraft(), id: r.id, match: r.match, pattern: r.pattern, kind: r.icon.type };
  const i = r.icon;
  if (i.type === "glyph") Object.assign(d, { glyph: i.icon, color: i.color });
  if (i.type === "badge") Object.assign(d, { text: i.text, bg: i.bg, fg: i.fg });
  if (i.type === "emoji") d.emoji = i.char;
  if (i.type === "svg") Object.assign(d, { svg: i.markup, color: i.color ?? d.color });
  if (i.type === "dot") d.color = i.color;
  return d;
}

function GlyphPicker({ value, color, onPick }: { value: string; color: string; onPick: (name: string) => void }) {
  const [q, setQ] = useState("");
  const names = useMemo(() => ICON_NAMES.filter((n) => n.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--bg-input)] px-2">
        <Search size={12} className="text-[var(--text-dim)]" />
        <input aria-label="Search icons" className="h-full flex-1 bg-transparent text-[12px] outline-none" placeholder={`Search ${ICON_NAMES.length} icons`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="no-native-scrollbar grid max-h-[156px] grid-cols-[repeat(auto-fill,minmax(30px,1fr))] gap-1 overflow-y-auto">
        {names.map((n) => {
          const Icon = ICON_LIBRARY[n];
          return (
            <button
              key={n}
              title={n}
              onClick={() => onPick(n)}
              className={cx("flex h-[30px] items-center justify-center rounded-lg transition-colors hover:bg-[var(--hover-bg)]", n === value && "bg-[var(--bg-elevated)] ring-1 ring-[var(--accent)]")}
            >
              <Icon size={16} style={{ color: n === value ? color : undefined }} className="text-[var(--text-muted)]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function addVsThemes(list: VsIconThemeRef[], use?: string) {
  const s = useSettings.getState();
  const kept = s.vscodeIconThemes.filter((r) => !list.some((x) => x.id === r.id));
  for (const r of list) unloadVsTheme(r.id);
  s.patch({ vscodeIconThemes: [...kept, ...list], ...(use ? { iconTheme: use } : {}) });
}

function removeVsTheme(id: string) {
  const s = useSettings.getState();
  unloadVsTheme(id);
  s.patch({ vscodeIconThemes: s.vscodeIconThemes.filter((r) => r.id !== id), ...(s.iconTheme === id ? { iconTheme: DEFAULT_ICON_THEME } : {}) });
}

/** Icon themes from VS Code (and friends) on this machine, or from a folder. */
function VsCodeThemes() {
  const added = useSettings((s) => s.vscodeIconThemes);
  const [found, setFound] = useState<VsIconThemeRef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const desktop = backend().kind === "tauri";

  const scan = async () => {
    setBusy(true);
    try {
      setFound(await discoverInstalled());
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (desktop) void scan();
  }, [desktop]);

  const fromFolder = async () => {
    const dir = await backend().pickFolder();
    if (!dir) return;
    const list = await readExtension(dir, "Folder");
    if (!list.length) return toast("No icon theme in this folder", "error", "Pick a VS Code extension folder — one whose package.json lists contributes.iconThemes.");
    addVsThemes(list, list[0].id);
    toast(`Added ${list.map((r) => r.label).join(", ")}`, "success");
  };

  const notAdded = (found ?? []).filter((r) => !added.some((a) => a.id === r.id && a.dir === r.dir));
  return (
    <SettingsCard>
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--text-main)]">VS Code icon themes</span>
          <span className="text-[12px] text-[var(--text-dim)]">
            Use an icon theme you have installed in VS Code, Cursor, VSCodium or Windsurf — Flow Icons, Material Icon Theme… Icons are read from the extension on this machine, never copied into Nox.
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void scan()} disabled={!desktop || busy} title="Look for installed icon themes again">
          <RefreshCw size={13} className={cx(busy && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => void fromFolder()} disabled={!desktop}>
          <FolderOpen size={13} /> Load from folder…
        </Button>
      </div>
      {!desktop ? (
        <div className="text-[12px] text-[var(--text-dim)]">Available in the desktop app.</div>
      ) : found === null ? (
        <div className="text-[12px] text-[var(--text-dim)]">Looking for installed icon themes…</div>
      ) : notAdded.length === 0 ? (
        <div className="text-[12px] text-[var(--text-dim)]">{found.length ? "Every installed icon theme is added above." : "No icon themes found in VS Code, Cursor, VSCodium or Windsurf."}</div>
      ) : (
        <div className="flex flex-col">
          {notAdded.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-t border-[var(--border-soft)] py-2 first:border-t-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-[var(--text-main)]">{r.label}</span>
                <span className="truncate text-[11px] text-[var(--text-dim)]">
                  {r.source} · {r.extension} {r.version}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => addVsThemes([r])}>
                <Plus size={13} /> Add
              </Button>
              <Button size="sm" onClick={() => addVsThemes([r], r.id)}>
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}

export function IconsSettings() {
  const iconTheme = useSettings((s) => s.iconTheme);
  const vsThemes = useSettings((s) => s.vscodeIconThemes);
  useVsIcons((s) => s.version);
  const rules = useSettings((s) => s.iconRules);
  const iconWeight = useSettings((s) => s.iconWeight);
  const [draft, setDraft] = useState(emptyDraft);
  const set = (p: Partial<ReturnType<typeof emptyDraft>>) => setDraft((d) => ({ ...d, ...p }));

  const save = () => {
    const pattern = draft.pattern.trim().replace(/^\*?\./, "");
    if (!pattern) {
      toast("Enter an extension, file name or folder name", "warning");
      return;
    }
    if (draft.kind === "svg" && !/<svg[\s>]/i.test(draft.svg)) {
      toast("Upload an SVG file first", "warning");
      return;
    }
    const rule: IconRule = { id: draft.id ?? crypto.randomUUID(), match: draft.match, pattern, icon: specOf(draft) };
    if (draft.id) useSettings.getState().updateIconRule(draft.id, rule);
    else useSettings.getState().addIconRule(rule);
    setDraft(emptyDraft());
    toast(draft.id ? "Icon rule updated" : "Icon rule added", "success");
  };

  const uploadSvg = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 64 * 1024) return toast("SVG is too large (64 KB max)", "error");
      set({ svg: await f.text(), kind: "svg" });
    };
    input.click();
  };

  const patternHint = draft.match === "ext" ? "ts, test.ts, d.ts" : draft.match === "name" ? "Dockerfile, vite.config.ts" : "api, migrations";

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading>File icon theme</SectionHeading>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[...ICON_THEMES, ...vsThemes.map((r) => findIconTheme(r.id))].map((t) => (
          <button
            key={t.id}
            data-testid="icon-theme-card"
            onClick={() => useSettings.getState().set("iconTheme", t.id)}
            className={cx(
              "flex flex-col gap-2 rounded-2xl border p-3 text-left transition-colors",
              iconTheme === t.id ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]" : "border-[var(--border-soft)] bg-[var(--bg-surface)] hover:border-[var(--border)]",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-[13px] font-medium text-[var(--text-main)]">{t.name}</span>
              {iconTheme === t.id && <Check size={14} className="text-[var(--accent)]" />}
              {t.id.startsWith("vsc:") && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Remove this theme"
                  aria-label={`Remove ${t.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeVsTheme(t.id);
                  }}
                  className="rounded p-0.5 text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                >
                  <Trash2 size={12} />
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {SAMPLE.slice(0, 8).map(([name, dir, open]) => (
                <span key={name} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
                  <IconView spec={resolveIcon(name, dir, open, t.id, rules)} size={14} />
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
            <span className="text-[11px] leading-snug text-[var(--text-dim)]">{t.description}</span>
          </button>
        ))}
      </div>

      <VsCodeThemes />

      <SettingsCard>
        <SettingRow title="Interface icon weight" hint="Stroke width of every icon in the app (product icons).">
          <Segmented
            size="sm"
            options={[
              { value: "thin", label: "Thin" },
              { value: "regular", label: "Regular" },
              { value: "bold", label: "Bold" },
            ]}
            value={iconWeight}
            onChange={(v) => useSettings.getState().set("iconWeight", v as typeof iconWeight)}
          />
        </SettingRow>
      </SettingsCard>

      <SectionHeading>Custom icons</SectionHeading>
      <SettingsCard>
        <div className="text-[12px] text-[var(--text-dim)]">Give any extension, file or folder its own icon — glyph, colored badge, emoji or your own SVG. Custom rules win over the icon theme.</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                options={[
                  { value: "ext", label: "Extension" },
                  { value: "name", label: "File name" },
                  { value: "folder", label: "Folder" },
                ]}
                value={draft.match}
                onChange={(v) => set({ match: v as IconRule["match"] })}
              />
              <Input size="sm" aria-label="Pattern" className="w-52 font-mono" placeholder={patternHint} value={draft.pattern} onChange={(e) => set({ pattern: e.target.value })} />
            </div>
            <Segmented
              size="sm"
              options={[
                { value: "glyph", label: "Glyph" },
                { value: "badge", label: "Badge" },
                { value: "emoji", label: "Emoji" },
                { value: "svg", label: "SVG" },
                { value: "dot", label: "Dot" },
              ]}
              value={draft.kind === "none" ? "glyph" : draft.kind}
              onChange={(v) => set({ kind: v as IconKind })}
            />
            {draft.kind === "glyph" && (
              <>
                <ColorField label="Icon color" value={draft.color} onChange={(c) => set({ color: c })} />
                <GlyphPicker value={draft.glyph} color={draft.color} onPick={(g) => set({ glyph: g })} />
              </>
            )}
            {draft.kind === "badge" && (
              <div className="flex flex-wrap items-center gap-3">
                <Input size="sm" aria-label="Badge text" className="w-20 font-mono" maxLength={3} value={draft.text} onChange={(e) => set({ text: e.target.value })} />
                <ColorField label="Badge background" value={draft.bg} onChange={(c) => set({ bg: c })} />
                <ColorField label="Badge text color" value={draft.fg} onChange={(c) => set({ fg: c })} />
              </div>
            )}
            {draft.kind === "emoji" && <Input size="sm" aria-label="Emoji" className="w-24 text-[16px]" value={draft.emoji} onChange={(e) => set({ emoji: e.target.value })} />}
            {draft.kind === "svg" && (
              <div className="flex items-center gap-3">
                <Button size="sm" icon={<Upload size={13} />} onClick={uploadSvg}>
                  {draft.svg ? "Replace SVG…" : "Upload SVG…"}
                </Button>
                <ColorField label="currentColor" value={draft.color} onChange={(c) => set({ color: c })} />
              </div>
            )}
            {draft.kind === "dot" && <ColorField label="Dot color" value={draft.color} onChange={(c) => set({ color: c })} />}
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-[var(--bg-app)] p-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--text-dim)]">Preview</div>
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-main)]">
              <IconView spec={specOf(draft)} size={16} />
              <span className="truncate font-mono">
                {draft.match === "ext" ? `example.${draft.pattern.replace(/^\*?\./, "") || "ext"}` : draft.pattern || (draft.match === "folder" ? "folder" : "file")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <IconView spec={specOf(draft)} size={28} />
              <IconView spec={specOf(draft)} size={20} />
              <IconView spec={specOf(draft)} size={13} />
            </div>
            <div className="mt-auto flex gap-2">
              <Button size="sm" variant="primary" icon={draft.id ? <Check size={13} /> : <Plus size={13} />} onClick={save}>
                {draft.id ? "Update rule" : "Add rule"}
              </Button>
              {draft.id && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(emptyDraft())}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
        {rules.length > 0 && (
          <>
            <Sep />
            <div className="flex flex-col gap-1" data-testid="icon-rules">
              {rules.map((r) => (
                <div key={r.id} className="group flex h-8 items-center gap-2.5 rounded-lg px-2 hover:bg-[var(--hover-bg)]">
                  <IconView spec={r.icon} size={16} />
                  <span className="flex-1 font-mono text-[12px] text-[var(--text-main)]">{r.match === "ext" ? `*.${r.pattern}` : r.match === "folder" ? `${r.pattern}/` : r.pattern}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">{r.icon.type}</span>
                  <button title="Edit" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] opacity-0 hover:bg-[var(--row-solid-hover)] hover:text-[var(--text-main)] group-hover:opacity-100" onClick={() => setDraft(draftOf(r))}>
                    <Pencil size={12} />
                  </button>
                  <button title="Remove" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] opacity-0 hover:bg-[var(--row-solid-hover)] hover:text-[var(--diff-del)] group-hover:opacity-100" onClick={() => useSettings.getState().removeIconRule(r.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
