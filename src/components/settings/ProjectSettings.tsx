/**
 * Settings → Project: overrides for the open folder, saved to
 * `.nox/settings.json` so they travel with the repository. "Default" means
 * the user setting (or `.editorconfig`) applies.
 */
import { useEffect, useState } from "react";
import { FileCog, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button, Combobox, IconButton, Input, SectionHeading, Segmented, SettingRow, SettingsCard, Switch } from "@/components/ui";
import { LANGUAGES, languageName } from "@/editor/languages";
import { join } from "@/lib/path";
import { useEditor } from "@/stores/editor";
import { PROJECT_FILE, useProject, type LanguageOverrides, type ProjectSettings as Overrides } from "@/stores/project";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace, rootName } from "@/stores/workspace";
import { openFolderDialog } from "@/app/commands";

type Tri = "default" | "on" | "off";
const tri = (v: boolean | undefined): Tri => (v === undefined ? "default" : v ? "on" : "off");
const fromTri = (t: Tri): boolean | undefined => (t === "default" ? undefined : t === "on");

const onOff = (on = "On", off = "Off") => [
  { value: "default" as const, label: "Default" },
  { value: "on" as const, label: on },
  { value: "off" as const, label: off },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group flex flex-col gap-2">
      <SectionHeading>{title}</SectionHeading>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

/** Text / number field that commits on blur or Enter (each change writes the file). */
function Field({ value, onCommit, placeholder, width = 220, numeric = false, mono = true }: { value: string; onCommit: (v: string) => void; placeholder?: string; width?: number; numeric?: boolean; mono?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text !== value && onCommit(text.trim());
  return (
    <Input
      className={mono ? "font-mono" : undefined}
      style={{ width }}
      inputMode={numeric ? "numeric" : undefined}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function TabSize({ value, onChange, fallback }: { value: number | undefined; onChange: (v: number | undefined) => void; fallback: number }) {
  const opts = [{ value: "default", label: `Default (${fallback})` }, ...["2", "4", "8"].map((n) => ({ value: n, label: n }))];
  return <Segmented size="sm" options={opts} value={value === undefined ? "default" : String(value)} onChange={(v) => onChange(v === "default" ? undefined : Number(v))} />;
}

function LanguageRow({ langId, o }: { langId: string; o: LanguageOverrides }) {
  const p = useProject.getState();
  const user = useSettings.getState();
  const set = (patch: LanguageOverrides) => void p.setLanguage(langId, patch);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[var(--bg-input)] p-3">
      <div className="flex items-center">
        <span className="text-[13px] font-medium text-[var(--text-main)]">{languageName(langId)}</span>
        <IconButton label={`Remove ${languageName(langId)} overrides`} className="ml-auto" onClick={() => void p.setLanguage(langId, null)}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <SettingRow title="Tab size">
        <TabSize value={o.tabSize} fallback={p.settings.tabSize ?? user.tabSize} onChange={(v) => set({ tabSize: v })} />
      </SettingRow>
      <SettingRow title="Indent with">
        <Segmented size="sm" options={onOff("Spaces", "Tabs")} value={tri(o.insertSpaces)} onChange={(v) => set({ insertSpaces: fromTri(v) })} />
      </SettingRow>
      <SettingRow title="Word wrap">
        <Segmented size="sm" options={onOff()} value={tri(o.wordWrap)} onChange={(v) => set({ wordWrap: fromTri(v) })} />
      </SettingRow>
      <SettingRow title="Format on save">
        <Segmented size="sm" options={onOff()} value={tri(o.formatOnSave)} onChange={(v) => set({ formatOnSave: fromTri(v) })} />
      </SettingRow>
    </div>
  );
}

export function ProjectSettings() {
  const root = useWorkspace((s) => s.root);
  const s = useProject((st) => st.settings);
  const exists = useProject((st) => st.exists);
  const hasEditorConfig = useProject((st) => st.editorConfig.length > 0);
  const user = useSettings();
  const [adding, setAdding] = useState("");

  if (!root) {
    return (
      <SettingsCard>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <FolderOpen size={28} className="text-[var(--text-dim)]" />
          <div className="text-[13px] text-[var(--text-muted)]">Open a folder to give it its own tab size, formatting and save rules.</div>
          <Button size="sm" variant="primary" onClick={() => void openFolderDialog()}>
            Open Folder…
          </Button>
        </div>
      </SettingsCard>
    );
  }

  const up = (patch: Partial<Overrides>) => void useProject.getState().update(patch);
  const langs = Object.entries(s.languages ?? {});
  const free = LANGUAGES.filter((l) => !s.languages?.[l.id]);

  return (
    <div className="flex flex-col gap-5" data-testid="project-settings">
      <SettingsCard>
        <div className="flex items-center gap-3">
          <FileCog size={18} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-[var(--text-main)]">{rootName(root)}</div>
            <div className="truncate text-[12px] text-[var(--text-dim)]">
              {exists ? `Saved in ${PROJECT_FILE}` : `Nothing overridden yet — changes create ${PROJECT_FILE}`}
              {hasEditorConfig && s.useEditorConfig !== false ? " · .editorconfig applies" : ""}
            </div>
          </div>
          {exists && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                useUi.getState().closeSettings();
                void useEditor.getState().openFile(join(root, PROJECT_FILE));
              }}
            >
              Open JSON
            </Button>
          )}
        </div>
      </SettingsCard>

      <Group title="Indentation">
        <SettingRow title="Tab size" keywords="indent width project">
          <TabSize value={s.tabSize} fallback={user.tabSize} onChange={(v) => up({ tabSize: v })} />
        </SettingRow>
        <SettingRow title="Indent with" hint={`Default: ${user.insertSpaces ? "spaces" : "tabs"}`} keywords="spaces tabs project">
          <Segmented size="sm" options={onOff("Spaces", "Tabs")} value={tri(s.insertSpaces)} onChange={(v) => up({ insertSpaces: fromTri(v) })} />
        </SettingRow>
        <SettingRow title="Word wrap" hint={`Default: ${user.wordWrap ? "on" : "off"}`} keywords="wrap lines project">
          <Segmented size="sm" options={onOff()} value={tri(s.wordWrap)} onChange={(v) => up({ wordWrap: fromTri(v) })} />
        </SettingRow>
        <SettingRow title="Use .editorconfig" hint="indent_style, indent_size, trim_trailing_whitespace, insert_final_newline, max_line_length" keywords="editorconfig project">
          <Switch on={s.useEditorConfig !== false} onChange={(on) => up({ useEditorConfig: on ? undefined : false })} ariaLabel="Use .editorconfig" />
        </SettingRow>
      </Group>

      <Group title="Saving">
        <SettingRow title="Trim trailing whitespace" hint={`Default: ${user.trimTrailingWhitespace ? "on" : "off"}`} keywords="spaces save project">
          <Segmented size="sm" options={onOff()} value={tri(s.trimTrailingWhitespace)} onChange={(v) => up({ trimTrailingWhitespace: fromTri(v) })} />
        </SettingRow>
        <SettingRow title="Insert final newline" hint={`Default: ${user.insertFinalNewline ? "on" : "off"}`} keywords="eol end of file project">
          <Segmented size="sm" options={onOff()} value={tri(s.insertFinalNewline)} onChange={(v) => up({ insertFinalNewline: fromTri(v) })} />
        </SettingRow>
        <SettingRow title="Format on save" hint="Runs Prettier on supported files" keywords="prettier format project">
          <Segmented size="sm" options={onOff()} value={tri(s.formatOnSave)} onChange={(v) => up({ formatOnSave: fromTri(v) })} />
        </SettingRow>
      </Group>

      <Group title="Formatting (Prettier)">
        <SettingRow title="Print width" hint="Empty = the Prettier extension setting" keywords="line length columns project">
          <Field numeric width={90} value={s.printWidth === undefined ? "" : String(s.printWidth)} placeholder="default" onCommit={(v) => up({ printWidth: v ? Math.max(20, Math.min(400, Number(v))) : undefined })} />
        </SettingRow>
        <SettingRow title="Semicolons" keywords="semi project">
          <Segmented size="sm" options={onOff()} value={tri(s.semi)} onChange={(v) => up({ semi: fromTri(v) })} />
        </SettingRow>
        <SettingRow title="Quotes" keywords="single double quote project">
          <Segmented size="sm" options={onOff("Single", "Double")} value={tri(s.singleQuote)} onChange={(v) => up({ singleQuote: fromTri(v) })} />
        </SettingRow>
      </Group>

      <Group title="Files and terminal">
        <SettingRow title="Hidden files" hint="Extra globs hidden from the explorer in this project, comma separated" keywords="exclude ignore project">
          <Field width={300} value={s.filesExclude ?? ""} placeholder="dist, coverage, *.log" onCommit={(v) => up({ filesExclude: v || undefined })} />
        </SettingRow>
        <SettingRow title="Terminal folder" hint="Where new terminals start, relative to the project root" keywords="cwd shell project">
          <Field width={220} value={s.terminalCwd ?? ""} placeholder="(project root)" onCommit={(v) => up({ terminalCwd: v || undefined })} />
        </SettingRow>
      </Group>

      <section className="settings-group flex flex-col gap-2">
        <SectionHeading>Per language</SectionHeading>
        <SettingsCard>
          <SettingRow title="Language overrides" hint="Different indentation or formatting for one language in this project" keywords="language python go rust project">
            <div className="flex items-center gap-1.5">
              <Combobox className="w-[200px]" placeholder="Choose a language" options={free.map((l) => ({ value: l.id, label: l.name }))} value={adding} onChange={setAdding} />
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={13} />}
                disabled={!adding}
                onClick={() => {
                  void useProject.getState().setLanguage(adding, { tabSize: s.tabSize ?? user.tabSize });
                  setAdding("");
                }}
              >
                Add
              </Button>
            </div>
          </SettingRow>
          {langs.map(([id, o]) => (
            <LanguageRow key={id} langId={id} o={o} />
          ))}
        </SettingsCard>
      </section>
    </div>
  );
}
