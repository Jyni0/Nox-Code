import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

/**
 * Which sides of the editor column touch the window. In the "docked" layout
 * the panels are the same islands, but they sit flush against the window edge
 * opposite the sidebar and against the bottom — square on those sides.
 */
export function useWindowEdges() {
  const docked = useSettings((s) => s.layout === "docked");
  const side = useSettings((s) => s.sidebarSide);
  const sidebarHidden = useSettings((s) => s.sidebarHidden);
  const zen = useUi((s) => s.zen);
  const terminalBelow = useUi((s) => s.panelOpen && !s.panelMaximized);
  const on = docked && !zen;
  return {
    docked: on,
    left: on && (sidebarHidden || side !== "left"),
    right: on && (sidebarHidden || side !== "right"),
    /** The editor reaches the bottom (no terminal under it). */
    editorBottom: on && !terminalBelow,
  };
}

/** Rounded island with the listed corners squared off. */
export function islandCorners(square: { tl?: boolean; tr?: boolean; bl?: boolean; br?: boolean }): string {
  return [
    "rounded-2xl",
    square.tl && "rounded-tl-none",
    square.tr && "rounded-tr-none",
    square.bl && "rounded-bl-none",
    square.br && "rounded-br-none",
  ]
    .filter(Boolean)
    .join(" ");
}
