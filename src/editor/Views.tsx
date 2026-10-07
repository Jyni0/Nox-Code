/** Non-text tab contents: diff, Markdown preview, image, binary. */
import { REVEAL_LABEL } from "@/lib/platform";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { FileWarning, Minus, Plus, RotateCcw } from "lucide-react";
import { docHub } from "./docHub";
import { noxHighlight } from "./highlight";
import { languageById } from "./languages";
import { backend } from "@/lib/backend";
import { extname, relative } from "@/lib/path";
import { useWorkspace } from "@/stores/workspace";
import type { Buffer } from "@/stores/editor";
import { Button, IconButton, Spinner } from "@/components/ui";

/* ---------------- Diff ---------------- */

export function DiffView({ buffer, path }: { buffer: Buffer | null; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [lang, setLang] = useState<Extension>([]);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const root = useWorkspace.getState().root;
    const rel = root ? relative(root, path) : null;
    if (!root || rel === null) return setBase(null);
    void backend().gitHeadContent(root, rel).then((t) => setBase(t ?? ""));
  }, [path]);

  useEffect(() => {
    const def = buffer && languageById(buffer.langId);
    if (def) void def.load().then(setLang);
  }, [buffer?.langId, buffer]);

  // Re-render the right side as the buffer changes (debounced).
  useEffect(() => {
    if (!buffer) return;
    let t: ReturnType<typeof setTimeout>;
    const un = docHub.subscribe(buffer.id, () => {
      clearTimeout(t);
      t = setTimeout(() => setRev((r) => r + 1), 400);
    });
    return () => {
      clearTimeout(t);
      un();
    };
  }, [buffer]);

  useEffect(() => {
    if (base === undefined || !host.current) return;
    const exts = [lineNumbers(), noxHighlight, lang, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const view = new MergeView({
      a: { doc: base ?? "", extensions: exts },
      b: { doc: buffer ? docHub.text(buffer.id) : "", extensions: exts },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    return () => view.destroy();
  }, [base, lang, buffer, rev]);

  if (base === undefined) return <Centered><Spinner /></Centered>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center text-[11px] text-[var(--text-dim)]">
        <span className="flex-1 px-4">HEAD</span>
        <span className="flex-1 px-4">Working Tree</span>
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto font-mono" />
    </div>
  );
}

/* ---------------- Markdown preview ---------------- */

marked.setOptions({ gfm: true, breaks: false });

export function MarkdownPreview({ buffer }: { buffer: Buffer }) {
  const [text, setText] = useState(() => docHub.text(buffer.id));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const un = docHub.subscribe(buffer.id, () => {
      clearTimeout(t);
      t = setTimeout(() => setText(docHub.text(buffer.id)), 120);
    });
    return () => {
      clearTimeout(t);
      un();
    };
  }, [buffer.id]);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return (
    <div className="h-full overflow-auto">
      <article
        className="markdown-body selectable"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest("a");
          if (a?.href && /^https?:/.test(a.getAttribute("href") ?? "")) {
            e.preventDefault();
            void backend().openUrl(a.href);
          }
        }}
      />
    </div>
  );
}

/* ---------------- Image ---------------- */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function ImageView({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSrc(null);
    setError(null);
    backend()
      .readBase64(path)
      .then((b64) => setSrc(`data:${MIME[extname(path)] ?? "image/png"};base64,${b64}`))
      .catch((e) => setError(String(e)));
  }, [path]);
  if (error) return <Centered><FileWarning size={28} className="text-[var(--text-dim)]" /><span className="text-[12px] text-[var(--text-dim)]">{error}</span></Centered>;
  if (!src) return <Centered><Spinner /></Centered>;
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
        style={{
          backgroundImage:
            "linear-gradient(45deg, var(--bg-input) 25%, transparent 25%), linear-gradient(-45deg, var(--bg-input) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg-input) 75%), linear-gradient(-45deg, transparent 75%, var(--bg-input) 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
        }}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          setZoom((z) => Math.max(0.1, Math.min(16, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ width: size ? size.w * zoom : undefined, imageRendering: zoom > 3 ? "pixelated" : "auto", maxWidth: "none" }}
          className="shadow-[var(--shadow-popup)]"
        />
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-popup)]">
        {size && <span className="px-2 font-mono text-[11px] text-[var(--text-dim)]">{size.w}×{size.h}</span>}
        <IconButton size="xs" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}>
          <Minus size={12} />
        </IconButton>
        <span className="w-12 text-center font-mono text-[11px] text-[var(--text-muted)]">{Math.round(zoom * 100)}%</span>
        <IconButton size="xs" label="Zoom in" onClick={() => setZoom((z) => Math.min(16, z * 1.25))}>
          <Plus size={12} />
        </IconButton>
        <IconButton size="xs" label="Actual size" onClick={() => setZoom(1)}>
          <RotateCcw size={12} />
        </IconButton>
      </div>
    </div>
  );
}

export function BinaryView({ path, onOpenAnyway }: { path: string; onOpenAnyway?: () => void }) {
  return (
    <Centered>
      <FileWarning size={32} className="text-[var(--text-dim)]" />
      <div className="text-[13px] text-[var(--text-main)]">This file is binary and can't be shown in the editor.</div>
      <div className="max-w-md truncate text-[12px] text-[var(--text-dim)]">{path}</div>
      {onOpenAnyway && (
        <Button size="sm" onClick={onOpenAnyway}>
          {REVEAL_LABEL}
        </Button>
      )}
    </Centered>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}
