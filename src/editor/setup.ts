/**
 * Core editing behavior driven by Settings → Editor. Optional features
 * (minimap, vim, rainbow brackets…) live in src/extensions.
 */
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { createFindPanel } from "./findPanel";
import { lintKeymap } from "@codemirror/lint";
import type { SettingsState } from "@/stores/settings";
import { effectiveFor } from "@/stores/project";
import { noxHighlight } from "./highlight";

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }
  eq(other: NumberMarker) {
    return other.text === this.text;
  }
  toDOM() {
    return document.createTextNode(this.text);
  }
}

/** Vim-style relative numbers: the current line shows its real number. */
function relativeLineNumbers(): Extension {
  return gutter({
    class: "cm-lineNumbers",
    lineMarker(view, line) {
      const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
      const n = view.state.doc.lineAt(line.from).number;
      return new NumberMarker(n === cur ? String(n) : String(Math.abs(n - cur)));
    },
    lineMarkerChange: (u) => u.selectionSet || u.docChanged || u.viewportChanged,
    initialSpacer: (view) => new NumberMarker(String(view.state.doc.lines)),
  });
}

/**
 * Font and line height from Settings (CSS variables set by the app). As an
 * editor theme they outrank CodeMirror's base theme, which otherwise forces
 * `monospace` and a line height of 1.4.
 */
const fontTheme = EditorView.theme({
  ".cm-scroller": {
    fontFamily: "var(--editor-font, var(--font-mono))",
    fontSize: "var(--editor-font-size, 14px)",
    lineHeight: "var(--editor-line-height, 1.6)",
  },
});

/** Always-on basics that do not depend on settings. */
export function baseExtensions(): Extension[] {
  return [
    fontTheme,
    highlightSpecialChars(),
    history(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    noxHighlight,
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true, createPanel: createFindPanel }),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...lintKeymap, indentWithTab]),
  ];
}

export type EditorSettings = Pick<
  SettingsState,
  | "tabSize"
  | "insertSpaces"
  | "wordWrap"
  | "lineNumbers"
  | "highlightActiveLine"
  | "renderWhitespace"
  | "cursorStyle"
  | "cursorBlink"
  | "scrollPastEnd"
  | "bracketMatching"
>;

export function settingsExtensions(s: EditorSettings): Extension[] {
  const out: Extension[] = [
    EditorState.tabSize.of(s.tabSize),
    indentUnit.of(s.insertSpaces ? " ".repeat(s.tabSize) : "\t"),
    drawSelection({ cursorBlinkRate: s.cursorBlink ? 1100 : 0 }),
    EditorView.editorAttributes.of({ class: `cursor-${s.cursorStyle}` }),
  ];
  if (s.lineNumbers === "on") out.push(lineNumbers(), highlightActiveLineGutter());
  if (s.lineNumbers === "relative") out.push(relativeLineNumbers(), highlightActiveLineGutter());
  if (s.highlightActiveLine) out.push(highlightActiveLine());
  if (s.wordWrap) out.push(EditorView.lineWrapping);
  if (s.renderWhitespace === "all") out.push(highlightWhitespace());
  if (s.renderWhitespace === "boundary") out.push(highlightTrailingWhitespace());
  if (s.scrollPastEnd) out.push(scrollPastEnd());
  if (s.bracketMatching) out.push(bracketMatching());
  return out;
}

/** User settings with the project's overrides for this file applied. */
export function pickEditorSettings(s: SettingsState, file?: { path: string | null; langId: string }): EditorSettings {
  const e = effectiveFor(file?.path ?? null, file?.langId ?? "plaintext", s);
  return {
    tabSize: e.tabSize,
    insertSpaces: e.insertSpaces,
    wordWrap: e.wordWrap,
    lineNumbers: s.lineNumbers,
    highlightActiveLine: s.highlightActiveLine,
    renderWhitespace: s.renderWhitespace,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    scrollPastEnd: s.scrollPastEnd,
    bracketMatching: s.bracketMatching,
  };
}
