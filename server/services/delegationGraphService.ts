/**
 * delegationGraphService.ts — DB layer for the delegation graph endpoint.
 *
 * Walks the run tree BFS up to MAX_DEPTH_BOUND levels, then delegates all
 * graph assembly to the pure function in delegationGraphServicePure.ts.
 *
 * See paperclip-hierarchy spec §7.2.
 */

import { eq, or, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { agents } from '../db/schema/agents.js';
import { assembleGraphPure, MAX_DEPTH_BOUND, type RunRow } from './delegationGraphServicePure.js';
import type { DelegationGraphResponse } from '../../shared/types/delegation.js';

export async function buildForRun(
  runId: string,
  _orgId: string,
): Promise<DelegationGraphResponse> {
  const db = getOrgScopedDb('delegationGraphService.buildForRun');

  // 1. Verify the root run exists in this org (RLS already scopes the query)
  const [rootCheck] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));

  if (!rootCheck) {
    throw { statusCode: 404, message: 'Agent run not found' };
  }

  // 2. Fetch the root run's own data for the root node
  const [rootDetail] = await db
    .select({
      id: agentRuns.id,
      agentId: agentRuns.agentId,
      agentName: agents.name,
      isSubAgent: agentRuns.isSubAgent,
      delegationScope: agentRuns.delegationScope,
      hierarchyDepth: agentRuns.hierarchyDepth,
      delegationDirection: agentRuns.delegationDirection,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      parentRunId: agentRuns.parentRunId,
      handoffSourceRunId: agentRuns.handoffSourceRunId,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(eq(agentRuns.id, runId));

  const allRows: RunRow[] = [];

  if (rootDetail) {
    allRows.push({
      runId: rootDetail.id,
      agentId: rootDetail.agentId,
      agentName: rootDetail.agentName,
      isSubAgent: rootDetail.isSubAgent ?? false,
      delegationScope: rootDetail.delegationScope ?? null,
      hierarchyDepth: rootDetail.hierarchyDepth ?? null,
      delegationDirection: rootDetail.delegationDirection ?? null,
      status: rootDetail.status,
      startedAt: rootDetail.startedAt ? rootDetail.startedAt.toISOString() : null,
      completedAt: rootDetail.completedAt ? rootDetail.completedAt.toISOString() : null,
      parentRunId: rootDetail.parentRunId ?? null,
      handoffSourceRunId: rootDetail.handoffSourceRunId ?? null,
    });
  }

  // 3. BFS walk: collect all descendant runs up to MAX_DEPTH_BOUND levels
  const visited = new Set<string>([runId]);
  let frontier = [runId];
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_DEPTH_BOUND) {
    // Find runs whose parentRunId OR handoffSourceRunId is in the current frontier
    const children = await db
      .select({
        id: agentRuns.id,
        agentId: agentRuns.agentId,
        agentName: agents.name,
        isSubAgent: agentRuns.isSubAgent,
        delegationScope: agentRuns.delegationScope,
        hierarchyDepth: agentRuns.hierarchyDepth,
        delegationDirection: agentRuns.delegationDirection,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        completedAt: agentRuns.completedAt,
        parentRunId: agentRuns.parentRunId,
        handoffSourceRunId: agentRuns.handoffSourceRunId,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .where(
        or(
          inArray(agentRuns.parentRunId, frontier),
          inArray(agentRuns.handoffSourceRunId, frontier),
        ),
      );

    const newFrontier: string[] = [];
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        newFrontier.push(child.id);
        allRows.push({
          runId: child.id,
          agentId: child.agentId,
          agentName: child.agentName,
          isSubAgent: child.isSubAgent ?? false,
          delegationScope: child.delegationScope ?? null,
          hierarchyDepth: child.hierarchyDepth ?? null,
          delegationDirection: child.delegationDirection ?? null,
          status: child.status,
          startedAt: child.startedAt ? child.startedAt.toISOString() : null,
          completedAt: child.completedAt ? child.completedAt.toISOString() : null,
          parentRunId: child.parentRunId ?? null,
          handoffSourceRunId: child.handoffSourceRunId ?? null,
        });
      }
    }

    frontier = newFrontier;
    depth++;
  }

  const truncated = frontier.length > 0;
  return assembleGraphPure({ rootRunId: runId, rows: allRows, truncated });
}
