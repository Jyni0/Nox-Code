/** Tiny color toolkit for theme import and the theme studio. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string | undefined | null): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

export function toHex(c: RGBA, withAlpha = c.a < 1): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${withAlpha ? hex2(c.a * 255) : ""}`;
}

/** "#rrggbb" for <input type=color> (drops alpha). */
export function toOpaqueHex(input: string): string {
  const c = parseColor(input);
  return c ? toHex({ ...c, a: 1 }, false) : "#000000";
}

export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: x.a + (y.a - x.a) * t });
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return c ? toHex({ ...c, a: alpha }, true) : color;
}

/** Paints a translucent color over an opaque background. */
export function flatten(color: string, over: string): string {
  const c = parseColor(color);
  const bg = parseColor(over);
  if (!c || !bg) return color;
  return toHex({ r: bg.r + (c.r - bg.r) * c.a, g: bg.g + (c.g - bg.g) * c.a, b: bg.b + (c.b - bg.b) * c.a, a: 1 }, false);
}

export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export const isDark = (color: string) => luminance(color) < 0.4;

/** Moves a color toward white (amount > 0) or black (amount < 0). */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mix(color, "#ffffff", amount) : mix(color, "#000000", -amount);
}

/** Readable text on top of `bg`. */
export const contrastText = (bg: string) => (luminance(bg) > 0.45 ? "#111111" : "#ffffff");

export function isColor(s: string): boolean {
  return parseColor(s) !== null;
}
