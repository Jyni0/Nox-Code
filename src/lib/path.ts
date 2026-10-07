/** Path helpers that work with both "C:\\a\\b" and "/a/b". */

export const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/");

export function join(dir: string, ...parts: string[]): string {
  const sep = sepOf(dir);
  let out = dir.replace(/[\\/]+$/, "");
  for (const part of parts) {
    const clean = part.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]/g, sep);
    if (clean) out = out ? `${out}${sep}${clean}` : clean;
  }
  return out || sep;
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function dirname(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (i < 0) return "";
  if (i === 0) return trimmed[0];
  return trimmed.slice(0, i);
}

export function extname(p: string): string {
  const name = basename(p);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** `child` relative to `root` with forward slashes, or null when outside. */
export function relative(root: string, child: string): string | null {
  const r = norm(root);
  const c = norm(child);
  const caseless = /^[a-z]:/i.test(r);
  const eq = (a: string, b: string) => (caseless ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (eq(r, c)) return "";
  const prefix = c.slice(0, r.length + 1);
  if (!eq(prefix, r + "/")) return null;
  return c.slice(r.length + 1);
}

export const isInside = (root: string, child: string) => relative(root, child) !== null;

export function samePath(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return /^[a-z]:/i.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Rewrites `p` when it is `from` or lives under it (after a rename / move). */
export function rebase(p: string, from: string, to: string): string | null {
  const rel = relative(from, p);
  if (rel === null) return null;
  return rel === "" ? to : join(to, rel);
}
