/**
 * explicitDelegationSkillsWithoutChildrenPure.ts — Pure helper for the
 * explicitDelegationSkillsWithoutChildren detector.
 *
 * No database access. Takes pre-fetched rows and returns the subset whose
 * explicit skill attachments include all three delegation slugs but whose
 * subaccount_agent has no active children.
 */

/**
 * A single row as fetched and pre-processed by the impure detector wrapper.
 * `hasActiveChildren` is computed by the wrapper before calling this function.
 */
export interface SubaccountAgentDelegationRow {
  id: string;           // subaccountAgent.id
  agentId: string;      // subaccountAgent.agentId
  subaccountId: string;
  skillSlugs: string[] | null;
  hasActiveChildren: boolean;
}

const DELEGATION_SLUGS = ['config_list_agents', 'spawn_sub_agents', 'reassign_task'] as const;

/**
 * Returns rows where all three delegation skill slugs are explicitly attached
 * AND the agent has no active children.
 *
 * A row with children is excluded — that is the normal manager configuration,
 * not anomalous. A row without all three slugs is excluded — partial attachment
 * is not the pattern this detector targets.
 */
export function findAgentsWithExplicitDelegationButNoChildren(
  rows: SubaccountAgentDelegationRow[],
): SubaccountAgentDelegationRow[] {
  return rows.filter((row) => {
    if (row.hasActiveChildren) return false;
    if (!row.skillSlugs) return false;
    return DELEGATION_SLUGS.every((slug) => row.skillSlugs!.includes(slug));
  });
}
