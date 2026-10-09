/**
 * Error Lens: the message of every error / warning written at the end of
 * its line, and the line itself tinted — no hovering needed. Reads the same
 * diagnostics the squiggles come from (syntax errors and the project checker).
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { forEachDiagnostic, setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";

type Sev = Diagnostic["severity"];
const RANK: Record<Sev, number> = { error: 3, warning: 2, info: 1, hint: 0 };

export interface ErrorLensOptions {
  /** Lowest severity that gets a message. */
  minSeverity: Sev;
  lineBackground: boolean;
  maxLength: number;
}

class LensWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly severity: Sev,
    readonly more: number,
  ) {
    super();
  }
  eq(o: LensWidget) {
    return o.text === this.text && o.severity === this.severity && o.more === this.more;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `nox-lens-msg nox-lens-${this.severity}`;
    el.textContent = this.text + (this.more ? `  (+${this.more})` : "");
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView, o: ErrorLensOptions): DecorationSet {
  const state = view.state;
  // The most severe diagnostic per line, and how many others share it.
  const perLine = new Map<number, { d: Diagnostic; count: number }>();
  forEachDiagnostic(state, (d, from) => {
    if (RANK[d.severity] < RANK[o.minSeverity]) return;
    const line = state.doc.lineAt(Math.min(from, state.doc.length)).number;
    const cur = perLine.get(line);
    if (!cur) perLine.set(line, { d, count: 1 });
    else {
      cur.count++;
      if (RANK[d.severity] > RANK[cur.d.severity]) cur.d = d;
    }
  });
  const builder = new RangeSetBuilder<Decoration>();
  for (const n of [...perLine.keys()].sort((a, b) => a - b)) {
    const { d, count } = perLine.get(n)!;
    const line = state.doc.line(n);
    let text = d.message.split("\n")[0].trim();
    if (text.length > o.maxLength) text = text.slice(0, o.maxLength - 1) + "…";
    if (o.lineBackground) builder.add(line.from, line.from, Decoration.line({ class: `nox-lens-line nox-lens-line-${d.severity}` }));
    builder.add(line.to, line.to, Decoration.widget({ widget: new LensWidget(text, d.severity, count - 1), side: 1 }));
  }
  return builder.finish();
}

export function errorLens(o: ErrorLensOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, o);
      }
      update(u: ViewUpdate) {
        const changed = u.transactions.some((t) => t.effects.some((e) => e.is(setDiagnosticsEffect)));
        if (changed) this.decorations = build(u.view, o);
        // Until the linter reports again, keep the messages on their lines.
        else if (u.docChanged) this.decorations = this.decorations.map(u.changes);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
