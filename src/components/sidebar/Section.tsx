import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";

/** Singularity section header: the chevron shows on hover, actions on the right. */
export function SectionHeader({
  title,
  open,
  onToggle,
  actions,
  count,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="group mb-1 mt-3 flex h-6 shrink-0 items-center pl-1 pr-0.5">
      <button
        className="flex h-6 items-center gap-1 rounded-md text-[12px] font-medium text-[var(--text-dim)] transition-colors hover:text-[var(--text-main)]"
        onClick={onToggle}
        aria-expanded={open}
      >
        {title}
        {count !== undefined && count > 0 && <span className="ml-0.5 font-mono text-[10.5px] text-[var(--text-dim)]">{count}</span>}
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }} className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <ChevronRight size={12} strokeWidth={2} />
        </motion.span>
      </button>
      {actions && <span className="ml-auto flex items-center gap-1.5">{actions}</span>}
    </div>
  );
}

/** Small action icon in a section header. */
export function HeaderAction({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`flex items-center justify-center rounded-md p-0.5 transition-all hover:opacity-100 ${active ? "text-[var(--accent)] opacity-100" : "text-[var(--text-muted)] opacity-60"}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function Collapse({ open, children, className = "" }: { open: boolean; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={"flex shrink-0 flex-col overflow-hidden " + className}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
