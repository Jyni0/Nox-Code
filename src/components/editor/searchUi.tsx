/** Pieces shared by the project search tab and the in-file find panel, so both look the same. */
import { cx } from "@/components/ui";

export function SearchToggle({ on, onClick, label, children, testId }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-testid={testId}
      // Keep focus in the query field.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md transition-colors",
        on ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent)]" : "text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]",
      )}
    >
      {children}
    </button>
  );
}

export const searchFieldCls =
  "flex h-8 min-w-0 flex-1 items-center gap-1 rounded-xl border border-transparent bg-[var(--bg-input)] pl-2.5 pr-1 transition-colors focus-within:border-[var(--accent)] hover:border-[var(--border)]";
export const searchInputCls = "h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)]";
export const searchIconBtnCls =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--text-dim)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)] disabled:opacity-40 disabled:hover:bg-transparent";
