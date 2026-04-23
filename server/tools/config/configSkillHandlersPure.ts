/**
 * Pure helpers for config skill handlers — no I/O, no DB access.
 * Testable in isolation with npx tsx.
 */

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
