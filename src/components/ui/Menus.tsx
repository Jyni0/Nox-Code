import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Kbd } from "./primitives";

export type MenuItem =
  | {
      icon?: React.ReactNode;
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Shortcut shown on the right. */
      combo?: string;
      hint?: string;
    }
  | "separator";

function Items({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={"sep" + i} className="mx-1.5 my-0.5 h-px bg-[var(--border-soft)]" />
        ) : (
          <button
            key={it.label + i}
            role="menuitem"
            disabled={it.disabled}
            className={`flex h-8 w-full shrink-0 items-center gap-2 rounded-xl px-2 text-left text-[12.5px] transition-colors hover:bg-[var(--hover-bg)] disabled:pointer-events-none disabled:opacity-40 ${
              it.danger ? "text-[var(--diff-del)]" : "text-[var(--text-main)]"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              it.onClick();
            }}
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-[var(--text-muted)]">{it.icon}</span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.combo && <Kbd combo={it.combo} className="pl-4" />}
            {it.hint && <span className="pl-4 text-[11px] text-[var(--text-dim)]">{it.hint}</span>}
          </button>
        ),
      )}
    </>
  );
}

const MENU_CLASS =
  "z-[600] flex min-w-[210px] flex-col gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-popup)]";

/** Right-click menu at a pointer position, clamped to the viewport. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!at) return;
    const w = ref.current?.offsetWidth ?? 220;
    const h = ref.current?.offsetHeight ?? items.length * 32;
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
      top: Math.max(8, at.y + h > window.innerHeight - 8 ? at.y - h : at.y),
    });
  }, [at, items.length]);

  useEffect(() => {
    if (!at) return;
    const close = () => closeRef.current();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [at]);

  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div
          ref={ref}
          role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className={MENU_CLASS}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.1, ease: "easeOut" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Items items={items} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Menu anchored to its trigger (⋯ buttons, the title bar menus). */
export function RowMenu({
  open,
  anchor,
  items,
  onClose,
  align = "right",
}: {
  open: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  items: MenuItem[];
  onClose: () => void;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? items.length * 32 + 12;
      const w = ref.current?.offsetWidth ?? 220;
      const below = r.bottom + 6;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - 6 - h);
      const left = align === "left" ? Math.min(r.left, window.innerWidth - w - 8) : Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    const raf = requestAnimationFrame(place);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, items.length, align]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className={MENU_CLASS}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          <Items items={items} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
