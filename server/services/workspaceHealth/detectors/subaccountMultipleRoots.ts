/**
 * subaccountMultipleRoots.ts — Async detector for subaccounts with multiple
 * active root agents.
 *
 * A root agent is a subaccount_agent row where is_active=true AND
 * parent_subaccount_agent_id IS NULL. Each subaccount should have exactly one
 * such row (enforced by a partial unique index). This detector flags any
 * subaccount that has more than one, which indicates an index violation or a
 * data-consistency bug that requires immediate investigation.
 */

import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { subaccountAgents } from '../../../db/schema/subaccountAgents.js';
import type { WorkspaceHealthFinding } from '../detectorTypes.js';
import { findSubaccountsWithMultipleRoots } from './subaccountMultipleRootsPure.js';

/**
 * Detect subaccounts that have more than one active root agent.
 * Emits a critical finding per violating subaccount.
 */
export async function detectSubaccountMultipleRoots(
  organisationId: string,
): Promise<WorkspaceHealthFinding[]> {
  const rows = await db
    .select({
      subaccountId: subaccountAgents.subaccountId,
      rootCount: count(),
    })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.isActive, true),
        isNull(subaccountAgents.parentSubaccountAgentId),
      ),
    )
    .groupBy(subaccountAgents.subaccountId)
    .having(gt(count(), 1));

  const violations = findSubaccountsWithMultipleRoots(
    rows.map((r) => ({ subaccountId: r.subaccountId, count: Number(r.rootCount) })),
  );

  return violations.map((v): WorkspaceHealthFinding => ({
    detector: 'subaccountMultipleRoots',
    severity: 'critical',
    resourceKind: 'subaccount',
    resourceId: v.subaccountId,
    resourceLabel: v.subaccountId,
    message: `Subaccount ${v.subaccountId} has ${v.count} active root agents. Partial unique index violation — investigate immediately.`,
    recommendation:
      'Deactivate duplicate root agents or re-parent them under the intended root. Run the seed-manifest audit script to confirm.',
  }));
}
