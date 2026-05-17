// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentNode {
  id: string;
  agentId: string;
  agentRole: string | null;
  agentTitle: string | null;
  parentSubaccountAgentId: string | null;
  isActive: boolean;
  actorKind?: 'agent' | 'human';
  identityStatus?: string;
  agent: { name: string; icon: string | null; status: string };
  children: AgentNode[];
}

export interface LayoutNode {
  node: AgentNode;
  x: number;
  y: number;
}

// Two edge shapes: orthogonal "tree" connectors between horizontally-laid
// nodes, and a single vertical "trunk" that runs through the centerline of
// a column of vertically-stacked leaves. Trunks are drawn behind the cards
// so only the gaps between cards show, giving a clean spine effect.
export type Edge =
  | { kind: 'tree'; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'trunk'; x: number; fromY: number; toY: number };

// ── Layout constants ───────────────────────────────────────────────────────

export const CARD_W = 180;
export const CARD_H = 56;
export const COL_GAP = 24;       // horizontal gap between sibling columns
export const ROOT_GAP = 56;      // vertical gap from a parent to children laid horizontally
export const HEAD_TO_LEAF = 28;  // vertical gap from a parent to first vertically-stacked leaf
export const LEAF_GAP = 8;       // vertical gap between stacked leaves
export const PAD = 24;

// ── Tree layout algorithm ──────────────────────────────────────────────────
// A node whose children are all leaves (no grandchildren) gets its children
// stacked vertically directly underneath it — same X, increasing Y. This
// prevents wide trees of small children from sprawling horizontally and
// keeps every column's footprint exactly CARD_W wide.
//
// All other nodes lay their children out horizontally with the classic
// "balance subtree widths" pattern.

export function allChildrenAreLeaves(n: AgentNode): boolean {
  return n.children.length > 0 && n.children.every((c) => c.children.length === 0);
}

export function subtreeWidth(node: AgentNode): number {
  if (node.children.length === 0) return CARD_W;
  if (allChildrenAreLeaves(node)) return CARD_W;
  const childrenWidth = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  return Math.max(CARD_W, childrenWidth + COL_GAP * (node.children.length - 1));
}

export function layoutTree(node: AgentNode, x: number, y: number): LayoutNode[] {
  const result: LayoutNode[] = [{ node, x, y }];
  if (node.children.length === 0) return result;

  if (allChildrenAreLeaves(node)) {
    let leafY = y + CARD_H + HEAD_TO_LEAF;
    for (const child of node.children) {
      result.push({ node: child, x, y: leafY });
      leafY += CARD_H + LEAF_GAP;
    }
    return result;
  }

  const totalW = node.children.reduce((s, c) => s + subtreeWidth(c), 0) + COL_GAP * (node.children.length - 1);
  let cx = x - totalW / 2;

  for (const child of node.children) {
    const w = subtreeWidth(child);
    const childX = cx + w / 2;
    result.push(...layoutTree(child, childX, y + CARD_H + ROOT_GAP));
    cx += w + COL_GAP;
  }
  return result;
}

export function layoutForest(roots: AgentNode[]): LayoutNode[] {
  if (roots.length === 0) return [];
  const layouts: LayoutNode[] = [];
  let offsetX = 0;
  for (const root of roots) {
    const w = subtreeWidth(root);
    layouts.push(...layoutTree(root, offsetX + w / 2, 0));
    offsetX += w + COL_GAP * 2;
  }
  return layouts;
}

export function collectEdges(layout: LayoutNode[]): Edge[] {
  const byId = new Map(layout.map((l) => [l.node.id, l]));
  const edges: Edge[] = [];
  for (const l of layout) {
    const { node, x, y } = l;
    if (node.children.length === 0) continue;

    if (allChildrenAreLeaves(node)) {
      // Single vertical trunk from below the parent to the top of the last leaf.
      // The trunk passes behind every leaf card; only the gaps render visibly.
      const lastChild = node.children[node.children.length - 1];
      const lp = byId.get(lastChild.id);
      if (!lp) continue;
      edges.push({ kind: 'trunk', x, fromY: y + CARD_H, toY: lp.y });
    } else {
      for (const child of node.children) {
        const cp = byId.get(child.id);
        if (!cp) continue;
        edges.push({ kind: 'tree', fromX: x, fromY: y + CARD_H, toX: cp.x, toY: cp.y });
      }
    }
  }
  return edges;
}

// ── Build tree from flat list ──────────────────────────────────────────────

export function buildTree(agents: Omit<AgentNode, 'children'>[]): AgentNode[] {
  const map = new Map<string, AgentNode>();
  for (const a of agents) map.set(a.id, { ...a, children: [] });

  const roots: AgentNode[] = [];
  for (const a of agents) {
    const node = map.get(a.id)!;
    if (a.parentSubaccountAgentId && map.has(a.parentSubaccountAgentId)) {
      map.get(a.parentSubaccountAgentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ── Status colours ─────────────────────────────────────────────────────────

// Lifecycle dot colour derived from workspace identity status
export function identityStatusDot(status: string | undefined): string {
  if (status === 'active') return '#22c55e';    // green
  if (status === 'suspended') return '#f97316'; // orange
  return '#94a3b8';                              // grey (not_onboarded / no identity)
}
