import { twMerge } from "tailwind-merge";

/* Design tokens — Singularity's soft UI scale.
   Controls: xs 24px · sm 28px · md 36px; controls rounded-lg/xl, cards
   rounded-xl/2xl, menus rounded-2xl, dialogs rounded-3xl. One fill
   (--bg-input) for every control, --bg-elevated on hover. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

export type ControlSize = "xs" | "sm" | "md";

export const CONTROL_FILL = "bg-[var(--bg-input)]";
export const CONTROL_FILL_HOVER = "hover:bg-[var(--bg-elevated)]";

export const CONTROL_SIZE: Record<ControlSize, string> = {
  xs: "h-6 px-2.5 text-[11.5px] gap-1 rounded-lg",
  sm: "h-7 px-3 text-[12px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-[12px] gap-1.5 rounded-xl",
};

export const ICON_SIZE: Record<ControlSize, string> = {
  xs: "h-6 w-6 rounded-lg",
  sm: "h-7 w-7 rounded-lg",
  md: "h-9 w-9 rounded-xl",
};

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

export const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]",
  secondary: `${CONTROL_FILL} text-[var(--text-main)] ${CONTROL_FILL_HOVER}`,
  ghost: "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
  danger: "bg-[var(--diff-del)] font-medium text-white hover:opacity-90",
  "danger-ghost": "text-[var(--diff-del)] hover:bg-[color-mix(in_srgb,var(--diff-del)_12%,transparent)]",
};

export const iconButton = (size: ControlSize = "sm", variant: "ghost" | "secondary" = "ghost") =>
  `inline-flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ICON_SIZE[size]} ${
    variant === "ghost"
      ? "text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
      : `${CONTROL_FILL} text-[var(--text-main)] ${CONTROL_FILL_HOVER}`
  }`;

export const FIELD_BASE = `w-full border border-transparent ${CONTROL_FILL} text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-dim)] hover:border-[var(--border)] focus:border-[var(--accent)] disabled:opacity-50`;

export const INPUT_SIZE: Record<ControlSize, string> = {
  xs: "h-6 px-2.5 text-[11.5px] rounded-lg",
  sm: "h-7 px-2.5 text-[12px] rounded-lg",
  md: "h-9 px-3 text-[12px] rounded-xl",
};

export const input = (size: ControlSize = "md") => `${FIELD_BASE} ${INPUT_SIZE[size]}`;
export const TEXTAREA = `${FIELD_BASE} resize-y rounded-xl px-3 py-2.5 text-[12px] leading-relaxed`;
export const FIELD_LABEL = "mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]";

/** Sidebar row: 32px, radius 12px. */
export const ROW = "flex h-8 shrink-0 items-center gap-2.5 rounded-xl px-2 text-left text-[13px]";
export const ROW_TEXT = "text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]";
export const ROW_HOVER = "text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]";
/** Selected rows take an accent tint, so they never read as a hover that stuck. */
export const ROW_ACTIVE = "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-main)]";

export const ROW_ICON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--row-solid-hover)] hover:text-[var(--text-main)]";

export const POPOVER =
  "z-[200] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-popup)]";

export const popoverItem = (active: boolean) =>
  "flex min-h-8 w-full shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[12.5px] transition-colors " +
  (active ? "bg-[var(--hover-bg)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]");

export const CONTROL_W = "w-[240px]";
