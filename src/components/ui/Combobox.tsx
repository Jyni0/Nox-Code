import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { OverlayScroll } from "./Scroll";
import { cx, input } from "./tokens";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string[];
  icon?: React.ReactNode;
}

function SwatchDots({ colors }: { colors: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
      {colors.map((c, i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_var(--border)]" style={{ background: c }} />
      ))}
    </span>
  );
}

/** A searchable <select> in the field style, keyboard navigable. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "Nothing found",
  disabled,
  searchable = true,
  className,
  ariaLabel,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    requestAnimationFrame(() => (searchable ? inputRef.current?.focus() : listRef.current?.focus()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1))), [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[cursor];
      if (o) pick(o.value);
    }
  };

  return (
    <div ref={boxRef} className={cx("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        className={cx(input("md"), "flex items-center gap-2 text-left text-[12.5px] disabled:cursor-not-allowed", open && "border-[var(--accent)] hover:border-[var(--accent)]")}
        onClick={() => setOpen((v) => !v)}
      >
        {selected?.swatch && <SwatchDots colors={selected.swatch} />}
        {selected?.icon}
        <span className={"min-w-0 flex-1 truncate " + (selected ? "text-[var(--text-main)]" : "text-[var(--text-dim)]")}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={13} className={"shrink-0 text-[var(--text-dim)] transition-transform duration-150 " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[500] flex flex-col gap-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-popup)]"
          onKeyDown={onKeyDown}
        >
          {searchable && (
            <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--bg-input)] px-2.5">
              <Search size={12} className="shrink-0 text-[var(--text-dim)]" />
              <input
                ref={inputRef}
                className="h-full w-full bg-transparent text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)]"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
              />
              {query && (
                <button type="button" className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text-main)]" onClick={() => setQuery("")} title="Clear">
                  <X size={11} />
                </button>
              )}
            </div>
          )}
          <OverlayScroll innerRef={listRef} tabIndex={-1} role="listbox" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11.5px] text-[var(--text-dim)]">{emptyText}</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={"flex min-h-8 w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors " + (i === cursor ? "bg-[var(--hover-bg)]" : "")}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(o.value)}
                >
                  {o.swatch && <SwatchDots colors={o.swatch} />}
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate text-[var(--text-main)]">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[10.5px] text-[var(--text-dim)]">{o.hint}</span>}
                  {o.value === value && <Check size={12} className="shrink-0 text-[var(--accent)]" />}
                </button>
              ))
            )}
          </OverlayScroll>
        </div>
      )}
    </div>
  );
}
