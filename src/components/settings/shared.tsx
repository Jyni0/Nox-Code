import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { RotateCcw } from "lucide-react";
import { noxHighlight } from "@/editor/highlight";
import { isColor, toOpaqueHex } from "@/lib/color";
import type { Theme } from "@/themes/types";
import { cx } from "@/components/ui";
import { rainbowBrackets, RAINBOW_PALETTES, colorPreview } from "@/extensions/editorFeatures";

const SAMPLE = `// Nox Code theme preview
import { lightSpeed } from "./physics";

/** A particle faster than light. */
export class Nox<T extends number> {
  private readonly ratio = 1.42; // TODO: measure
  constructor(public energy: T) {}

  speed(): number {
    const c = lightSpeed();
    return this.ratio * c > 0 ? c : -1;
  }
}

const swarm = [1, 2, 3].map((e) => new Nox(e));
const glow = "#7ee7ff";
console.log(\`\${swarm.length} detected\`, /c+/g.test("ccc"));
`;

/** Read-only code sample; colors come straight from the theme variables. */
export function CodePreview({ height = 300, className }: { height?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let view: EditorView | null = null;
    let dead = false;
    void import("@codemirror/lang-javascript").then(({ javascript }) => {
      if (dead || !host.current) return;
      view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: SAMPLE,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            noxHighlight,
            javascript({ typescript: true }),
            rainbowBrackets(RAINBOW_PALETTES.classic),
            colorPreview(),
            EditorState.readOnly.of(true),
          ],
        }),
      });
    });
    return () => {
      dead = true;
      view?.destroy();
    };
  }, []);
  return <div ref={host} className={cx("overflow-hidden rounded-xl", className)} style={{ height }} />;
}

/** Swatch + hex field; `auto` tokens can be cleared back to derived values. */
export function ColorField({
  value,
  onChange,
  onReset,
  placeholder,
  label,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  onReset?: () => void;
  placeholder?: string;
  label: string;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const shown = value ?? placeholder ?? "transparent";
  return (
    <div className="flex items-center gap-1.5">
      <label
        className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--border)]"
        title={`Pick ${label}`}
        style={{
          backgroundImage: "linear-gradient(45deg, #8884 25%, transparent 25%, transparent 75%, #8884 75%), linear-gradient(45deg, #8884 25%, transparent 25%, transparent 75%, #8884 75%)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0, 4px 4px",
        }}
      >
        <span className="absolute inset-0" style={{ background: shown }} />
        <input
          type="color"
          aria-label={label}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={toOpaqueHex(shown)}
          onChange={(e) => {
            // Keep the alpha of rgba / #rrggbbaa values.
            const v = value && /^#[0-9a-f]{8}$/i.test(value) ? e.target.value + value.slice(7) : e.target.value;
            onChange(v);
          }}
        />
      </label>
      <input
        spellCheck={false}
        value={text}
        placeholder={value === undefined ? "auto" : undefined}
        className={cx(
          "h-7 w-[118px] rounded-lg border border-transparent bg-[var(--bg-input)] px-2 font-mono text-[11.5px] text-[var(--text-main)] outline-none hover:border-[var(--border)] focus:border-[var(--accent)]",
          text && !isColor(text) && "border-[var(--diff-del)]",
        )}
        onChange={(e) => {
          setText(e.target.value);
          if (isColor(e.target.value)) onChange(e.target.value.trim());
        }}
      />
      {onReset && value !== undefined && (
        <button title="Reset to automatic" className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]" onClick={onReset}>
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}

/** Miniature of a theme for gallery cards. */
export function ThemeThumb({ theme, className }: { theme: Theme; className?: string }) {
  const u = theme.ui;
  const s = theme.syntax;
  const line = (w: string, c: string, indent = 0) => <span className="block h-[5px] rounded-full" style={{ width: w, background: c, marginLeft: indent * 8 }} />;
  return (
    <div className={cx("flex h-[78px] overflow-hidden rounded-xl", className)} style={{ background: u["bg-sidebar"], boxShadow: "inset 0 0 0 1px " + u.border }}>
      <div className="flex w-[30%] flex-col gap-1.5 p-2">
        <span className="h-[6px] w-[70%] rounded-full" style={{ background: u.accent }} />
        <span className="h-[5px] w-[85%] rounded-full" style={{ background: u["text-dim"], opacity: 0.6 }} />
        <span className="h-[5px] w-[60%] rounded-full" style={{ background: u["text-dim"], opacity: 0.6 }} />
        <span className="h-[5px] w-[75%] rounded-full" style={{ background: u["text-dim"], opacity: 0.6 }} />
      </div>
      <div className="my-1.5 mr-1.5 flex flex-1 flex-col gap-[5px] rounded-lg p-2" style={{ background: u["bg-editor"] }}>
        <span className="flex gap-1">{line("22%", s.keyword)}{line("30%", s.function)}{line("12%", s.punctuation)}</span>
        <span className="flex gap-1">{line("14%", s.keyword, 1)}{line("26%", s.variable)}{line("30%", s.string)}</span>
        <span className="flex gap-1">{line("40%", s.comment, 1)}</span>
        <span className="flex gap-1">{line("18%", s.type, 1)}{line("10%", s.number)}{line("24%", s.property)}</span>
        <span className="flex gap-1">{line("10%", s.punctuation)}</span>
      </div>
    </div>
  );
}
