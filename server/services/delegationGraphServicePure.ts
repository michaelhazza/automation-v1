/**
 * delegationGraphServicePure.ts — Pure graph assembly for delegation trees.
 *
 * No DB, no external service imports. All logic is deterministic and testable
 * in isolation via npx tsx.
 *
 * See paperclip-hierarchy spec §7.2.
 */

import type {
  DelegationGraphNode,
  DelegationGraphEdge,
  DelegationGraphResponse,
} from '../../shared/types/delegation.js';

// MAX_HANDOFF_DEPTH from the spec is 5; the BFS walker in delegationGraphService.ts
// walks up to MAX_DEPTH_BOUND levels of descendants and passes truncated=true when
// un-walked children remain. Exported for the walker; this pure function treats
// truncated as an explicit input, not something derived from row depth.
export const MAX_DEPTH_BOUND = 6;

export interface RunRow {
  runId: string;
  agentId: string;
  agentName: string;
  isSubAgent: boolean;
  delegationScope: string | null;
  hierarchyDepth: number | null;
  delegationDirection: string | null;
  status: string;
  startedAt: string | null; // ISO string or null for pending runs
  completedAt: string | null; // ISO string
  parentRunId: string | null;
  handoffSourceRunId: string | null;
}

export function assembleGraphPure(input: {
  rootRunId: string;
  rows: RunRow[];
  truncated: boolean;
}): DelegationGraphResponse {
  const { rootRunId, rows } = input;

  // Dedup nodes by runId — last write wins (shouldn't differ in practice)
  const nodeMap = new Map<string, DelegationGraphNode>();
  for (const row of rows) {
    nodeMap.set(row.runId, {
      runId: row.runId,
      agentId: row.agentId,
      agentName: row.agentName,
      isSubAgent: row.isSubAgent,
      delegationScope: (row.delegationScope as DelegationGraphNode['delegationScope']) ?? null,
      hierarchyDepth: row.hierarchyDepth ?? null,
      delegationDirection: (row.delegationDirection as DelegationGraphNode['delegationDirection']) ?? null,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
    });
  }

  // Build edges — one spawn edge per parentRunId pointer (excluding root),
  // one handoff edge per handoffSourceRunId pointer.
  const edges: DelegationGraphEdge[] = [];
  for (const row of rows) {
    if (row.parentRunId && row.isSubAgent && row.runId !== rootRunId) {
      edges.push({
        parentRunId: row.parentRunId,
        childRunId: row.runId,
        kind: 'spawn',
      });
    }
    if (row.handoffSourceRunId && row.runId !== rootRunId) {
      edges.push({
        parentRunId: row.handoffSourceRunId,
        childRunId: row.runId,
        kind: 'handoff',
      });
    }
  }

  return {
    rootRunId,
    nodes: Array.from(nodeMap.values()),
    edges,
    truncated: input.truncated,
  };
}
