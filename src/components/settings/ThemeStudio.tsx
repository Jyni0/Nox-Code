import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Pencil, Shuffle, Sparkles, Trash2, Upload } from "lucide-react";
import { EDITOR_TOKENS, SYNTAX_TOKENS, TOKEN_LABELS, UI_TOKENS, type Theme } from "@/themes/types";
import { cloneTheme, exportTheme, generateTheme } from "@/themes/convert";
import { allThemes, findTheme, useSettings } from "@/stores/settings";
import { toast, useUi } from "@/stores/ui";
import { importThemeFile } from "@/app/commands";
import { backend, inTauri } from "@/lib/backend";
import { Button, Input, Segmented, SectionHeading, SettingRow, SettingsCard, Sep, Switch, cx } from "@/components/ui";
import { CodePreview, ColorField, ThemeThumb } from "./shared";

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportToFile(t: Theme) {
  const name = `${t.name.replace(/[^\w.-]+/g, "-").toLowerCase()}.nox-theme.json`;
  const json = exportTheme(t);
  if (inTauri) {
    const path = await backend().pickSaveFile(name);
    if (!path) return;
    await backend().writeFile(path, json);
    toast(`Exported to ${path}`, "success");
  } else {
    download(name, json);
  }
}

type Group = "ui" | "editor" | "syntax";

export function ThemeStudio() {
  const themeId = useSettings((s) => s.themeId);
  const customThemes = useSettings((s) => s.customThemes);
  const focus = useUi((s) => s.settingsFocus);
  const active = findTheme(themeId, { customThemes });
  const [group, setGroup] = useState<Group>("syntax");
  const [genBg, setGenBg] = useState("#11131a");
  const [genAccent, setGenAccent] = useState("#7c5cff");
  const [genName, setGenName] = useState("My Theme");

  // "Customize current theme" from the palette: start editing right away.
  useEffect(() => {
    if (focus === "studio" && active.builtin) customize(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const editable = !active.builtin;

  function customize(t: Theme) {
    const copy = cloneTheme(t, `${t.name} (Custom)`);
    useSettings.getState().saveCustomTheme(copy);
    useSettings.getState().patch({ themeId: copy.id, followSystem: false });
  }

  const update = (fn: (t: Theme) => Theme) => {
    if (!editable) return;
    useSettings.getState().saveCustomTheme(fn(structuredClone(active)));
  };

  const tokens = useMemo(() => (group === "ui" ? UI_TOKENS : group === "editor" ? EDITOR_TOKENS : SYNTAX_TOKENS), [group]);

  const shuffleSyntax = () =>
    update((t) => {
      const keys = [...SYNTAX_TOKENS].filter((k) => !["variable", "punctuation", "comment"].includes(k));
      const vals = keys.map((k) => t.syntax[k]).sort(() => Math.random() - 0.5);
      keys.forEach((k, i) => (t.syntax[k] = vals[i]));
      return t;
    });

  return (
    <div className="flex flex-col gap-4" id="studio">
      <SettingsCard>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {editable ? (
              <Input
                aria-label="Theme name"
                size="sm"
                className="max-w-[320px] text-[13px] font-medium"
                value={active.name}
                onChange={(e) => update((t) => ({ ...t, name: e.target.value || "Untitled" }))}
              />
            ) : (
              <div className="text-[14px] font-medium text-[var(--text-main)]">{active.name}</div>
            )}
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">
              {editable ? "Your theme — every change applies instantly." : "Built-in themes are read-only. Customize makes an editable copy."}
            </div>
          </div>
          {!editable && (
            <Button variant="primary" size="sm" icon={<Pencil size={13} />} onClick={() => customize(active)}>
              Customize
            </Button>
          )}
          {editable && (
            <>
              <Button size="sm" icon={<Copy size={13} />} onClick={() => customize(active)}>
                Duplicate
              </Button>
              <Button size="sm" icon={<Download size={13} />} onClick={() => void exportToFile(active)}>
                Export
              </Button>
              <Button
                size="sm"
                variant="danger-ghost"
                icon={<Trash2 size={13} />}
                onClick={async () => {
                  const ans = await useUi.getState().ask({
                    title: `Delete "${active.name}"?`,
                    buttons: [
                      { id: "delete", label: "Delete", variant: "danger" },
                      { id: "cancel", label: "Cancel" },
                    ],
                    cancelId: "cancel",
                  });
                  if (ans === "delete") useSettings.getState().deleteCustomTheme(active.id);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </SettingsCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <SettingsCard className={cx(!editable && "pointer-events-none opacity-55")}>
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              options={[
                { value: "syntax", label: "Syntax" },
                { value: "editor", label: "Editor" },
                { value: "ui", label: "Interface" },
              ]}
              value={group}
              onChange={(g) => setGroup(g as Group)}
            />
            <div className="flex-1" />
            {group === "syntax" && (
              <Button size="xs" variant="ghost" icon={<Shuffle size={12} />} onClick={shuffleSyntax}>
                Shuffle
              </Button>
            )}
          </div>
          {group === "syntax" && (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {(["italicComments", "italicKeywords", "boldKeywords"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                  <Switch on={!!active[k]} onChange={(v) => update((t) => ({ ...t, [k]: v }))} ariaLabel={k} />
                  {k === "italicComments" ? "Italic comments" : k === "italicKeywords" ? "Italic keywords" : "Bold keywords"}
                </label>
              ))}
            </div>
          )}
          {group === "ui" && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
              Kind
              <Segmented size="xs" options={["dark", "light"] as const} value={active.kind} onChange={(k) => update((t) => ({ ...t, kind: k }))} />
            </div>
          )}
          <Sep />
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 2xl:grid-cols-2">
            {tokens.map((tok) => {
              const value =
                group === "ui" ? active.ui[tok as keyof Theme["ui"]] : group === "editor" ? active.editor[tok as keyof Theme["editor"]] : active.syntax[tok as keyof Theme["syntax"]];
              return (
                <div key={tok} className="flex items-center gap-2">
                  {group === "syntax" && <span className="font-mono text-[12px]" style={{ color: value }}>Aa</span>}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-muted)]">{TOKEN_LABELS[tok]}</span>
                  <ColorField
                    label={TOKEN_LABELS[tok]}
                    value={value}
                    onChange={(v) =>
                      update((t) => {
                        if (group === "ui") t.ui[tok as keyof Theme["ui"]] = v;
                        else if (group === "editor") t.editor[tok as keyof Theme["editor"]] = v;
                        else t.syntax[tok as keyof Theme["syntax"]] = v;
                        return t;
                      })
                    }
                    onReset={
                      group === "editor"
                        ? () =>
                            update((t) => {
                              delete t.editor[tok as keyof Theme["editor"]];
                              return t;
                            })
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        </SettingsCard>

        <div className="flex flex-col gap-4">
          <SettingsCard className="p-2">
            <CodePreview height={330} />
          </SettingsCard>
          <SettingsCard>
            <div className="flex items-center gap-2 text-[13px] text-[var(--text-main)]">
              <Sparkles size={14} className="text-[var(--accent)]" /> Generate from two colors
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--text-dim)]">Background</span>
                <ColorField label="Background" value={genBg} onChange={setGenBg} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--text-dim)]">Accent</span>
                <ColorField label="Accent" value={genAccent} onChange={setGenAccent} />
              </div>
            </div>
            <div className="flex gap-2">
              <Input size="sm" aria-label="New theme name" value={genName} onChange={(e) => setGenName(e.target.value)} />
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const t = generateTheme(genName.trim() || "My Theme", genBg, genAccent);
                  useSettings.getState().saveCustomTheme(t);
                  useSettings.getState().patch({ themeId: t.id, followSystem: false });
                  toast(`Created "${t.name}"`, "success");
                }}
              >
                Create
              </Button>
            </div>
          </SettingsCard>
          <SettingsCard>
            <SettingRow title="Import a theme" hint="VS Code color themes (.json from any extension) or Nox Code theme files.">
              <Button size="sm" icon={<Upload size={13} />} onClick={() => void importThemeFile()}>
                Import…
              </Button>
            </SettingRow>
          </SettingsCard>
        </div>
      </div>

      {customThemes.length > 0 && (
        <>
          <SectionHeading>Your themes</SectionHeading>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {allThemes({ customThemes })
              .filter((t) => !t.builtin)
              .map((t) => (
                <button key={t.id} className={cx("flex flex-col gap-1.5 rounded-2xl p-1.5 text-left transition-colors hover:bg-[var(--hover-bg)]", t.id === themeId && "bg-[var(--hover-bg)]")} onClick={() => useSettings.getState().patch({ themeId: t.id, followSystem: false })}>
                  <ThemeThumb theme={t} />
                  <span className="truncate px-1 text-[12px] text-[var(--text-main)]">{t.name}</span>
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
