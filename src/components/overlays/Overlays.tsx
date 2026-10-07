import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useUi } from "@/stores/ui";
import { Button, Modal } from "@/components/ui";

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  return (
    <AnimatePresence>
      {dialog && (
        <Modal
          title={dialog.title}
          width={440}
          onClose={() => useUi.getState().closeDialog(dialog.cancelId)}
          footer={dialog.buttons.map((b, i) => (
            <Button
              key={b.id}
              size="sm"
              autoFocus={i === 0}
              variant={b.variant === "danger" ? "danger" : b.variant === "primary" ? "primary" : "secondary"}
              onClick={() => useUi.getState().closeDialog(b.id)}
            >
              {b.label}
            </Button>
          ))}
        >
          {dialog.message && <div className="text-[13px] leading-relaxed text-[var(--text-muted)]">{dialog.message}</div>}
        </Modal>
      )}
    </AnimatePresence>
  );
}

const ICONS = { info: Info, success: CheckCircle2, error: AlertCircle, warning: TriangleAlert };
const COLORS = { info: "var(--accent)", success: "var(--diff-add)", error: "var(--diff-del)", warning: "var(--diff-mod)" };

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[800] flex w-[340px] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <motion.div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              data-testid="toast"
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.16 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5 shadow-[var(--shadow-popup)]"
            >
              <Icon size={15} className="mt-px shrink-0" style={{ color: COLORS[t.kind] }} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-[var(--text-main)]">{t.message}</div>
                {t.detail && <div className="mt-0.5 line-clamp-3 break-words text-[11.5px] text-[var(--text-dim)]">{t.detail}</div>}
              </div>
              <button className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text-main)]" onClick={() => useUi.getState().dismissToast(t.id)} title="Dismiss">
                <X size={12} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
