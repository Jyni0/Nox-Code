import { createContext, forwardRef, useContext, useEffect } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { ROW, ROW_ACTIVE, ROW_HOVER, ROW_TEXT, cx } from "./tokens";
import { IconButton } from "./primitives";

type NavItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  hovered?: boolean;
  quiet?: boolean;
  icon?: React.ReactNode;
};

/** A sidebar row (Singularity): 32px, rounded-xl, soft hover. */
export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem({ active = false, hovered = false, quiet = false, icon, className, children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(ROW, "w-full", active ? ROW_ACTIVE : hovered ? "bg-[var(--row-solid-hover)] text-[var(--text-main)]" : quiet ? ROW_TEXT : ROW_HOVER, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

/** Hover actions floating over the right end of a row. */
export function RowActions({ show, fade = true, className, children }: { show: boolean; fade?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-xl pr-1 transition-opacity duration-100",
        fade && "bg-gradient-to-l from-[var(--row-solid-hover)] via-[var(--row-solid-hover)] to-transparent pl-5",
        show ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The settings search: rows whose text does not match hide themselves. */
export const SettingsQuery = createContext("");

const textOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : "");

export function SettingRow({
  title,
  hint,
  keywords,
  children,
  id,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Extra words the settings search should find this row by. */
  keywords?: string;
  children?: React.ReactNode;
  id?: string;
}) {
  const query = useContext(SettingsQuery).trim().toLowerCase();
  if (query) {
    const hay = [textOf(title), textOf(hint), keywords ?? ""].join(" ").toLowerCase();
    if (!query.split(/\s+/).every((w) => hay.includes(w))) return null;
  }
  return (
    <div id={id} className="setting-row flex min-w-0 items-center gap-4 py-0.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[var(--text-main)]">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-dim)]">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  );
}

export function SettingsCard({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cx("settings-card flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-surface)] px-4 py-3", className)}>
      {children}
    </div>
  );
}

export const Sep = () => <div className="settings-sep h-px bg-[var(--border-soft)]" />;

export function SectionHeading({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cx("flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]", className)}>
      <span className="flex-1">{children}</span>
      {right}
    </div>
  );
}

/** Dialog shell: rounded-3xl card over a blurred backdrop. */
export function Modal({
  title,
  onClose,
  children,
  width = 480,
  footer,
  overflowVisible = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  overflowVisible?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <motion.div
      className="fixed inset-0 z-[700] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        className={cx(
          "flex max-h-[calc(100vh-48px)] flex-col rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-popup)]",
          overflowVisible ? "overflow-visible" : "overflow-hidden",
        )}
        style={{ width: `min(${width}px, calc(100vw - 48px))` }}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-5 pb-2 pt-4">
          <span className="flex-1 text-[16px] font-semibold text-[var(--text-main)]">{title}</span>
          <IconButton label="Close" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-col gap-2 px-5 pb-5 pt-1">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 pb-5">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}
