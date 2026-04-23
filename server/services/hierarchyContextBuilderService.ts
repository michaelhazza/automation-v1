/**
 * hierarchyContextBuilderService.ts — Impure wrapper for the hierarchy context builder.
 *
 * Queries the DB for the subaccount roster, delegates to the pure builder,
 * and returns a frozen HierarchyContext snapshot (INV-4).
 *
 * See INV-4 in tasks/builds/paperclip-hierarchy/plan.md.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents } from '../db/schema/index.js';
import {
  buildHierarchyContextPure,
  HierarchyContextBuildError,
  type RosterRow,
} from './hierarchyContextBuilderServicePure.js';
import type { HierarchyContext } from '../../shared/types/delegation.js';

// Re-export so callers don't need to import from the pure file
export { HierarchyContextBuildError };

/**
 * Build an immutable HierarchyContext for a subaccount agent run.
 *
 * Uses a single DB query to load all active subaccount_agents in the
 * subaccount. Calls the pure builder and returns Object.freeze(result)
 * to enforce INV-4 runtime immutability.
 *
 * @param input.agentId        subaccount_agents.id of the calling agent (NOT agents.id).
 * @param input.subaccountId   subaccount_agents.subaccount_id filter.
 * @param input.organisationId subaccount_agents.organisation_id filter.
 *
 * @throws HierarchyContextBuildError on any pure-layer error (agent_not_in_subaccount,
 *         cycle_detected, depth_exceeded). All other errors (DB failures) propagate.
 */
export async function buildForRun(input: {
  agentId: string;
  subaccountId: string;
  organisationId: string;
}): Promise<Readonly<HierarchyContext>> {
  // Single query: all active subaccount_agents in this subaccount
  const rows: RosterRow[] = await db
    .select({
      id: subaccountAgents.id,
      parentSubaccountAgentId: subaccountAgents.parentSubaccountAgentId,
    })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.subaccountId, input.subaccountId),
        eq(subaccountAgents.organisationId, input.organisationId),
        eq(subaccountAgents.isActive, true),
      ),
    );

  const result = buildHierarchyContextPure({ agentId: input.agentId, roster: rows });

  // INV-4: runtime immutability — freeze before returning
  return Object.freeze(result);
}
