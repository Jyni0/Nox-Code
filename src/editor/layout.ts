/**
 * Editor group layout: a tree of splits. Leaves are panes (editor groups);
 * a split lays its children out in a row (side by side) or a column
 * (stacked). Pure functions — the editor store keeps the tree in sync with
 * its list of panes.
 */

export type SplitDir = "row" | "column";
export type Side = "left" | "right" | "top" | "bottom";

export interface PaneLeaf {
  kind: "pane";
  paneId: string;
}

export interface SplitNode {
  kind: "split";
  id: string;
  dir: SplitDir;
  children: LayoutNode[];
  /** Relative weights, one per child. */
  sizes: number[];
}

export type LayoutNode = PaneLeaf | SplitNode;

let seq = 0;
const splitId = () => `split-${Date.now().toString(36)}${(++seq).toString(36)}`;

export const leaf = (paneId: string): PaneLeaf => ({ kind: "pane", paneId });

const dirOf = (side: Side): SplitDir => (side === "left" || side === "right" ? "row" : "column");
const isBefore = (side: Side) => side === "left" || side === "top";

/** Pane ids in reading order: left to right, top to bottom. */
export function leafIds(node: LayoutNode): string[] {
  return node.kind === "pane" ? [node.paneId] : node.children.flatMap(leafIds);
}

/** Puts `newId` next to `targetId` on `side`. */
export function insertLeaf(node: LayoutNode, targetId: string, newId: string, side: Side): LayoutNode {
  const dir = dirOf(side);
  const fresh = leaf(newId);
  if (node.kind === "pane") {
    if (node.paneId !== targetId) return node;
    return { kind: "split", id: splitId(), dir, children: isBefore(side) ? [fresh, node] : [node, fresh], sizes: [1, 1] };
  }
  const i = node.children.findIndex((c) => c.kind === "pane" && c.paneId === targetId);
  if (i >= 0 && node.dir === dir) {
    // Same direction: a new sibling that takes half of the target's room.
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = sizes[i] / 2;
    sizes[i] = half;
    const at = isBefore(side) ? i : i + 1;
    children.splice(at, 0, fresh);
    sizes.splice(at, 0, half);
    return { ...node, children, sizes };
  }
  const children = node.children.map((c) => insertLeaf(c, targetId, newId, side));
  return children.some((c, k) => c !== node.children[k]) ? { ...node, children } : node;
}

/** Removes a pane; splits left with one child collapse into it. */
export function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.kind === "pane") return node.paneId === id ? null : node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  let changed = false;
  node.children.forEach((c, k) => {
    const r = removeLeaf(c, id);
    if (r !== c) changed = true;
    if (r) {
      children.push(r);
      sizes.push(node.sizes[k]);
    }
  });
  if (!changed) return node;
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return flatten({ ...node, children, sizes });
}

/** A row inside a row (or column in a column) merges into its parent. */
function flatten(node: SplitNode): SplitNode {
  if (!node.children.some((c) => c.kind === "split" && c.dir === node.dir)) return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, k) => {
    if (c.kind === "split" && c.dir === node.dir) {
      const total = c.sizes.reduce((a, b) => a + b, 0);
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push((node.sizes[k] * c.sizes[j]) / total);
      });
    } else {
      children.push(c);
      sizes.push(node.sizes[k]);
    }
  });
  return { ...node, children, sizes };
}

/**
 * Makes the tree hold exactly `paneIds`: missing panes are dropped, new ones
 * are added on the right. Returns the same object when nothing changed.
 */
export function syncLayout(node: LayoutNode | null, paneIds: string[]): LayoutNode {
  const want = new Set(paneIds);
  let out = node;
  if (out) for (const id of leafIds(out)) if (!want.has(id)) out = out && removeLeaf(out, id);
  const have = new Set(out ? leafIds(out) : []);
  for (const id of paneIds) {
    if (have.has(id)) continue;
    if (!out) out = leaf(id);
    else if (out.kind === "split" && out.dir === "row") {
      const avg = out.sizes.reduce((a, b) => a + b, 0) / out.sizes.length;
      out = { ...out, children: [...out.children, leaf(id)], sizes: [...out.sizes, avg] };
    } else out = { kind: "split", id: splitId(), dir: "row", children: [out, leaf(id)], sizes: [1, 1] };
  }
  return out ?? leaf(paneIds[0] ?? "");
}

export function setSizes(node: LayoutNode, id: string, sizes: number[]): LayoutNode {
  if (node.kind === "pane") return node;
  if (node.id === id) return { ...node, sizes };
  const children = node.children.map((c) => setSizes(c, id, sizes));
  return children.some((c, k) => c !== node.children[k]) ? { ...node, children } : node;
}
