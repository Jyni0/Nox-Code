export const UI_TOKENS = [
  "bg-app",
  "bg-sidebar",
  "bg-titlebar",
  "bg-surface",
  "bg-input",
  "bg-elevated",
  "bg-editor",
  "border",
  "border-soft",
  "text-main",
  "text-muted",
  "text-dim",
  "accent",
  "accent-hover",
  "accent-fg",
  "diff-add",
  "diff-del",
  "diff-mod",
  "hover-bg",
  "row-solid",
  "row-solid-hover",
] as const;

export const EDITOR_TOKENS = [
  "ed-fg",
  "ed-gutter",
  "ed-gutter-active",
  "ed-line-highlight",
  "ed-selection",
  "ed-match",
  "ed-cursor",
  "ed-bracket",
  "ed-search",
  "ed-whitespace",
  "ed-indent",
  "ed-indent-active",
] as const;

export const SYNTAX_TOKENS = [
  "keyword",
  "string",
  "comment",
  "function",
  "variable",
  "property",
  "type",
  "number",
  "constant",
  "operator",
  "punctuation",
  "tag",
  "attribute",
  "regexp",
  "heading",
  "link",
  "meta",
  "invalid",
] as const;

export type UiToken = (typeof UI_TOKENS)[number];
export type EditorToken = (typeof EDITOR_TOKENS)[number];
export type SyntaxToken = (typeof SYNTAX_TOKENS)[number];

export interface Theme {
  id: string;
  name: string;
  kind: "dark" | "light";
  /** Built-ins are read-only; "Customize" makes an editable copy. */
  builtin?: boolean;
  author?: string;
  description?: string;
  ui: Record<UiToken, string>;
  /** Unset tokens fall back to values derived from the UI palette. */
  editor: Partial<Record<EditorToken, string>>;
  syntax: Record<SyntaxToken, string>;
  /** Comment / keyword styling. */
  italicComments?: boolean;
  italicKeywords?: boolean;
  boldKeywords?: boolean;
}

export const TOKEN_LABELS: Record<UiToken | EditorToken | SyntaxToken, string> = {
  "bg-app": "App background",
  "bg-sidebar": "Sidebar & title bar",
  "bg-titlebar": "Title bar",
  "bg-surface": "Popovers & cards",
  "bg-input": "Inputs & buttons",
  "bg-elevated": "Elevated (hover)",
  "bg-editor": "Editor background",
  border: "Border",
  "border-soft": "Soft border",
  "text-main": "Text",
  "text-muted": "Muted text",
  "text-dim": "Dim text",
  accent: "Accent",
  "accent-hover": "Accent hover",
  "accent-fg": "Text on accent",
  "diff-add": "Added",
  "diff-del": "Deleted / error",
  "diff-mod": "Modified / warning",
  "hover-bg": "Row hover",
  "row-solid": "Row solid",
  "row-solid-hover": "Row solid hover",
  "ed-fg": "Editor text",
  "ed-gutter": "Line numbers",
  "ed-gutter-active": "Active line number",
  "ed-line-highlight": "Current line",
  "ed-selection": "Selection",
  "ed-match": "Selection matches",
  "ed-cursor": "Cursor",
  "ed-bracket": "Matching bracket",
  "ed-search": "Search match",
  "ed-whitespace": "Whitespace",
  "ed-indent": "Indent guide",
  "ed-indent-active": "Active indent guide",
  keyword: "Keywords",
  string: "Strings",
  comment: "Comments",
  function: "Functions",
  variable: "Variables",
  property: "Properties",
  type: "Types & classes",
  number: "Numbers",
  constant: "Constants",
  operator: "Operators",
  punctuation: "Punctuation",
  tag: "Tags",
  attribute: "Attributes",
  regexp: "Regular expressions",
  heading: "Headings",
  link: "Links",
  meta: "Decorators & meta",
  invalid: "Invalid",
};
