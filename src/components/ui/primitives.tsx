import { forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
import { formatCombo } from "@/lib/keys";
import {
  BUTTON_BASE,
  BUTTON_VARIANT,
  CONTROL_FILL,
  CONTROL_SIZE,
  FIELD_BASE,
  FIELD_LABEL,
  INPUT_SIZE,
  TEXTAREA,
  cx,
  iconButton,
  type ButtonVariant,
  type ControlSize,
} from "./tokens";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(BUTTON_BASE, CONTROL_SIZE[size], BUTTON_VARIANT[variant], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ControlSize;
  variant?: "ghost" | "secondary";
  tone?: "default" | "danger";
  reveal?: boolean;
  active?: boolean;
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "sm", variant = "ghost", tone = "default", reveal = false, active = false, label, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        iconButton(size, variant),
        active && "bg-[var(--hover-bg)] text-[var(--text-main)]",
        tone === "danger" && "hover:bg-[color-mix(in_srgb,var(--diff-del)_15%,transparent)] hover:text-[var(--diff-del)]",
        reveal && "opacity-0 transition-all focus-visible:opacity-100 group-hover:opacity-100",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize; mono?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = "md", mono, className, spellCheck = false, ...rest }, ref) {
  return <input ref={ref} spellCheck={spellCheck} className={cx(FIELD_BASE, INPUT_SIZE[size], mono && "font-mono", className)} {...rest} />;
});

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea({ mono, className, spellCheck = false, ...rest }, ref) {
  return <textarea ref={ref} spellCheck={spellCheck} className={cx(TEXTAREA, mono && "font-mono", className)} {...rest} />;
});

export function Field({ label, hint, className, children }: { label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cx("flex min-w-0 flex-col", className)}>
      <span className={FIELD_LABEL}>{label}</span>
      {children}
      {hint && <span className="mt-1 text-[11px] leading-snug text-[var(--text-dim)]">{hint}</span>}
    </label>
  );
}

export function Switch({ on, onChange, ariaLabel = "toggle", disabled }: { on: boolean; onChange: (v: boolean) => void; ariaLabel?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--accent)]" : "bg-[var(--bg-elevated)]"}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[16px]" : "translate-x-0"}`} />
    </button>
  );
}

export type SegmentOption<T extends string> = T | { value: T; label: React.ReactNode; title?: string };

const SEG_HEIGHT: Record<ControlSize, string> = { xs: "h-6", sm: "h-7", md: "h-9" };
const SEG_INNER: Record<ControlSize, string> = { xs: "rounded-[5px]", sm: "rounded-[5px]", md: "rounded-[9px]" };
const SEG_OUTER: Record<ControlSize, string> = { xs: "rounded-lg", sm: "rounded-lg", md: "rounded-xl" };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  fill = false,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (v: T) => void;
  size?: ControlSize;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-0.5 p-[3px]", CONTROL_FILL, SEG_OUTER[size], SEG_HEIGHT[size], fill && "w-full", className)} role="radiogroup">
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o as React.ReactNode, title: undefined } : o;
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={opt.title}
            className={cx(
              "flex h-full items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[12px] transition-colors",
              SEG_INNER[size],
              fill && "flex-1",
              on ? "bg-[var(--bg-elevated)] text-[var(--text-main)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-main)]",
            )}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cx("shrink-0 animate-spin", className)} aria-label="Loading" />;
}

/** A shortcut rendered as key caps. */
export function Kbd({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-0.5", className)}>
      {formatCombo(combo).map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-[var(--bg-input)] px-1 font-mono text-[10.5px] font-medium leading-none text-[var(--text-muted)] shadow-[inset_0_-1px_0_var(--border)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function Alert({ tone = "info", children, className }: { tone?: "error" | "warning" | "info" | "success"; children: React.ReactNode; className?: string }) {
  const color = tone === "error" ? "var(--diff-del)" : tone === "warning" ? "var(--diff-mod)" : tone === "success" ? "var(--diff-add)" : "var(--accent)";
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-snug", className)}
      style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, color: tone === "info" ? "var(--text-muted)" : color }}
    >
      {children}
    </div>
  );
}
