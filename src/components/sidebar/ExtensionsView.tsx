import { useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { EXTENSIONS, EXT_CATEGORIES, extSettings, isExtEnabled, type ExtSetting, type NoxExtension } from "@/extensions/registry";
import { getCommand, keysFor } from "@/core/commands";
import { ICON_LIBRARY } from "@/icons/library";
import { useSettings } from "@/stores/settings";
import { Input, Kbd, Segmented, Switch, cx } from "@/components/ui";

export function ExtIcon({ ext, size = 34 }: { ext: NoxExtension; size?: number }) {
  const Icon = ICON_LIBRARY[ext.icon] ?? ICON_LIBRARY.Puzzle;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${ext.color} 18%, transparent)`, color: ext.color }}
    >
      <Icon size={size * 0.5} />
    </span>
  );
}

export function ExtSettingControl({ ext, def }: { ext: NoxExtension; def: ExtSetting }) {
  const value = useSettings((s) => s.extSettings[ext.id]?.[def.key] ?? def.default);
  const set = (v: unknown) => useSettings.getState().setExtSetting(ext.id, def.key, v);
  switch (def.type) {
    case "boolean":
      return <Switch on={!!value} onChange={set} ariaLabel={def.label} />;
    case "select":
      return <Segmented size="sm" options={def.options!.map((o) => ({ value: o.value, label: o.label }))} value={String(value)} onChange={set} />;
    case "number":
      return (
        <Input
          size="sm"
          type="number"
          className="w-24"
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) set(Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, n)));
          }}
        />
      );
    case "text":
      return <Input size="sm" className="w-56" value={String(value)} onChange={(e) => set(e.target.value)} />;
  }
}

export function ExtensionDetails({ ext }: { ext: NoxExtension }) {
  return (
    <div className="flex flex-col gap-2.5">
      {ext.details && (
        <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-[var(--text-muted)]">
          {ext.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {ext.settings?.map((def) => (
        <div key={def.key} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-[var(--text-main)]">{def.label}</div>
            {def.description && <div className="text-[11.5px] text-[var(--text-dim)]">{def.description}</div>}
          </div>
          <ExtSettingControl ext={ext} def={def} />
        </div>
      ))}
      {ext.commands && ext.commands.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">Commands</div>
          {ext.commands.map((id) => {
            const c = getCommand(id);
            if (!c) return null;
            const k = keysFor(id)[0];
            return (
              <div key={id} className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <span className="flex-1 truncate">{c.title}</span>
                {k && <Kbd combo={k} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExtensionCard({ ext }: { ext: NoxExtension }) {
  const [open, setOpen] = useState(false);
  const enabled = useSettings((s) => isExtEnabled(ext.id, s));
  const hasMore = !!(ext.settings?.length || ext.details?.length || ext.commands?.length);
  void extSettings;
  return (
    <div data-testid="ext-card" data-ext={ext.id} className={cx("flex flex-col rounded-2xl px-2.5 py-2 transition-colors", open ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--hover-bg)]")}>
      <div className="flex cursor-pointer items-start gap-2.5" onClick={() => hasMore && setOpen(!open)}>
        <ExtIcon ext={ext} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cx("truncate text-[13px] font-medium", enabled ? "text-[var(--text-main)]" : "text-[var(--text-muted)]")}>{ext.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-[var(--text-dim)]">{ext.version}</span>
          </div>
          <div className="line-clamp-2 text-[11.5px] leading-snug text-[var(--text-dim)]">{ext.description}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="rounded-md bg-[var(--bg-input)] px-1.5 py-px text-[10px] text-[var(--text-muted)]">{ext.category}</span>
            {hasMore && <ChevronDown size={12} className={cx("text-[var(--text-dim)] transition-transform", open && "rotate-180")} />}
          </div>
        </div>
        <Switch on={enabled} onChange={(v) => useSettings.getState().setExtEnabled(ext.id, v)} ariaLabel={`Enable ${ext.name}`} />
      </div>
      {open && (
        <div className="mt-2.5 border-t border-[var(--border-soft)] pt-2.5">
          <ExtensionDetails ext={ext} />
        </div>
      )}
    </div>
  );
}

type Filter = "all" | "enabled" | "disabled";

export function ExtensionsView() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<string | null>(null);
  const enabledMap = useSettings((s) => s.extEnabled);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXTENSIONS.filter((e) => {
      if (category && e.category !== category) return false;
      const on = isExtEnabled(e.id, { extEnabled: enabledMap });
      if (filter === "enabled" && !on) return false;
      if (filter === "disabled" && on) return false;
      return !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    });
  }, [query, filter, category, enabledMap]);

  const enabledCount = EXTENSIONS.filter((e) => isExtEnabled(e.id, { extEnabled: enabledMap })).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3" data-testid="extensions-view">
      <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-transparent bg-[var(--bg-input)] px-2.5 transition-colors focus-within:border-[var(--accent)] hover:border-[var(--border)]">
        <Search size={13} className="shrink-0 text-[var(--text-dim)]" />
        <input
          aria-label="Search extensions"
          className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)]"
          placeholder={`Search ${EXTENSIONS.length} extensions`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="text-[var(--text-dim)] hover:text-[var(--text-main)]" onClick={() => setQuery("")} title="Clear">
            <X size={12} />
          </button>
        )}
      </div>
      <Segmented
        size="sm"
        fill
        className="mt-2 shrink-0"
        options={[
          { value: "all", label: `All ${EXTENSIONS.length}` },
          { value: "enabled", label: `On ${enabledCount}` },
          { value: "disabled", label: `Off ${EXTENSIONS.length - enabledCount}` },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
      />
      <div className="mt-2 flex shrink-0 flex-wrap gap-1">
        {EXT_CATEGORIES.map((c) => (
          <button
            key={c}
            className={cx(
              "h-6 rounded-lg px-2 text-[11px] transition-colors",
              category === c ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-input)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]",
            )}
            onClick={() => setCategory(category === c ? null : c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="no-native-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-3">
        {list.map((e) => (
          <ExtensionCard key={e.id} ext={e} />
        ))}
        {!list.length && <div className="px-2 py-4 text-center text-[12px] text-[var(--text-dim)]">No extensions match.</div>}
      </div>
    </div>
  );
}
