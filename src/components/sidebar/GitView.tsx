import { useState } from "react";
import { Check, FileText, GitBranch, Minus, Plus, RefreshCw, Undo2 } from "lucide-react";
import { backend } from "@/lib/backend";
import type { GitFile } from "@/lib/types";
import { basename, dirname, join } from "@/lib/path";
import { FileIcon } from "@/icons/FileIcon";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { errorMessage, toast, useUi } from "@/stores/ui";
import { invalidateGitBases } from "@/editor/CodeEditor";
import { Button, Kbd, Spinner } from "@/components/ui";
import { Collapse, HeaderAction, SectionHeader } from "./Section";

const STATUS_LABEL: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", "?": "Untracked", U: "Conflict", C: "Copied", T: "Type changed" };
const color = (s: string) => (s === "?" || s === "A" ? "var(--diff-add)" : s === "D" || s === "U" ? "var(--diff-del)" : "var(--diff-mod)");

export function GitView() {
  const root = useWorkspace((s) => s.root);
  const git = useWorkspace((s) => s.git);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);

  if (!root) return <div className="px-2 pt-4 text-[12.5px] text-[var(--text-dim)]">Open a folder to use source control.</div>;
  if (!git) return <div className="flex justify-center pt-6"><Spinner /></div>;
  if (!git.isRepo) {
    return (
      <div className="flex flex-col gap-3 px-1 pt-4">
        <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">This folder is not a Git repository (or Git is not installed).</div>
        <Button
          variant="primary"
          size="sm"
          className="h-8"
          icon={<GitBranch size={14} />}
          onClick={async () => {
            try {
              await backend().gitInit(root);
              await useWorkspace.getState().refreshGit();
            } catch (e) {
              toast(errorMessage(e), "error");
            }
          }}
        >
          Initialize Repository
        </Button>
      </div>
    );
  }

  const staged = git.files.filter((f) => f.staged);
  const changes = git.files.filter((f) => f.unstaged || f.status === "?");

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      await useWorkspace.getState().refreshGit();
      setBusy(false);
    }
  };

  const commit = () =>
    act(async () => {
      if (!message.trim()) {
        toast("Write a commit message first", "warning");
        return;
      }
      // Nothing staged: commit everything, like VS Code's "smart commit".
      if (!staged.length) await backend().gitStage(root, changes.map((f) => f.path));
      await backend().gitCommit(root, message);
      setMessage("");
      toast("Committed", "success");
      invalidateGitBases();
    });

  const discard = async (files: GitFile[]) => {
    const tracked = files.filter((f) => f.status !== "?");
    if (!tracked.length) return;
    const ans = await useUi.getState().ask({
      title: tracked.length === 1 ? `Discard changes in ${basename(tracked[0].path)}?` : `Discard changes in ${tracked.length} files?`,
      message: "This cannot be undone.",
      buttons: [
        { id: "discard", label: "Discard Changes", variant: "danger" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });
    if (ans !== "discard") return;
    await act(async () => {
      await backend().gitDiscard(root, tracked.map((f) => f.path));
      await useEditor.getState().onDiskChange(tracked.map((f) => join(root, f.path)));
      await useWorkspace.getState().refreshPaths(tracked.map((f) => join(root, f.path)));
    });
  };

  const row = (f: GitFile, isStaged: boolean) => {
    const abs = join(root, f.path);
    const dir = dirname(f.path);
    return (
      <div
        key={(isStaged ? "s:" : "c:") + f.path}
        data-testid="git-row"
        className="group relative flex h-7 cursor-pointer items-center gap-2 rounded-lg px-2 text-[12.5px] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
        title={`${f.path} — ${STATUS_LABEL[f.status] ?? f.status}`}
        onClick={() => (f.status === "?" || f.status === "A" ? void useEditor.getState().openFile(abs, { preview: true }) : void useEditor.getState().openDiff(abs))}
      >
        <FileIcon name={basename(f.path)} size={14} />
        <span className={`truncate ${f.status === "D" ? "line-through" : ""}`} style={{ color: color(f.status) }}>
          {basename(f.path)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-dim)]">{dir}</span>
        <span className="hidden items-center gap-0.5 group-hover:flex">
          {f.status !== "D" && (
            <button title="Open File" className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--row-solid-hover)]" onClick={(e) => (e.stopPropagation(), void useEditor.getState().openFile(abs))}>
              <FileText size={12} />
            </button>
          )}
          {!isStaged && f.status !== "?" && (
            <button title="Discard Changes" className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--row-solid-hover)]" onClick={(e) => (e.stopPropagation(), void discard([f]))}>
              <Undo2 size={12} />
            </button>
          )}
          <button
            title={isStaged ? "Unstage Changes" : "Stage Changes"}
            data-testid={isStaged ? "git-unstage" : "git-stage"}
            className="flex h-5 w-5 items-center justify-center rounded-md hover:bg-[var(--row-solid-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              void act(() => (isStaged ? backend().gitUnstage(root, [f.path]) : backend().gitStage(root, [f.path])));
            }}
          >
            {isStaged ? <Minus size={12} /> : <Plus size={12} />}
          </button>
        </span>
        <span className="w-3 shrink-0 text-center font-mono text-[10.5px] font-semibold group-hover:hidden" style={{ color: color(f.status) }}>
          {f.status === "?" ? "U" : f.status}
        </span>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3" data-testid="git-view">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2 px-1 text-[12px] text-[var(--text-muted)]">
          <GitBranch size={13} />
          <span className="flex-1 truncate">{git.branch ?? "detached HEAD"}</span>
          <HeaderAction label="Refresh" onClick={() => void act(async () => invalidateGitBases())}>
            <RefreshCw size={13} />
          </HeaderAction>
        </div>
        <textarea
          aria-label="Commit message"
          data-testid="commit-message"
          rows={2}
          value={message}
          placeholder={`Message (Ctrl+Enter to commit on "${git.branch ?? "HEAD"}")`}
          className="min-h-[60px] w-full resize-none rounded-xl border border-transparent bg-[var(--bg-input)] px-3 py-2 text-[12.5px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] hover:border-[var(--border)] focus:border-[var(--accent)]"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <Button variant="primary" size="sm" className="h-8" disabled={busy || (!staged.length && !changes.length)} icon={busy ? <Spinner size={13} /> : <Check size={14} />} onClick={() => void commit()}>
          Commit{!staged.length && changes.length ? " All" : ""} <Kbd combo="Ctrl+Enter" className="ml-1 opacity-80" />
        </Button>
      </div>

      <div className="no-native-scrollbar mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
        {staged.length > 0 && (
          <>
            <SectionHeader
              title="Staged Changes"
              count={staged.length}
              open={stagedOpen}
              onToggle={() => setStagedOpen(!stagedOpen)}
              actions={
                <HeaderAction label="Unstage All" onClick={() => void act(() => backend().gitUnstage(root, staged.map((f) => f.path)))}>
                  <Minus size={14} />
                </HeaderAction>
              }
            />
            <Collapse open={stagedOpen} className="gap-0.5">
              {staged.map((f) => row(f, true))}
            </Collapse>
          </>
        )}
        <SectionHeader
          title="Changes"
          count={changes.length}
          open={changesOpen}
          onToggle={() => setChangesOpen(!changesOpen)}
          actions={
            changes.length > 0 && (
              <>
                <HeaderAction label="Discard All Changes" onClick={() => void discard(changes)}>
                  <Undo2 size={13} />
                </HeaderAction>
                <HeaderAction label="Stage All Changes" onClick={() => void act(() => backend().gitStage(root, changes.map((f) => f.path)))}>
                  <Plus size={14} />
                </HeaderAction>
              </>
            )
          }
        />
        <Collapse open={changesOpen} className="gap-0.5">
          {changes.length ? changes.map((f) => row(f, false)) : <div className="px-2 py-1 text-[12px] text-[var(--text-dim)]">No changes — working tree clean.</div>}
        </Collapse>
      </div>
    </div>
  );
}
