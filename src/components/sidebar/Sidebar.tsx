import { useCallback } from "react";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { ExplorerView } from "./ExplorerView";
import { GitView } from "./GitView";
import { ExtensionsView } from "./ExtensionsView";

export function useSidebarResize() {
  const side = useSettings((s) => s.sidebarSide);
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = useSettings.getState().sidebarWidth;
      const el = e.currentTarget as HTMLElement;
      el.classList.add("resizer-active");
      const move = (ev: MouseEvent) => {
        const dx = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        useSettings.getState().set("sidebarWidth", Math.max(220, Math.min(560, startW + dx)));
      };
      const up = () => {
        el.classList.remove("resizer-active");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [side],
  );
}

export function Sidebar() {
  const width = useSettings((s) => s.sidebarWidth);
  const side = useSettings((s) => s.sidebarSide);
  const view = useUi((s) => s.sideView);
  const startResize = useSidebarResize();

  return (
    <aside
      className="relative flex shrink-0 flex-col bg-[var(--bg-sidebar)] text-[13px] leading-tight"
      style={{ width }}
      data-testid="sidebar"
    >
      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2">
        {view === "explorer" && <ExplorerView />}
        {view === "git" && <GitView />}
        {view === "extensions" && <ExtensionsView />}
      </div>

      <div className="resizer-x" style={side === "left" ? { right: -3 } : { left: -3 }} onMouseDown={startResize} />
    </aside>
  );
}
