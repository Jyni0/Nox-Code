import { FolderOpen } from "lucide-react";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { runCommand } from "@/core/commands";
import { switchFolder } from "@/app/commands";
import { basename } from "@/lib/path";
import { Button, Kbd } from "@/components/ui";
import { ExplorerTree } from "./ExplorerTree";
import { SectionHeader } from "./Section";

export function ExplorerView() {
  const root = useWorkspace((s) => s.root);
  const recents = useSettings((s) => s.recentProjects);

  if (!root) {
    return (
      <div className="flex flex-col gap-3 px-1 pt-4">
        <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">You have not opened a folder yet.</div>
        <Button variant="primary" size="sm" className="h-8" icon={<FolderOpen size={14} />} onClick={() => void runCommand("file.openFolder")}>
          Open Folder <Kbd combo="Ctrl+O" className="ml-1 opacity-80" />
        </Button>
        {recents.length > 0 && (
          <>
            <SectionHeader title="Recent" open onToggle={() => {}} />
            {recents.slice(0, 8).map((p) => (
              <button
                key={p}
                className="flex h-8 items-center gap-2 rounded-xl px-2 text-left text-[13px] text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
                title={p}
                onClick={() => void switchFolder(p)}
              >
                <FolderOpen size={15} className="shrink-0" />
                <span className="truncate">{basename(p)}</span>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  // Just the tree: new file / folder, refresh and collapse live in its context menu.
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <ExplorerTree />
    </div>
  );
}
