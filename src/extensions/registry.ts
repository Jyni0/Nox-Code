/**
 * Built-in extensions. Each one can be switched off and most have settings
 * (Settings → Extensions, or the Extensions view in the sidebar).
 */
import { Prec, EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, highlightTrailingWhitespace, keymap } from "@codemirror/view";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { codeFolding, foldGutter, foldKeymap, syntaxTree } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { lintGutter, linter, setDiagnostics } from "@codemirror/lint";
import { vim } from "@replit/codemirror-vim";
import { showMinimap } from "@replit/codemirror-minimap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { LANGUAGES } from "@/editor/languages";
import { useSettings, type SettingsState } from "@/stores/settings";
import { RAINBOW_PALETTES, colorPreview, gitGutter, rainbowBrackets, todoHighlighter } from "./editorFeatures";
import { errorLens } from "./errorLens";
import { DEFAULT_TAGS, betterComments } from "./betterComments";
import { universalCompletion } from "@/editor/intel/completion";
import { problemDiagnostics, syntaxDiagnostics } from "@/editor/intel/syntaxErrors";
import { ensureChecksStarted, onProblemsChange, setProblemsEnabled } from "@/editor/intel/problems";
import { ctrlClickNavigation, hoverCards, intelContext } from "@/editor/intel/navigation";

export type ExtCategory = "Editing" | "Visual" | "Formatting" | "Git" | "Productivity" | "Keymaps" | "Previews" | "Languages";

export interface ExtSetting {
  key: string;
  label: string;
  description?: string;
  type: "boolean" | "number" | "select" | "text";
  default: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ExtContext {
  bufferId: string;
  langId: string;
  path: string | null;
  settings: Record<string, unknown>;
}

export interface NoxExtension {
  id: string;
  name: string;
  description: string;
  details?: string[];
  category: ExtCategory;
  /** ICON_LIBRARY name + tile color. */
  icon: string;
  color: string;
  version: string;
  defaultEnabled: boolean;
  settings?: ExtSetting[];
  /** Commands this extension adds (shown on its card). */
  commands?: string[];
  editor?: (ctx: ExtContext) => Extension;
}

const minimapDom = () => ({ dom: document.createElement("div") });

const CORE: NoxExtension[] = [
  {
    id: "vim",
    name: "Vim Mode",
    description: "Modal editing with Vim keybindings, : commands, registers and macros.",
    details: ["Normal, insert, visual and visual-block modes", "Ex commands like :w, :s/foo/bar/g", "Mode shown in the status bar"],
    category: "Keymaps",
    icon: "Terminal",
    color: "#019833",
    version: "6.4.0",
    defaultEnabled: false,
    editor: () => Prec.highest(vim({ status: true })),
  },
  {
    id: "minimap",
    name: "Minimap",
    description: "A zoomed-out overview of the file next to the scrollbar.",
    category: "Visual",
    icon: "Map",
    color: "#5b8cff",
    version: "0.5.2",
    defaultEnabled: true,
    settings: [
      {
        key: "displayText",
        label: "Render as",
        type: "select",
        default: "blocks",
        options: [
          { value: "blocks", label: "Blocks" },
          { value: "characters", label: "Characters" },
        ],
      },
      {
        key: "showOverlay",
        label: "Viewport overlay",
        type: "select",
        default: "mouse-over",
        options: [
          { value: "always", label: "Always" },
          { value: "mouse-over", label: "On hover" },
        ],
      },
    ],
    editor: ({ settings }) =>
      showMinimap.compute(["doc"], () => ({
        create: minimapDom,
        displayText: settings.displayText as "blocks" | "characters",
        showOverlay: settings.showOverlay as "always" | "mouse-over",
      })),
  },
  {
    id: "indent-guides",
    name: "Indent Guides",
    description: "Vertical guides for every indentation level; the active block is highlighted.",
    category: "Visual",
    icon: "ListTree",
    color: "#26a69a",
    version: "6.5.3",
    defaultEnabled: true,
    settings: [
      { key: "highlightActive", label: "Highlight active block", type: "boolean", default: true },
      {
        key: "markerType",
        label: "Guides span",
        type: "select",
        default: "fullScope",
        options: [
          { value: "fullScope", label: "Whole scope" },
          { value: "codeOnly", label: "Code only" },
        ],
      },
      { key: "thickness", label: "Thickness", type: "number", default: 1, min: 1, max: 3 },
    ],
    editor: ({ settings }) =>
      indentationMarkers({
        highlightActiveBlock: settings.highlightActive as boolean,
        markerType: settings.markerType as "fullScope" | "codeOnly",
        thickness: settings.thickness as number,
        activeThickness: (settings.thickness as number) + 0.5,
        colors: {
          light: "var(--ed-indent, color-mix(in srgb, var(--text-main) 10%, transparent))",
          dark: "var(--ed-indent, color-mix(in srgb, var(--text-main) 9%, transparent))",
          activeLight: "var(--ed-indent-active, color-mix(in srgb, var(--text-main) 28%, transparent))",
          activeDark: "var(--ed-indent-active, color-mix(in srgb, var(--text-main) 24%, transparent))",
        },
      }),
  },
  {
    id: "rainbow-brackets",
    name: "Rainbow Brackets",
    description: "Colors matching bracket pairs by nesting depth.",
    category: "Visual",
    icon: "Brackets",
    color: "#da70d6",
    version: "1.0.0",
    defaultEnabled: true,
    settings: [
      {
        key: "palette",
        label: "Palette",
        type: "select",
        default: "classic",
        options: Object.keys(RAINBOW_PALETTES).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
      },
    ],
    editor: ({ settings }) => rainbowBrackets(RAINBOW_PALETTES[settings.palette as string] ?? RAINBOW_PALETTES.classic),
  },
  {
    id: "color-preview",
    name: "Color Highlighter",
    description: "Shows a swatch next to #hex, rgb() and hsl() colors — click it to pick a new one.",
    category: "Visual",
    icon: "Palette",
    color: "#ff9e64",
    version: "1.0.0",
    defaultEnabled: true,
    editor: () => colorPreview(),
  },
  {
    id: "error-lens",
    name: "Error Lens",
    description: "Shows each error and warning right in the code: the message at the end of its line and the line tinted, without hovering.",
    details: ["Works with syntax errors and the project checker (tsc, cargo check, go vet, ruff)", "One message per line — the most severe; (+N) when the line has more"],
    category: "Visual",
    icon: "Eye",
    color: "#ff5370",
    version: "1.0.0",
    defaultEnabled: true,
    settings: [
      {
        key: "minSeverity",
        label: "Show messages for",
        type: "select",
        default: "warning",
        options: [
          { value: "error", label: "Errors only" },
          { value: "warning", label: "Errors and warnings" },
          { value: "info", label: "Everything" },
        ],
      },
      { key: "lineBackground", label: "Tint the whole line", type: "boolean", default: true },
      { key: "maxLength", label: "Longest message (characters)", type: "number", default: 120, min: 20, max: 400, step: 10 },
    ],
    editor: ({ settings }) =>
      errorLens({
        minSeverity: (settings.minSeverity as "error" | "warning" | "info") ?? "warning",
        lineBackground: settings.lineBackground !== false,
        maxLength: Number(settings.maxLength) || 120,
      }),
  },
  {
    id: "better-comments",
    name: "Better Comments",
    description: "Colours comments by the tag they start with: ! alerts, ? questions, TODO tasks, * highlights and //// commented-out code.",
    details: ["// ! Deprecated — do not use", "// ? Should this be cached?", "// TODO: split this function", "// * Important: runs before render", "//// oldCode()", "Works with line and block comments in every language, JSDoc lines included"],
    category: "Visual",
    icon: "Palette",
    color: "#98c379",
    version: "1.0.0",
    defaultEnabled: true,
    settings: [
      {
        key: "tags",
        label: "Tags",
        description: "tag colour [strike], comma separated",
        type: "text",
        default: DEFAULT_TAGS,
      },
    ],
    editor: ({ settings }) => betterComments(String(settings.tags ?? DEFAULT_TAGS)),
  },
  {
    id: "todo-highlight",
    name: "TODO Highlight",
    description: "Makes TODO, FIXME, HACK and NOTE comments impossible to miss.",
    category: "Productivity",
    icon: "ListChecks",
    color: "#ffd866",
    version: "1.0.0",
    defaultEnabled: true,
    settings: [{ key: "keywords", label: "Keywords", description: "Comma separated", type: "text", default: "TODO, FIXME, HACK, NOTE, BUG, XXX" }],
    editor: ({ settings }) => todoHighlighter(String(settings.keywords).split(",")),
  },
  {
    id: "git-gutter",
    name: "Git Gutter",
    description: "Added, modified and deleted lines marked in the gutter against HEAD.",
    category: "Git",
    icon: "GitBranch",
    color: "#f14e32",
    version: "1.0.0",
    defaultEnabled: true,
    editor: ({ bufferId }) => gitGutter(bufferId),
  },
  {
    id: "auto-close",
    name: "Auto Close Brackets",
    description: "Types the closing bracket or quote for you and steps over it.",
    category: "Editing",
    icon: "Braces",
    color: "#82aaff",
    version: "6.20.0",
    defaultEnabled: true,
    editor: () => [closeBrackets(), keymap.of(closeBracketsKeymap)],
  },
  {
    id: "autocomplete",
    name: "IntelliSense Lite",
    description: "Completions in every language: definitions from the file and the whole project, keywords, builtins, snippets and words.",
    details: [
      "Functions, classes, types and constants from every file in the project",
      "Keywords, builtins and snippets for Rust, Go, C/C++, Java, C#, Kotlin, Swift, PHP, Ruby, Lua, Shell, PowerShell and more",
      "Signature and doc comment next to the selected item",
      "Quiet inside strings and comments",
    ],
    category: "Editing",
    icon: "Sparkles",
    color: "#c792ea",
    version: "7.0.0",
    defaultEnabled: true,
    settings: [
      { key: "onTyping", label: "Suggest while typing", type: "boolean", default: true },
      { key: "project", label: "Include symbols from other files", type: "boolean", default: true },
      { key: "snippets", label: "Snippets", type: "boolean", default: true },
      { key: "anyWord", label: "Include words from the file", type: "boolean", default: true },
      { key: "delay", label: "Delay before suggesting (ms)", type: "number", default: 60, min: 0, max: 1000, step: 20 },
      { key: "maxOptions", label: "Maximum suggestions", type: "number", default: 80, min: 10, max: 300, step: 10 },
    ],
    editor: ({ settings, langId, path }) => {
      // One source per buffer: CodeMirror tracks running queries by function identity.
      const source = universalCompletion({
        langId,
        path,
        anyWord: settings.anyWord as boolean,
        project: settings.project as boolean,
        snippets: settings.snippets as boolean,
      });
      return [
        autocompletion({
          activateOnTyping: settings.onTyping as boolean,
          activateOnTypingDelay: settings.delay as number,
          maxRenderedOptions: settings.maxOptions as number,
          icons: true,
        }),
        Prec.high(keymap.of(completionKeymap)),
        EditorState.languageData.of(() => [{ autocomplete: source }]),
      ];
    },
  },
  {
    id: "code-navigation",
    name: "Code Navigation",
    description: "Hover cards with signatures and docs; Ctrl+click or F12 jumps to the definition — in this file, another file or an imported path.",
    details: [
      "Ctrl+click (⌘+click on macOS) a name to go to its definition, F12 from the keyboard",
      "Alt+← goes back to where you were",
      "Hover a name to see its signature, doc comment and where it is defined",
      "Shift+F12 finds every use across the project",
      "Extra cursors moved to Alt+click",
    ],
    category: "Editing",
    icon: "Compass",
    color: "#82aaff",
    version: "1.0.0",
    defaultEnabled: true,
    commands: ["editor.goToDefinition", "editor.goBack", "editor.findReferences"],
    settings: [
      { key: "hover", label: "Hover cards", type: "boolean", default: true },
      { key: "ctrlClick", label: "Ctrl+click to go to definition", type: "boolean", default: true },
    ],
    editor: ({ settings }) => [settings.hover ? hoverCards() : [], settings.ctrlClick ? ctrlClickNavigation() : []],
  },
  {
    id: "selection-highlight",
    name: "Selection Highlight",
    description: "Highlights other occurrences of the selected word.",
    category: "Visual",
    icon: "Target",
    color: "#7fdbca",
    version: "6.7.0",
    defaultEnabled: true,
    editor: () => highlightSelectionMatches({ minSelectionLength: 2 }),
  },
  {
    id: "folding",
    name: "Code Folding",
    description: "Fold arrows in the gutter; Ctrl+Shift+[ and ] fold and unfold.",
    category: "Editing",
    icon: "Layers",
    color: "#9ccfd8",
    version: "6.13.0",
    defaultEnabled: true,
    editor: () => [
      codeFolding(),
      foldGutter({
        markerDOM: (open) => {
          const s = document.createElement("span");
          s.textContent = open ? "⌄" : "›";
          s.style.cssText = "display:inline-block;width:12px;text-align:center;";
          return s;
        },
      }),
      keymap.of(foldKeymap),
    ],
  },
  {
    id: "trailing-whitespace",
    name: "Trailing Whitespace",
    description: "Marks spaces and tabs at the end of lines.",
    category: "Visual",
    icon: "Pilcrow",
    color: "#f85149",
    version: "1.0.0",
    defaultEnabled: false,
    editor: () => highlightTrailingWhitespace(),
  },
  {
    id: "smooth-caret",
    name: "Smooth Caret",
    description: "The cursor glides between positions instead of jumping.",
    category: "Visual",
    icon: "WandSparkles",
    color: "#36f9f6",
    version: "1.0.0",
    defaultEnabled: true,
    editor: () => EditorView.editorAttributes.of({ class: "nox-smooth-caret" }),
  },
  {
    id: "json-lint",
    name: "JSON Validator",
    description: "Underlines JSON syntax errors as you type.",
    category: "Editing",
    icon: "ShieldCheck",
    color: "#cbcb41",
    version: "1.0.0",
    defaultEnabled: true,
    editor: ({ langId }) => {
      if (langId !== "json") return [];
      return [
        lintGutter(),
        linter(async (view) => {
          const { jsonParseLinter } = await import("@codemirror/lang-json");
          return jsonParseLinter()(view);
        }),
      ];
    },
  },
  {
    id: "syntax-errors",
    name: "Errors & Problems",
    description: "Underlines syntax errors as you type, and real code errors from the project's own checker — tsc, cargo check, go vet, ruff — after every save.",
    details: [
      "Syntax: TypeScript, JavaScript, Python, Rust, Go, C/C++, Java, PHP, HTML, CSS, XML, YAML from the language's parser; other languages get a bracket check",
      "Code errors (types, unknown names, unused imports…) from the project's tools: TypeScript (tsconfig + node_modules), Rust (Cargo.toml), Go (go.mod), C# (.sln / .csproj via dotnet build), Python (ruff or pyflakes)",
      "The error count in the status bar lists every problem in the project; F8 jumps to the next one in the file",
    ],
    category: "Editing",
    icon: "ShieldAlert",
    color: "#f07178",
    version: "1.1.0",
    defaultEnabled: true,
    commands: ["problems.show", "problems.run"],
    settings: [
      { key: "projectChecks", label: "Run the project's checker after saving", type: "boolean", default: true },
      { key: "delay", label: "Syntax check after typing pause (ms)", type: "number", default: 300, min: 100, max: 5000, step: 100 },
    ],
    editor: ({ langId, path, settings }) => {
      if (settings.projectChecks) ensureChecksStarted();
      const diagnostics = (state: EditorState) => [...syntaxDiagnostics(state, langId, path), ...(settings.projectChecks ? problemDiagnostics(state, path) : [])];
      return [
        lintGutter(),
        linter((view) => diagnostics(view.state), {
          delay: Number(settings.delay) || 300,
          // Re-check once the lazily loaded parser has produced a tree.
          needsRefresh: (u) => syntaxTree(u.startState) !== syntaxTree(u.state),
        }),
        // New results from the checker show up at once — not after another
        // lint delay, and without waiting for an edit.
        ViewPlugin.define((view) => {
          const off = onProblemsChange(() => view.dispatch(setDiagnostics(view.state, diagnostics(view.state))));
          return { destroy: off };
        }),
      ];
    },
  },
  {
    id: "spellcheck",
    name: "Spell Checker",
    description: "System spell checking in Markdown and plain-text files.",
    category: "Editing",
    icon: "BookOpen",
    color: "#519aba",
    version: "1.0.0",
    defaultEnabled: false,
    editor: ({ langId }) =>
      langId === "markdown" || langId === "plaintext" ? EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on" }) : [],
  },
  {
    id: "prettier",
    name: "Prettier",
    description: "Opinionated formatter for JS, TS, JSON, CSS, HTML, Markdown and YAML.",
    details: ["Format Document — Shift+Alt+F", "Optional format on save"],
    category: "Formatting",
    icon: "Paintbrush",
    color: "#c596c7",
    version: "3.x",
    defaultEnabled: true,
    commands: ["editor.format"],
    settings: [
      { key: "formatOnSave", label: "Format on save", type: "boolean", default: false },
      { key: "printWidth", label: "Print width", type: "number", default: 100, min: 40, max: 200 },
      { key: "semi", label: "Semicolons", type: "boolean", default: true },
      { key: "singleQuote", label: "Single quotes", type: "boolean", default: false },
      {
        key: "trailingComma",
        label: "Trailing commas",
        type: "select",
        default: "all",
        options: [
          { value: "all", label: "All" },
          { value: "es5", label: "ES5" },
          { value: "none", label: "None" },
        ],
      },
    ],
  },
  {
    id: "markdown-preview",
    name: "Markdown Preview",
    description: "Live rendered preview of Markdown files, side by side.",
    category: "Previews",
    icon: "Eye",
    color: "#519aba",
    version: "1.0.0",
    defaultEnabled: true,
    commands: ["markdown.preview"],
  },
  {
    id: "image-preview",
    name: "Image Preview",
    description: "Opens PNG, JPG, GIF and WebP files as images with zoom.",
    category: "Previews",
    icon: "Image",
    color: "#a074c4",
    version: "1.0.0",
    defaultEnabled: true,
  },
  {
    id: "word-count",
    name: "Word Count",
    description: "Live word count in the status bar for Markdown and text.",
    category: "Productivity",
    icon: "Type",
    color: "#8bc34a",
    version: "1.0.0",
    defaultEnabled: true,
  },
  {
    id: "text-tools",
    name: "Text Power Tools",
    description: "Sort, dedupe, reverse and change the case of lines; insert timestamps and UUIDs.",
    category: "Productivity",
    icon: "Wrench",
    color: "#ffb74d",
    version: "1.0.0",
    defaultEnabled: true,
    commands: ["text.sortLines", "text.uniqueLines", "text.reverseLines", "text.upper", "text.lower", "text.title", "text.timestamp", "text.uuid", "text.lorem"],
  },
  {
    id: "zen-mode",
    name: "Zen Mode",
    description: "Hides everything but the code. Escape or Ctrl+Alt+Z to leave.",
    category: "Productivity",
    icon: "Moon",
    color: "#b388ff",
    version: "1.0.0",
    defaultEnabled: true,
    commands: ["view.zen"],
    settings: [{ key: "width", label: "Centered width (px)", type: "number", default: 900, min: 500, max: 1600, step: 50 }],
  },
];

const LANGUAGE_EXTS: NoxExtension[] = LANGUAGES.map((l) => ({
  id: `lang-${l.id}`,
  name: l.name,
  description: `Syntax highlighting, indentation and folding for ${l.name}` + (l.prettier ? " · formatter support" : "") + ".",
  details: [`Files: ${l.extensions.map((e) => "." + e).join(", ")}${l.filenames ? ", " + l.filenames.join(", ") : ""}`],
  category: "Languages" as const,
  icon: "CodeXml",
  color: "#7aa2f7",
  version: "6.x",
  defaultEnabled: true,
}));

export const EXTENSIONS: NoxExtension[] = [...CORE, ...LANGUAGE_EXTS];
export const EXT_CATEGORIES: ExtCategory[] = ["Editing", "Visual", "Formatting", "Git", "Productivity", "Keymaps", "Previews", "Languages"];

export const extById = (id: string) => EXTENSIONS.find((e) => e.id === id);

export function isExtEnabled(id: string, s: Pick<SettingsState, "extEnabled"> = useSettings.getState()): boolean {
  const ext = extById(id);
  if (!ext) return false;
  return s.extEnabled[id] ?? ext.defaultEnabled;
}

export function extSettings(id: string, s: Pick<SettingsState, "extSettings"> = useSettings.getState()): Record<string, unknown> {
  const ext = extById(id);
  const out: Record<string, unknown> = {};
  for (const def of ext?.settings ?? []) out[def.key] = s.extSettings[id]?.[def.key] ?? def.default;
  return out;
}

/** All CodeMirror extensions the enabled built-ins contribute for one buffer. */
export function editorExtensionsFor(
  ctx: Omit<ExtContext, "settings">,
  s: Pick<SettingsState, "extEnabled" | "extSettings"> = useSettings.getState(),
): Extension[] {
  const out: Extension[] = [intelContext.of({ bufferId: ctx.bufferId, langId: ctx.langId, path: ctx.path })];
  for (const ext of CORE) {
    if (!ext.editor || !isExtEnabled(ext.id, s)) continue;
    try {
      out.push(ext.editor({ ...ctx, settings: extSettings(ext.id, s) }));
    } catch (e) {
      console.error(`Extension ${ext.id} failed`, e);
    }
  }
  return out;
}

// Project checks follow the extension's switch and its "projectChecks" setting.
setProblemsEnabled(() => isExtEnabled("syntax-errors") && extSettings("syntax-errors").projectChecks !== false);
