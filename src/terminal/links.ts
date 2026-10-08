/**
 * Terminal output → links: file paths with an optional line and column (the
 * shapes compilers, linters, test runners and stack traces print) and URLs.
 * Ctrl+click (⌘ on macOS) opens them; paths are checked to exist first so
 * version numbers and domain names never turn into dead links.
 */
import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { backend } from "@/lib/backend";
import { join } from "@/lib/path";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { toast } from "@/stores/ui";

export interface TextLink {
  /** Offsets in the text, end exclusive. */
  start: number;
  end: number;
  url?: string;
  path?: string;
  line?: number;
  col?: number;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>()`]*[^\s"'<>()`.,;:!?]/g;
// Optional root (C:\, \\, /, ~/, ./, ../), directories, then a name with an extension.
const PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])?(?:[\w@$+\-.]+[\\/])*[\w@$+\-][\w@$+\-.]*\.[A-Za-z]\w{0,9}(?![\w\\/])/g;
// file:12:5 · file:12 · file(12,5) · Python's  File "x.py", line 12
const POS_RE = /^(?::(\d+)(?::(\d+))?|\((\d+)(?:[,:]\s*(\d+))?\)|"?, line (\d+)(?:, column (\d+))?)/;

export function findLinks(text: string): TextLink[] {
  const out: TextLink[] = [];
  for (const m of text.matchAll(URL_RE)) out.push({ start: m.index!, end: m.index! + m[0].length, url: m[0] });
  const inUrl = (i: number) => out.some((l) => l.url && i >= l.start && i < l.end);
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index!;
    if (inUrl(start)) continue;
    // "foo.bar" in the middle of a word or a domain-like token is not a path.
    if (start > 0 && /[\w@$.\-]/.test(text[start - 1])) continue;
    let end = start + m[0].length;
    const pos = POS_RE.exec(text.slice(end));
    let line: number | undefined;
    let col: number | undefined;
    if (pos) {
      line = Number(pos[1] ?? pos[3] ?? pos[5]);
      const c = pos[2] ?? pos[4] ?? pos[6];
      col = c ? Number(c) : undefined;
      // The quote and ", line N" of a Python trace stay plain text.
      if (pos[5] === undefined) end += pos[0].length;
    }
    out.push({ start, end, path: m[0], line, col });
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------- resolving paths ---------------- */

const isAbsolute = (p: string) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

const cache = new Map<string, { at: number; path: string | null }>();
const TTL = 10_000;

async function exists(p: string): Promise<boolean> {
  return backend()
    .exists(p)
    .catch(() => false);
}

/** Absolute path of a printed path: relative to the terminal, the project, or a unique file in it. */
async function resolvePath(raw: string, cwd: string): Promise<string | null> {
  const key = cwd + "\0" + raw;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.path;
  const root = useWorkspace.getState().root;
  let found: string | null = null;
  const clean = raw.replace(/^~[\\/]/, "");
  if (isAbsolute(raw)) found = (await exists(raw)) ? raw : null;
  else {
    for (const base of [cwd, root]) {
      if (!base) continue;
      const p = join(base, clean);
      if (await exists(p)) {
        found = p;
        break;
      }
    }
    if (!found && root) {
      // Tools often print paths relative to a sub-package; match by suffix.
      const want = clean.replace(/\\/g, "/").replace(/^\.\//, "");
      const list = await useWorkspace
        .getState()
        .getFileList()
        .catch(() => [] as string[]);
      const hits = list.filter((rel) => rel === want || rel.endsWith("/" + want));
      if (hits.length === 1) found = join(root, hits[0]);
    }
  }
  cache.set(key, { at: Date.now(), path: found });
  return found;
}

export async function openTerminalLink(l: TextLink, cwd: string): Promise<void> {
  if (l.url) return void backend().openUrl(l.url);
  if (!l.path) return;
  const p = await resolvePath(l.path, cwd);
  if (!p) return;
  await useEditor.getState().openFile(p, l.line ? { reveal: { line: l.line, col: l.col ? l.col - 1 : 0 } } : {});
}

/* ---------------- xterm glue ---------------- */

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * The logical line under buffer row `y` (1-based): wrapped rows are joined
 * so a long path that wraps stays one link.
 */
function logicalLine(term: Terminal, y: number): { text: string; firstRow: number } | null {
  const buf = term.buffer.active;
  let first = y - 1;
  while (first > 0 && buf.getLine(first)?.isWrapped) first--;
  let last = y - 1;
  while (buf.getLine(last + 1)?.isWrapped) last++;
  let text = "";
  for (let r = first; r <= last; r++) {
    const line = buf.getLine(r) as IBufferLine | undefined;
    if (!line) return null;
    text += line.translateToString(r === last, 0, term.cols);
  }
  return { text, firstRow: first };
}

export function terminalLinkProvider(term: Terminal, cwd: () => string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const logical = logicalLine(term, y);
      if (!logical || logical.text.length > 4000) return callback(undefined);
      const found = findLinks(logical.text);
      if (!found.length) return callback(undefined);
      const cols = term.cols;
      const at = (offset: number) => ({ x: (offset % cols) + 1, y: logical.firstRow + Math.floor(offset / cols) + 1 });
      void Promise.all(
        found.map(async (l): Promise<ILink | null> => {
          if (l.path && !(await resolvePath(l.path, cwd()))) return null;
          const start = at(l.start);
          const end = at(l.end - 1);
          // Only links that touch the hovered row; xterm asks for each row.
          if (end.y < y || start.y > y) return null;
          return {
            range: { start, end },
            text: logical.text.slice(l.start, l.end),
            decorations: { underline: true, pointerCursor: true },
            activate(e) {
              if (!(isMac ? e.metaKey : e.ctrlKey)) return;
              void openTerminalLink(l, cwd());
            },
            hover() {
              term.element?.setAttribute("title", `${l.url ? "Open link" : "Open file"} (${isMac ? "⌘" : "Ctrl"}+click)`);
            },
            leave() {
              term.element?.removeAttribute("title");
            },
          };
        }),
      ).then((links) => {
        const ok = links.filter((l): l is ILink => !!l);
        callback(ok.length ? ok : undefined);
      });
    },
  };
}

/* ---------------- clipboard ---------------- */

export async function copySelection(term: Terminal): Promise<boolean> {
  const text = term.getSelection();
  if (!text) return false;
  await navigator.clipboard?.writeText(text).catch(() => {});
  return true;
}

export async function pasteInto(term: Terminal): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    toast(`Clipboard is not available — use ${isMac ? "⌘" : "Ctrl"}+V`, "warning");
    return;
  }
  if (text) term.paste(text);
}

/**
 * Ctrl+C copies when something is selected (otherwise it is the interrupt),
 * Ctrl+Shift+C always copies. Ctrl+V / Ctrl+Shift+V / Shift+Insert are left
 * to the browser: its paste event reaches xterm without a clipboard permission.
 */
export function clipboardKeys(term: Terminal): (e: KeyboardEvent) => boolean {
  return (e) => {
    if (e.type !== "keydown") return true;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "c" && (e.shiftKey || isMac || term.hasSelection())) {
      e.preventDefault();
      void copySelection(term).then((copied) => copied && !e.shiftKey && term.clearSelection());
      return false;
    }
    // Not sent to the shell as ^V; the native paste event follows.
    if ((mod && key === "v") || (e.shiftKey && key === "insert")) return false;
    return true;
  };
}
