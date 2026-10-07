import type { EditorView } from "@codemirror/view";
import { useEditor } from "@/stores/editor";

/** The live EditorView of each pane (for commands like format, go to line). */
const views = new Map<string, EditorView>();

export const viewRegistry = {
  set(paneId: string, view: EditorView | null) {
    if (view) views.set(paneId, view);
    else views.delete(paneId);
  },
  get: (paneId: string) => views.get(paneId) ?? null,
  all: () => [...views.values()],
};

export function activeView(): EditorView | null {
  return viewRegistry.get(useEditor.getState().activePaneId);
}
