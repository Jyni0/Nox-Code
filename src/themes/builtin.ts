import type { SyntaxToken, Theme, UiToken } from "./types";

type Palette = Omit<Record<UiToken, string>, "bg-editor" | "accent-fg" | "diff-mod"> &
  Partial<Pick<Record<UiToken, string>, "bg-editor" | "accent-fg" | "diff-mod">>;

function theme(
  id: string,
  name: string,
  kind: "dark" | "light",
  ui: Palette,
  syntax: Omit<Record<SyntaxToken, string>, "invalid"> & { invalid?: string },
  extra: Partial<Theme> = {},
): Theme {
  return {
    id,
    name,
    kind,
    builtin: true,
    author: "Nox Code",
    ui: {
      ...ui,
      "bg-editor": ui["bg-editor"] ?? ui["bg-app"],
      "accent-fg": ui["accent-fg"] ?? "#ffffff",
      "diff-mod": ui["diff-mod"] ?? (kind === "dark" ? "#d29922" : "#9a6700"),
    },
    editor: {},
    syntax: { ...syntax, invalid: syntax.invalid ?? ui["diff-del"] },
    italicComments: true,
    ...extra,
  };
}

/** Singularity's palettes plus a few of our own, with full syntax colors. */
export const BUILTIN_THEMES: Theme[] = [
  theme(
    "nox-dark",
    "Nox Dark",
    "dark",
    {
      "bg-app": "#101010", "bg-sidebar": "#181818", "bg-titlebar": "#181818", "bg-surface": "#1c1c1c", "bg-input": "#212124",
      "bg-elevated": "#2a2a2e", border: "rgba(255,255,255,0.08)", "border-soft": "rgba(255,255,255,0.06)", "text-main": "#e4e4e7",
      "text-muted": "#8a8a90", "text-dim": "#6e6e74", accent: "#388bfd", "accent-hover": "#4c97ff", "diff-add": "#3fb950", "diff-del": "#f85149",
      "hover-bg": "rgba(255,255,255,0.06)", "row-solid": "#181818", "row-solid-hover": "#242424",
    },
    {
      keyword: "#c792ea", string: "#a3d977", comment: "#62626b", function: "#82aaff", variable: "#e4e4e7", property: "#7fdbca",
      type: "#ffcb6b", number: "#f78c6c", constant: "#ff9e64", operator: "#89ddff", punctuation: "#8b8b93", tag: "#f07178",
      attribute: "#ffcb6b", regexp: "#89ddff", heading: "#82aaff", link: "#7fdbca", meta: "#c792ea",
    },
    { description: "The default — Singularity's soft dark." },
  ),
  theme(
    "nox-light",
    "Nox Light",
    "light",
    {
      "bg-app": "#f8f9fa", "bg-sidebar": "#f1f3f5", "bg-titlebar": "#f1f3f5", "bg-surface": "#ffffff", "bg-input": "#e9ecef",
      "bg-elevated": "#dee2e6", border: "rgba(0,0,0,0.12)", "border-soft": "rgba(0,0,0,0.08)", "text-main": "#1a1a1a", "text-muted": "#495057",
      "text-dim": "#6c757d", accent: "#0969da", "accent-hover": "#0a58ca", "diff-add": "#1a7f37", "diff-del": "#cf222e",
      "hover-bg": "rgba(0,0,0,0.05)", "row-solid": "#f1f3f5", "row-solid-hover": "#e5e7e9", "bg-editor": "#ffffff",
    },
    {
      keyword: "#8250df", string: "#0a7f3f", comment: "#8c959f", function: "#0550ae", variable: "#1a1a1a", property: "#0b6e99",
      type: "#953800", number: "#b35900", constant: "#cf222e", operator: "#0550ae", punctuation: "#57606a", tag: "#116329",
      attribute: "#953800", regexp: "#0a3069", heading: "#0550ae", link: "#0969da", meta: "#8250df",
    },
  ),
  theme(
    "event-horizon",
    "Event Horizon",
    "dark",
    {
      "bg-app": "#07070a", "bg-sidebar": "#0d0d12", "bg-titlebar": "#0d0d12", "bg-surface": "#13131a", "bg-input": "#18181f",
      "bg-elevated": "#24242e", border: "rgba(255,170,110,0.10)", "border-soft": "rgba(255,170,110,0.06)", "text-main": "#ece7e1",
      "text-muted": "#9a9289", "text-dim": "#625c56", accent: "#ff8a3d", "accent-hover": "#ff9d5c", "accent-fg": "#160a02",
      "diff-add": "#9ccc65", "diff-del": "#ff5c57", "hover-bg": "rgba(255,138,61,0.08)", "row-solid": "#0d0d12", "row-solid-hover": "#1b1712",
    },
    {
      keyword: "#ff8a3d", string: "#ffd27a", comment: "#55505a", function: "#8ab4ff", variable: "#ece7e1", property: "#f6c177",
      type: "#ff6b6b", number: "#ffa657", constant: "#ff6b6b", operator: "#c9a26b", punctuation: "#8a8279", tag: "#ff8a3d",
      attribute: "#ffd27a", regexp: "#ff6b6b", heading: "#ff8a3d", link: "#ffd27a", meta: "#c792ea",
    },
    { description: "Light bends around an accretion disk." },
  ),
  theme(
    "nebula",
    "Nebula",
    "dark",
    {
      "bg-app": "#0d0b1a", "bg-sidebar": "#13102a", "bg-titlebar": "#13102a", "bg-surface": "#18143a", "bg-input": "#1f1a3d",
      "bg-elevated": "#2a2350", border: "rgba(179,136,255,0.14)", "border-soft": "rgba(179,136,255,0.08)", "text-main": "#ece8ff",
      "text-muted": "#a59cc9", "text-dim": "#6e6596", accent: "#b388ff", "accent-hover": "#c4a2ff", "accent-fg": "#140c2a",
      "diff-add": "#7ef5d4", "diff-del": "#ff6b9a", "hover-bg": "rgba(179,136,255,0.10)", "row-solid": "#13102a", "row-solid-hover": "#221c45",
    },
    {
      keyword: "#ff79e1", string: "#7ef5d4", comment: "#5d5684", function: "#8ab4ff", variable: "#ece8ff", property: "#c3a6ff",
      type: "#ffd580", number: "#ff9e7a", constant: "#ff9e7a", operator: "#ff79e1", punctuation: "#a59cc9", tag: "#ff79e1",
      attribute: "#ffd580", regexp: "#7ef5d4", heading: "#b388ff", link: "#7ef5d4", meta: "#ffd580",
    },
    { description: "Star-forming clouds in violet and teal." },
  ),
  theme(
    "aurora",
    "Aurora",
    "dark",
    {
      "bg-app": "#0a1214", "bg-sidebar": "#0f1a1d", "bg-titlebar": "#0f1a1d", "bg-surface": "#132024", "bg-input": "#182a2f",
      "bg-elevated": "#21373d", border: "rgba(94,234,212,0.12)", "border-soft": "rgba(94,234,212,0.07)", "text-main": "#e2f1ee",
      "text-muted": "#8fb3ad", "text-dim": "#5b7a75", accent: "#2dd4bf", "accent-hover": "#5eead4", "accent-fg": "#04201c",
      "diff-add": "#4ade80", "diff-del": "#fb7185", "hover-bg": "rgba(94,234,212,0.08)", "row-solid": "#0f1a1d", "row-solid-hover": "#18292d",
    },
    {
      keyword: "#5eead4", string: "#a3e635", comment: "#4b6b66", function: "#67e8f9", variable: "#e2f1ee", property: "#86efac",
      type: "#fcd34d", number: "#f9a8d4", constant: "#f9a8d4", operator: "#5eead4", punctuation: "#8fb3ad", tag: "#4ade80",
      attribute: "#fcd34d", regexp: "#c4b5fd", heading: "#67e8f9", link: "#5eead4", meta: "#c4b5fd",
    },
    { description: "Polar lights over a frozen sea." },
  ),
  theme(
    "photon",
    "Photon",
    "light",
    {
      "bg-app": "#f4f2ec", "bg-sidebar": "#eceae3", "bg-titlebar": "#eceae3", "bg-surface": "#ffffff", "bg-input": "#e4e1d8",
      "bg-elevated": "#d9d6cb", border: "rgba(60,50,30,0.14)", "border-soft": "rgba(60,50,30,0.08)", "text-main": "#2b2a27",
      "text-muted": "#5f5d57", "text-dim": "#8f8c84", accent: "#e8590c", "accent-hover": "#d9480f", "diff-add": "#2b8a3e",
      "diff-del": "#c92a2a", "hover-bg": "rgba(60,50,30,0.06)", "row-solid": "#eceae3", "row-solid-hover": "#e2dfd6", "bg-editor": "#fbfaf6",
    },
    {
      keyword: "#c2410c", string: "#2b8a3e", comment: "#a29d92", function: "#1c64b4", variable: "#2b2a27", property: "#0b7285",
      type: "#9c36b5", number: "#d9480f", constant: "#c92a2a", operator: "#5f5d57", punctuation: "#7c786f", tag: "#c2410c",
      attribute: "#9c36b5", regexp: "#0b7285", heading: "#1c64b4", link: "#e8590c", meta: "#9c36b5",
    },
    { description: "Warm paper, sharp ink." },
  ),
  theme(
    "slate",
    "Slate",
    "dark",
    {
      "bg-app": "#0f172a", "bg-sidebar": "#0b1120", "bg-titlebar": "#0b1120", "bg-surface": "#1e293b", "bg-input": "#1e293b",
      "bg-elevated": "#334155", border: "rgba(255,255,255,0.10)", "border-soft": "rgba(255,255,255,0.06)", "text-main": "#f8fafc",
      "text-muted": "#94a3b8", "text-dim": "#64748b", accent: "#0ea5e9", "accent-hover": "#38bdf8", "diff-add": "#10b981", "diff-del": "#f43f5e",
      "hover-bg": "rgba(255,255,255,0.06)", "row-solid": "#0b1120", "row-solid-hover": "#1a2131",
    },
    {
      keyword: "#c084fc", string: "#86efac", comment: "#64748b", function: "#38bdf8", variable: "#f8fafc", property: "#7dd3fc",
      type: "#fbbf24", number: "#fb923c", constant: "#f472b6", operator: "#94a3b8", punctuation: "#94a3b8", tag: "#f472b6",
      attribute: "#fbbf24", regexp: "#2dd4bf", heading: "#38bdf8", link: "#2dd4bf", meta: "#c084fc",
    },
  ),
  theme(
    "amoled",
    "AMOLED",
    "dark",
    {
      "bg-app": "#000000", "bg-sidebar": "#050505", "bg-titlebar": "#050505", "bg-surface": "#111111", "bg-input": "#161616",
      "bg-elevated": "#222222", border: "rgba(255,255,255,0.10)", "border-soft": "rgba(255,255,255,0.05)", "text-main": "#ededed",
      "text-muted": "#8a8a8a", "text-dim": "#5f5f5f", accent: "#3b82f6", "accent-hover": "#60a5fa", "diff-add": "#22c55e", "diff-del": "#ef4444",
      "hover-bg": "rgba(255,255,255,0.07)", "row-solid": "#050505", "row-solid-hover": "#171717",
    },
    {
      keyword: "#d19bff", string: "#b5e890", comment: "#5a5a5a", function: "#8fb8ff", variable: "#ededed", property: "#8ee6d4",
      type: "#ffd479", number: "#ff9a76", constant: "#ffaf7a", operator: "#95e1ff", punctuation: "#8a8a8a", tag: "#ff7f8f",
      attribute: "#ffd479", regexp: "#95e1ff", heading: "#8fb8ff", link: "#8ee6d4", meta: "#d19bff",
    },
  ),
  theme(
    "vibe",
    "Vibe",
    "dark",
    {
      "bg-app": "#12081f", "bg-sidebar": "#1a0b2e", "bg-titlebar": "#1a0b2e", "bg-surface": "#221039", "bg-input": "#2c1548",
      "bg-elevated": "#3a1d5c", border: "rgba(255,90,197,0.18)", "border-soft": "rgba(255,90,197,0.10)", "text-main": "#f5e9ff",
      "text-muted": "#b497d6", "text-dim": "#8b6fb0", accent: "#ff5ac5", "accent-hover": "#ff7ad1", "diff-add": "#3df5c2", "diff-del": "#ff4d6d",
      "hover-bg": "rgba(255,90,197,0.10)", "row-solid": "#1a0b2e", "row-solid-hover": "#2c1548",
    },
    {
      keyword: "#ff5ac5", string: "#3df5c2", comment: "#7a5fa0", function: "#36f9f6", variable: "#f5e9ff", property: "#fede5d",
      type: "#fede5d", number: "#f97e72", constant: "#ff8b39", operator: "#ff5ac5", punctuation: "#b497d6", tag: "#ff5ac5",
      attribute: "#fede5d", regexp: "#3df5c2", heading: "#36f9f6", link: "#36f9f6", meta: "#ff8b39",
    },
  ),
  theme(
    "one-dark-pro",
    "One Dark Pro",
    "dark",
    {
      "bg-app": "#21252b", "bg-sidebar": "#21252b", "bg-titlebar": "#21252b", "bg-surface": "#282c34", "bg-input": "#2c313a",
      "bg-elevated": "#333842", border: "rgba(255,255,255,0.08)", "border-soft": "rgba(255,255,255,0.05)", "text-main": "#d7dae0",
      "text-muted": "#9da5b4", "text-dim": "#6b717d", accent: "#61afef", "accent-hover": "#74baf2", "accent-fg": "#10161d", "diff-add": "#98c379",
      "diff-del": "#e06c75", "hover-bg": "rgba(255,255,255,0.06)", "row-solid": "#21252b", "row-solid-hover": "#2c313a", "bg-editor": "#282c34",
    },
    {
      keyword: "#c678dd", string: "#98c379", comment: "#5c6370", function: "#61afef", variable: "#e06c75", property: "#e06c75",
      type: "#e5c07b", number: "#d19a66", constant: "#d19a66", operator: "#56b6c2", punctuation: "#abb2bf", tag: "#e06c75",
      attribute: "#d19a66", regexp: "#56b6c2", heading: "#e06c75", link: "#61afef", meta: "#c678dd",
    },
  ),
  theme(
    "dracula",
    "Dracula",
    "dark",
    {
      "bg-app": "#21222c", "bg-sidebar": "#21222c", "bg-titlebar": "#21222c", "bg-surface": "#2d2f3c", "bg-input": "#343746",
      "bg-elevated": "#44475a", border: "rgba(248,248,242,0.10)", "border-soft": "rgba(248,248,242,0.06)", "text-main": "#f8f8f2",
      "text-muted": "#bfc7d5", "text-dim": "#6272a4", accent: "#bd93f9", "accent-hover": "#caa6fa", "accent-fg": "#191a21", "diff-add": "#50fa7b",
      "diff-del": "#ff5555", "diff-mod": "#ffb86c", "hover-bg": "rgba(189,147,249,0.10)", "row-solid": "#21222c", "row-solid-hover": "#343746", "bg-editor": "#282a36",
    },
    {
      keyword: "#ff79c6", string: "#f1fa8c", comment: "#6272a4", function: "#50fa7b", variable: "#f8f8f2", property: "#8be9fd",
      type: "#8be9fd", number: "#bd93f9", constant: "#bd93f9", operator: "#ff79c6", punctuation: "#f8f8f2", tag: "#ff79c6",
      attribute: "#50fa7b", regexp: "#ff5555", heading: "#bd93f9", link: "#8be9fd", meta: "#ffb86c",
    },
  ),
  theme(
    "github-dark",
    "GitHub Dark",
    "dark",
    {
      "bg-app": "#010409", "bg-sidebar": "#010409", "bg-titlebar": "#010409", "bg-surface": "#161b22", "bg-input": "#161b22",
      "bg-elevated": "#21262d", border: "rgba(240,246,252,0.10)", "border-soft": "rgba(240,246,252,0.06)", "text-main": "#e6edf3",
      "text-muted": "#9198a1", "text-dim": "#6e7681", accent: "#2f81f7", "accent-hover": "#4493f8", "diff-add": "#3fb950", "diff-del": "#f85149",
      "hover-bg": "rgba(240,246,252,0.06)", "row-solid": "#010409", "row-solid-hover": "#161b22", "bg-editor": "#0d1117",
    },
    {
      keyword: "#ff7b72", string: "#a5d6ff", comment: "#8b949e", function: "#d2a8ff", variable: "#e6edf3", property: "#79c0ff",
      type: "#ffa657", number: "#79c0ff", constant: "#79c0ff", operator: "#ff7b72", punctuation: "#e6edf3", tag: "#7ee787",
      attribute: "#79c0ff", regexp: "#a5d6ff", heading: "#79c0ff", link: "#a5d6ff", meta: "#d2a8ff",
    },
    { italicComments: false },
  ),
  theme(
    "github-light",
    "GitHub Light",
    "light",
    {
      "bg-app": "#f6f8fa", "bg-sidebar": "#f6f8fa", "bg-titlebar": "#f6f8fa", "bg-surface": "#ffffff", "bg-input": "#eff2f5",
      "bg-elevated": "#e1e6eb", border: "rgba(31,35,40,0.15)", "border-soft": "rgba(31,35,40,0.08)", "text-main": "#1f2328",
      "text-muted": "#59636e", "text-dim": "#818b98", accent: "#0969da", "accent-hover": "#0550ae", "diff-add": "#1a7f37", "diff-del": "#cf222e",
      "hover-bg": "rgba(31,35,40,0.05)", "row-solid": "#f6f8fa", "row-solid-hover": "#eaeef2", "bg-editor": "#ffffff",
    },
    {
      keyword: "#cf222e", string: "#0a3069", comment: "#6e7781", function: "#8250df", variable: "#1f2328", property: "#0550ae",
      type: "#953800", number: "#0550ae", constant: "#0550ae", operator: "#cf222e", punctuation: "#1f2328", tag: "#116329",
      attribute: "#0550ae", regexp: "#0a3069", heading: "#0550ae", link: "#0a3069", meta: "#8250df",
    },
    { italicComments: false },
  ),
  theme(
    "tokyo-night",
    "Tokyo Night",
    "dark",
    {
      "bg-app": "#16161e", "bg-sidebar": "#16161e", "bg-titlebar": "#16161e", "bg-surface": "#1f2335", "bg-input": "#1f2335",
      "bg-elevated": "#292e42", border: "rgba(192,202,245,0.10)", "border-soft": "rgba(192,202,245,0.06)", "text-main": "#c0caf5",
      "text-muted": "#9aa5ce", "text-dim": "#565f89", accent: "#7aa2f7", "accent-hover": "#8db0f8", "accent-fg": "#11131c", "diff-add": "#9ece6a",
      "diff-del": "#f7768e", "diff-mod": "#e0af68", "hover-bg": "rgba(122,162,247,0.10)", "row-solid": "#16161e", "row-solid-hover": "#1f2335", "bg-editor": "#1a1b26",
    },
    {
      keyword: "#bb9af7", string: "#9ece6a", comment: "#565f89", function: "#7aa2f7", variable: "#c0caf5", property: "#73daca",
      type: "#2ac3de", number: "#ff9e64", constant: "#ff9e64", operator: "#89ddff", punctuation: "#9abdf5", tag: "#f7768e",
      attribute: "#bb9af7", regexp: "#b4f9f8", heading: "#7aa2f7", link: "#73daca", meta: "#e0af68",
    },
  ),
  theme(
    "monokai-pro",
    "Monokai Pro",
    "dark",
    {
      "bg-app": "#221f22", "bg-sidebar": "#221f22", "bg-titlebar": "#221f22", "bg-surface": "#2d2a2e", "bg-input": "#363438",
      "bg-elevated": "#423f46", border: "rgba(252,246,233,0.09)", "border-soft": "rgba(252,246,233,0.05)", "text-main": "#fcfcfa",
      "text-muted": "#c1c0c0", "text-dim": "#727072", accent: "#ffd866", "accent-hover": "#ffe08a", "accent-fg": "#2d2a2e", "diff-add": "#a9dc76",
      "diff-del": "#ff6188", "diff-mod": "#fc9867", "hover-bg": "rgba(255,216,102,0.08)", "row-solid": "#221f22", "row-solid-hover": "#363438", "bg-editor": "#2d2a2e",
    },
    {
      keyword: "#ff6188", string: "#ffd866", comment: "#727072", function: "#a9dc76", variable: "#fcfcfa", property: "#78dce8",
      type: "#78dce8", number: "#ab9df2", constant: "#ab9df2", operator: "#ff6188", punctuation: "#939293", tag: "#ff6188",
      attribute: "#78dce8", regexp: "#fc9867", heading: "#ffd866", link: "#78dce8", meta: "#fc9867",
    },
  ),
  theme(
    "solarized-dark",
    "Solarized Dark",
    "dark",
    {
      "bg-app": "#00212b", "bg-sidebar": "#00212b", "bg-titlebar": "#00212b", "bg-surface": "#073642", "bg-input": "#073642",
      "bg-elevated": "#0e4150", border: "rgba(147,161,161,0.15)", "border-soft": "rgba(147,161,161,0.08)", "text-main": "#93a1a1",
      "text-muted": "#839496", "text-dim": "#586e75", accent: "#268bd2", "accent-hover": "#3a9be0", "diff-add": "#859900", "diff-del": "#dc322f",
      "diff-mod": "#b58900", "hover-bg": "rgba(147,161,161,0.08)", "row-solid": "#00212b", "row-solid-hover": "#073642", "bg-editor": "#002b36",
    },
    {
      keyword: "#859900", string: "#2aa198", comment: "#586e75", function: "#268bd2", variable: "#93a1a1", property: "#268bd2",
      type: "#b58900", number: "#d33682", constant: "#cb4b16", operator: "#859900", punctuation: "#93a1a1", tag: "#268bd2",
      attribute: "#b58900", regexp: "#dc322f", heading: "#cb4b16", link: "#6c71c4", meta: "#6c71c4",
    },
  ),
  theme(
    "solarized-light",
    "Solarized Light",
    "light",
    {
      "bg-app": "#eee8d5", "bg-sidebar": "#eee8d5", "bg-titlebar": "#eee8d5", "bg-surface": "#fdf6e3", "bg-input": "#e8e1cb",
      "bg-elevated": "#ddd6c1", border: "rgba(101,123,131,0.18)", "border-soft": "rgba(101,123,131,0.10)", "text-main": "#586e75",
      "text-muted": "#657b83", "text-dim": "#93a1a1", accent: "#268bd2", "accent-hover": "#1e77b8", "diff-add": "#859900", "diff-del": "#dc322f",
      "diff-mod": "#b58900", "hover-bg": "rgba(101,123,131,0.08)", "row-solid": "#eee8d5", "row-solid-hover": "#e4ddc8", "bg-editor": "#fdf6e3",
    },
    {
      keyword: "#859900", string: "#2aa198", comment: "#93a1a1", function: "#268bd2", variable: "#586e75", property: "#268bd2",
      type: "#b58900", number: "#d33682", constant: "#cb4b16", operator: "#859900", punctuation: "#657b83", tag: "#268bd2",
      attribute: "#b58900", regexp: "#dc322f", heading: "#cb4b16", link: "#6c71c4", meta: "#6c71c4",
    },
  ),
  theme(
    "nord",
    "Nord",
    "dark",
    {
      "bg-app": "#242933", "bg-sidebar": "#242933", "bg-titlebar": "#242933", "bg-surface": "#2e3440", "bg-input": "#3b4252",
      "bg-elevated": "#434c5e", border: "rgba(216,222,233,0.10)", "border-soft": "rgba(216,222,233,0.06)", "text-main": "#eceff4",
      "text-muted": "#d8dee9", "text-dim": "#7b88a1", accent: "#88c0d0", "accent-hover": "#8fbcbb", "accent-fg": "#2e3440", "diff-add": "#a3be8c",
      "diff-del": "#bf616a", "diff-mod": "#ebcb8b", "hover-bg": "rgba(216,222,233,0.06)", "row-solid": "#242933", "row-solid-hover": "#3b4252", "bg-editor": "#2e3440",
    },
    {
      keyword: "#81a1c1", string: "#a3be8c", comment: "#616e88", function: "#88c0d0", variable: "#d8dee9", property: "#8fbcbb",
      type: "#8fbcbb", number: "#b48ead", constant: "#b48ead", operator: "#81a1c1", punctuation: "#eceff4", tag: "#81a1c1",
      attribute: "#8fbcbb", regexp: "#ebcb8b", heading: "#88c0d0", link: "#8fbcbb", meta: "#d08770",
    },
  ),
  theme(
    "gruvbox",
    "Gruvbox Dark",
    "dark",
    {
      "bg-app": "#1d2021", "bg-sidebar": "#1d2021", "bg-titlebar": "#1d2021", "bg-surface": "#282828", "bg-input": "#32302f",
      "bg-elevated": "#3c3836", border: "rgba(235,219,178,0.10)", "border-soft": "rgba(235,219,178,0.06)", "text-main": "#ebdbb2",
      "text-muted": "#d5c4a1", "text-dim": "#928374", accent: "#fabd2f", "accent-hover": "#fbc94f", "accent-fg": "#282828", "diff-add": "#b8bb26",
      "diff-del": "#fb4934", "diff-mod": "#fe8019", "hover-bg": "rgba(235,219,178,0.07)", "row-solid": "#1d2021", "row-solid-hover": "#32302f", "bg-editor": "#282828",
    },
    {
      keyword: "#fb4934", string: "#b8bb26", comment: "#928374", function: "#fabd2f", variable: "#ebdbb2", property: "#83a598",
      type: "#fabd2f", number: "#d3869b", constant: "#d3869b", operator: "#8ec07c", punctuation: "#a89984", tag: "#fb4934",
      attribute: "#fabd2f", regexp: "#8ec07c", heading: "#83a598", link: "#83a598", meta: "#fe8019",
    },
  ),
  theme(
    "catppuccin",
    "Catppuccin Mocha",
    "dark",
    {
      "bg-app": "#11111b", "bg-sidebar": "#181825", "bg-titlebar": "#181825", "bg-surface": "#1e1e2e", "bg-input": "#27293d",
      "bg-elevated": "#313244", border: "rgba(205,214,244,0.10)", "border-soft": "rgba(205,214,244,0.06)", "text-main": "#cdd6f4",
      "text-muted": "#a6adc8", "text-dim": "#6c7086", accent: "#89b4fa", "accent-hover": "#a0c2fb", "accent-fg": "#11111b", "diff-add": "#a6e3a1",
      "diff-del": "#f38ba8", "diff-mod": "#f9e2af", "hover-bg": "rgba(137,180,250,0.09)", "row-solid": "#181825", "row-solid-hover": "#27293d", "bg-editor": "#1e1e2e",
    },
    {
      keyword: "#cba6f7", string: "#a6e3a1", comment: "#6c7086", function: "#89b4fa", variable: "#cdd6f4", property: "#b4befe",
      type: "#f9e2af", number: "#fab387", constant: "#fab387", operator: "#89dceb", punctuation: "#9399b2", tag: "#cba6f7",
      attribute: "#f9e2af", regexp: "#f5c2e7", heading: "#f38ba8", link: "#89dceb", meta: "#fab387",
    },
  ),
];

export const DEFAULT_THEME_ID = "nox-dark";
