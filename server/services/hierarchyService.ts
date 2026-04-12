import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemAgents, agents, subaccountAgents } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Hierarchy Service — shared utilities for agent parent/child relationships
// ---------------------------------------------------------------------------

const MAX_DEPTH = 10;
const WARN_DEPTH = 7;

/**
 * Validate hierarchy write: check depth limit and circular ancestry.
 * Works for any table with a self-referencing parent column.
 */
export async function validateHierarchy(
  table: 'system_agents' | 'agents' | 'subaccount_agents',
  childId: string,
  parentId: string | null
): Promise<{ valid: boolean; error?: string; depthWarning?: boolean }> {
  if (!parentId) return { valid: true };
  if (parentId === childId) return { valid: false, error: 'An agent cannot be its own parent' };

  // Walk ancestry from parentId upward to check for cycles and depth
  const ancestors: string[] = [];
  let currentId: string | null = parentId;

  while (currentId) {
    if (currentId === childId) {
      return { valid: false, error: 'Circular hierarchy detected: this change would create a loop' };
    }
    ancestors.push(currentId);
    if (ancestors.length > MAX_DEPTH) {
      return { valid: false, error: `Hierarchy depth exceeds maximum of ${MAX_DEPTH} levels` };
    }

    let parentRow: { parentId: string | null } | undefined;

    if (table === 'system_agents') {
      const [row] = await db
        .select({ parentId: systemAgents.parentSystemAgentId })
        .from(systemAgents)
        .where(eq(systemAgents.id, currentId));
      parentRow = row;
    } else if (table === 'agents') {
      const [row] = await db
        .select({ parentId: agents.parentAgentId })
        .from(agents)
        // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT for hierarchy traversal; currentId starts from caller-validated agentId and follows parentAgentId links"
        .where(eq(agents.id, currentId));
      parentRow = row;
    } else {
      const [row] = await db
        .select({ parentId: subaccountAgents.parentSubaccountAgentId })
        .from(subaccountAgents)
        .where(eq(subaccountAgents.id, currentId));
      parentRow = row;
    }

    currentId = parentRow?.parentId ?? null;
  }

  // Check depth: ancestors.length is the depth above the parent, +1 for the child
  const totalDepth = ancestors.length + 1;
  const depthWarning = totalDepth > WARN_DEPTH;

  if (totalDepth > MAX_DEPTH) {
    return { valid: false, error: `Hierarchy depth exceeds maximum of ${MAX_DEPTH} levels` };
  }

  return { valid: true, depthWarning };
}

/**
 * Build a nested tree from a flat list of items with parentId references.
 */
export function buildTree<T extends { id: string; sortOrder?: number | null; createdAt?: Date | null }>(
  items: T[],
  getParentId: (item: T) => string | null
): Array<TreeNode<T>> {

  const nodeMap = new Map<string, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];

  // Create all nodes
  for (const item of items) {
    nodeMap.set(item.id, { ...item, children: [] });
  }

  // Build tree
  for (const item of items) {
    const node = nodeMap.get(item.id)!;
    const parentId = getParentId(item);

    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children: sortOrder ASC, then createdAt ASC
  const sortNodes = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => {
      const aSort = a.sortOrder ?? Infinity;
      const bSort = b.sortOrder ?? Infinity;
      if (aSort !== bSort) return aSort - bSort;
      const aTime = a.createdAt?.getTime() ?? 0;
      const bTime = b.createdAt?.getTime() ?? 0;
      return aTime - bTime;
    });
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return roots;
}

type TreeNode<T> = T & { children: TreeNode<T>[] };

/**
 * Calculate the maximum depth of a tree.
 */
export function getMaxDepth<T extends { children?: T[] }>(nodes: T[], currentDepth = 1): number {
  let max = currentDepth;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const childDepth = getMaxDepth(node.children, currentDepth + 1);
      if (childDepth > max) max = childDepth;
    }
  }
  return max;
}
