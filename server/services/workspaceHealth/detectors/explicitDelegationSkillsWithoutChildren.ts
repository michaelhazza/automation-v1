/**
 * explicitDelegationSkillsWithoutChildren.ts — Async detector for agents with
 * explicit delegation skills but no active children.
 *
 * When an agent has all three delegation skill slugs (config_list_agents,
 * spawn_sub_agents, reassign_task) attached explicitly in skillSlugs but has
 * no active child agents in the hierarchy, it is in a supported but unusual
 * configuration (§6.5 — explicit attachment is an escape hatch). This detector
 * emits an informational finding to prompt operators to verify the attachment
 * is still intentional after team restructures.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { agents } from '../../../db/schema/agents.js';
import { subaccountAgents } from '../../../db/schema/subaccountAgents.js';
import type { WorkspaceHealthFinding } from '../detectorTypes.js';
import {
  findAgentsWithExplicitDelegationButNoChildren,
  type SubaccountAgentDelegationRow,
} from './explicitDelegationSkillsWithoutChildrenPure.js';

/**
 * Detect agents with explicit delegation skills but no active children.
 * Emits an info finding per matching subaccount_agent row.
 */
export async function detectExplicitDelegationSkillsWithoutChildren(
  organisationId: string,
): Promise<WorkspaceHealthFinding[]> {
  // Step 1 — Fetch all active subaccount_agents for this org, joining to get
  // the agent name for the finding label.
  const agentRows = await db
    .select({
      id: subaccountAgents.id,
      agentId: subaccountAgents.agentId,
      subaccountId: subaccountAgents.subaccountId,
      skillSlugs: subaccountAgents.skillSlugs,
      agentName: agents.name,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.isActive, true),
      ),
    );

  if (agentRows.length === 0) {
    return [];
  }

  // Step 2 — Fetch the set of subaccount_agent IDs that are parents of at
  // least one active child.
  const parentRows = await db
    .selectDistinct({ parentId: subaccountAgents.parentSubaccountAgentId })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.isActive, true),
        isNotNull(subaccountAgents.parentSubaccountAgentId),
      ),
    );
  const parentIds = new Set(
    parentRows.map((r) => r.parentId).filter(Boolean) as string[],
  );

  // Step 3 — Compute hasActiveChildren for each row and build the input
  // expected by the pure helper.
  const rows: (SubaccountAgentDelegationRow & { agentName: string })[] = agentRows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    subaccountId: r.subaccountId,
    skillSlugs: r.skillSlugs ?? null,
    hasActiveChildren: parentIds.has(r.id),
    agentName: r.agentName,
  }));

  // Step 4 — Filter via the pure helper.
  const matches = findAgentsWithExplicitDelegationButNoChildren(rows);

  // Step 5 — Map to WorkspaceHealthFinding.
  const agentNameById = new Map(agentRows.map((r) => [r.id, r.agentName]));

  return matches.map((row): WorkspaceHealthFinding => ({
    detector: 'explicitDelegationSkillsWithoutChildren',
    severity: 'info',
    resourceKind: 'subaccount_agent',
    resourceId: row.id,
    resourceLabel: agentNameById.get(row.id) ?? row.agentId,
    message: `Agent ${row.agentId} has delegation skills attached explicitly but no active children. This is a supported configuration (explicit attachment is an escape hatch — §6.5). Informational only: verify the explicit attachment is still intentional after recent team changes.`,
    recommendation:
      'Confirm the explicit skill attachment is still intentional. If this agent should not have delegation capabilities, remove config_list_agents, spawn_sub_agents, and reassign_task from its skill list.',
  }));
}
