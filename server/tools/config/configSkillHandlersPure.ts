/**
 * Pure helpers for config skill handlers — no I/O, no DB access.
 * Testable in isolation with npx tsx.
 */

import { DELEGATION_SCOPE_VALUES, type DelegationScope, type HierarchyContext } from '../../../shared/types/delegation.js';

export interface RosterEntry {
  /** subaccount_agents.id — the link row primary key */
  subaccountAgentId: string;
  /** agents.id — the org-level agent */
  agentId: string;
  /** subaccount_agents.parent_subaccount_agent_id — null for root */
  parentSubaccountAgentId: string | null;
}

/**
 * Walk the roster downward from `callerSubaccountAgentId` and return all
 * descendant subaccountAgentIds (children, grandchildren, etc.).
 * The caller itself is NOT included in the result.
 * Safe against cycles via a visited set.
 */
export function computeDescendantIds(input: {
  callerSubaccountAgentId: string;
  roster: RosterEntry[];
}): string[] {
  const { callerSubaccountAgentId, roster } = input;

  // Build child map: parentSubaccountAgentId → childSubaccountAgentIds
  const childMap = new Map<string, string[]>();
  for (const entry of roster) {
    if (entry.parentSubaccountAgentId !== null) {
      const children = childMap.get(entry.parentSubaccountAgentId) ?? [];
      children.push(entry.subaccountAgentId);
      childMap.set(entry.parentSubaccountAgentId, children);
    }
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [callerSubaccountAgentId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const children = childMap.get(current) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        result.push(child);
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Map an array of subaccountAgentIds to their corresponding agentIds.
 * Ids with no matching roster entry are silently dropped.
 */
export function mapSubaccountAgentIdsToAgentIds(input: {
  subaccountAgentIds: string[];
  roster: RosterEntry[];
}): string[] {
  const { subaccountAgentIds, roster } = input;
  const lookupMap = new Map<string, string>();
  for (const entry of roster) {
    lookupMap.set(entry.subaccountAgentId, entry.agentId);
  }
  const result: string[] = [];
  for (const saId of subaccountAgentIds) {
    const agentId = lookupMap.get(saId);
    if (agentId !== undefined) {
      result.push(agentId);
    }
  }
  return result;
}

export interface SystemAgentRow {
  id: string;
  slug: string;
  name: string;
  title: string | null;
  agentRole: string | null;
  parentSystemAgentId: string | null;
  deletedAt: Date | null;
  status: string | null;
}

/**
 * Pure helper — resolves children or descendants from a flat list of system_agents rows.
 * Caller fetches the rows; this function does the traversal.
 * Filters by deletedAt IS NULL and status === 'active'.
 */
export function resolveSubordinates(input: {
  callerSystemAgentId: string;
  scope: 'children' | 'descendants';
  allAgents: SystemAgentRow[];
  maxDepth?: number; // default 3 for descendants
}): Array<{ slug: string; name: string; title: string | null; role: string | null; isActive: boolean }> {
  const { callerSystemAgentId, scope, allAgents, maxDepth = 3 } = input;
  const active = allAgents.filter(a => a.deletedAt === null && a.status === 'active');

  if (scope === 'children') {
    return active
      .filter(a => a.parentSystemAgentId === callerSystemAgentId)
      .map(a => ({ slug: a.slug, name: a.name, title: a.title, role: a.agentRole, isActive: true }));
  }

  // BFS descendants up to maxDepth
  const result: typeof active = [];
  const visited = new Set<string>([callerSystemAgentId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: callerSystemAgentId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const children = active.filter(a => a.parentSystemAgentId === id && !visited.has(a.id));
    for (const child of children) {
      visited.add(child.id);
      result.push(child);
      queue.push({ id: child.id, depth: depth + 1 });
    }
  }
  return result.map(a => ({ slug: a.slug, name: a.name, title: a.title, role: a.agentRole, isActive: true }));
}

/**
 * Determines the effective DelegationScope for a list-agents call.
 * Pure — no IO.
 *
 * - If rawScope is a valid DelegationScope value, returns it (explicit override).
 * - If hierarchy has children, adaptive default is 'children'.
 * - Otherwise adaptive default is 'subaccount'.
 * - If hierarchy is undefined/null (missing context), returns 'subaccount'.
 */
export function resolveEffectiveScope(input: {
  rawScope: unknown;
  hierarchy: Readonly<HierarchyContext> | undefined;
}): DelegationScope {
  if (DELEGATION_SCOPE_VALUES.includes(input.rawScope as DelegationScope)) {
    return input.rawScope as DelegationScope;
  }
  if ((input.hierarchy?.childIds.length ?? 0) > 0) {
    return 'children';
  }
  return 'subaccount';
}
