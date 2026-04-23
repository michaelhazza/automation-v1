/**
 * hierarchyContextBuilderServicePure.ts — Pure hierarchy context builder.
 *
 * No DB access, no side effects. Accepts a roster array and builds the
 * HierarchyContext for a given agent. All error cases throw
 * HierarchyContextBuildError with a typed code.
 *
 * See INV-4 in tasks/builds/paperclip-hierarchy/plan.md.
 */

import type { HierarchyContext } from '../../shared/types/delegation.js';

export const MAX_HIERARCHY_DEPTH = 10;

export interface RosterRow {
  id: string;
  parentSubaccountAgentId: string | null;
}

export class HierarchyContextBuildError extends Error {
  constructor(
    public readonly code: 'agent_not_in_subaccount' | 'depth_exceeded' | 'cycle_detected',
    message: string,
  ) {
    super(message);
    this.name = 'HierarchyContextBuildError';
  }
}

/**
 * Build a HierarchyContext for the given agentId from the roster.
 *
 * @param input.agentId  The subaccount_agents.id of the calling agent.
 * @param input.roster   All active subaccount_agents rows in this subaccount.
 *
 * @throws HierarchyContextBuildError('agent_not_in_subaccount') when agentId is not in the roster.
 * @throws HierarchyContextBuildError('cycle_detected') when the parent chain loops.
 * @throws HierarchyContextBuildError('depth_exceeded') when the parent chain exceeds MAX_HIERARCHY_DEPTH.
 */
export function buildHierarchyContextPure(input: {
  agentId: string;
  roster: RosterRow[];
}): HierarchyContext {
  const { agentId, roster } = input;

  // Build a fast lookup map: id → row
  const byId = new Map<string, RosterRow>();
  for (const row of roster) {
    byId.set(row.id, row);
  }

  // 1. Find caller's row
  const callerRow = byId.get(agentId);
  if (!callerRow) {
    throw new HierarchyContextBuildError(
      'agent_not_in_subaccount',
      `Agent ${agentId} not found in subaccount roster`,
    );
  }

  // 2. parentId from the caller's own row
  const parentId = callerRow.parentSubaccountAgentId ?? null;

  // 3. childIds — rows whose parent points to agentId, sorted ascending for determinism
  const childIds = roster
    .filter(r => r.parentSubaccountAgentId === agentId)
    .map(r => r.id)
    .sort();

  // 4. Walk upward to find rootId and compute depth
  //    depth = number of hops from caller to root (root has depth 0).
  //    Cap at MAX_HIERARCHY_DEPTH + 1 = 11 iterations total; throw if exceeded.
  const visited = new Set<string>();
  let current: RosterRow = callerRow;
  let depth = 0;

  while (current.parentSubaccountAgentId !== null) {
    if (visited.has(current.id)) {
      throw new HierarchyContextBuildError(
        'cycle_detected',
        `Cycle detected in hierarchy at agent ${current.id}`,
      );
    }
    visited.add(current.id);

    // depth is about to be incremented; if it would exceed the cap, throw now
    if (depth >= MAX_HIERARCHY_DEPTH) {
      throw new HierarchyContextBuildError(
        'depth_exceeded',
        `Hierarchy depth exceeds MAX_HIERARCHY_DEPTH (${MAX_HIERARCHY_DEPTH}) at agent ${agentId}`,
      );
    }

    const parentRow = byId.get(current.parentSubaccountAgentId);
    if (!parentRow) {
      // Parent referenced but not in roster (inactive or missing) — treat as root
      break;
    }

    current = parentRow;
    depth++;
  }

  const rootId = current.id;

  return { agentId, parentId, childIds, rootId, depth };
}
