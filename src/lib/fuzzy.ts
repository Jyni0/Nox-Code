/**
 * Fuzzy matcher for the file finder and command palette. Characters of the
 * query must appear in order; consecutive runs, word starts and the file
 * name (over the folder part) score higher.
 */

export interface FuzzyResult {
  score: number;
  /** Indices of the matched characters in the target. */
  positions: number[];
}

const isBoundary = (prev: string | undefined, ch: string) =>
  prev === undefined ||
  prev === "/" || prev === "\\" || prev === "_" || prev === "-" || prev === "." || prev === " " ||
  (prev === prev.toLowerCase() && ch !== ch.toLowerCase());

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.replace(/\s+/g, "");
  if (!q) return { score: 0, positions: [] };
  const t = target;
  const ql = q.toLowerCase();
  const tl = t.toLowerCase();

  // Fast reject: every query char must exist in order.
  let probe = 0;
  for (let i = 0; i < tl.length && probe < ql.length; i++) if (tl[i] === ql[probe]) probe++;
  if (probe < ql.length) return null;

  // Can query[qi..] still be matched starting at target index `from`?
  const fits = (from: number, qi: number) => {
    let k = qi;
    for (let i = from; i < tl.length && k < ql.length; i++) if (tl[i] === ql[k]) k++;
    return k === ql.length;
  };

  const nameStart = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1;
  // Greedy from the right-most viable start inside the file name, then fall back.
  const attempt = (from: number): FuzzyResult | null => {
    const positions: number[] = [];
    let score = 0;
    let ti = from;
    let streak = 0;
    for (let qi = 0; qi < ql.length; qi++) {
      let found = -1;
      // Prefer a boundary match for this char if one exists ahead.
      for (let j = ti; j < tl.length; j++) {
        if (tl[j] !== ql[qi]) continue;
        if (found < 0) found = j;
        if ((j === ti || isBoundary(t[j - 1], t[j])) && fits(j + 1, qi + 1)) {
          found = j;
          break;
        }
      }
      if (found < 0) return null;
      const contiguous = positions.length > 0 && found === positions[positions.length - 1] + 1;
      streak = contiguous ? streak + 1 : 0;
      score += 1 + streak * 4;
      if (isBoundary(t[found - 1], t[found])) score += 6;
      if (found >= nameStart) score += 3;
      if (t[found] === q[qi]) score += 0.5;
      positions.push(found);
      ti = found + 1;
    }
    // Shorter targets and matches that start early win ties.
    score -= (positions[0] - Math.min(from, positions[0])) * 0.05;
    score -= t.length * 0.02;
    if (tl.slice(nameStart).startsWith(ql)) score += 12;
    if (tl.slice(nameStart) === ql) score += 20;
    return { score, positions };
  };

  const a = attempt(nameStart);
  const b = attempt(0);
  if (a && b) return a.score >= b.score ? a : b;
  return a ?? b;
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 200): Array<{ item: T } & FuzzyResult> {
  const out: Array<{ item: T } & FuzzyResult> = [];
  for (const item of items) {
    const r = fuzzyMatch(query, key(item));
    if (r) out.push({ item, ...r });
  }
  if (query.trim()) out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
