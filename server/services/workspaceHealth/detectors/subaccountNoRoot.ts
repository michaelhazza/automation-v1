/**
 * subaccountNoRoot.ts — Async detector for subaccounts with no active root agent.
 *
 * A root agent is a subaccount_agent row where is_active=true AND
 * parent_subaccount_agent_id IS NULL. Subaccounts without one cannot route
 * briefs at the subaccount tier — they fall back to the org-level default.
 * This is an informational finding: the system still works but per-subaccount
 * routing is unavailable.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { subaccounts } from '../../../db/schema/subaccounts.js';
import { subaccountAgents } from '../../../db/schema/subaccountAgents.js';
import type { WorkspaceHealthFinding } from '../detectorTypes.js';
import { findSubaccountsWithNoRoot } from './subaccountNoRootPure.js';

/**
 * Detect subaccounts that have no active root agent.
 * Emits an info finding per subaccount that is missing a root.
 */
export async function detectSubaccountNoRoot(
  organisationId: string,
): Promise<WorkspaceHealthFinding[]> {
  // 1. All subaccounts for this org (including soft-deleted is intentionally
  //    excluded — deletedAt IS NULL is not filtered here because we want to
  //    surface any subaccount that is operationally present but unrooted).
  const allSubaccountRows = await db
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(eq(subaccounts.organisationId, organisationId));

  const allSubaccountIds = allSubaccountRows.map((r) => r.id);

  if (allSubaccountIds.length === 0) {
    return [];
  }

  // 2. Subaccounts that have at least one active root agent.
  const rootRows = await db
    .select({ subaccountId: subaccountAgents.subaccountId })
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.organisationId, organisationId),
        eq(subaccountAgents.isActive, true),
        isNull(subaccountAgents.parentSubaccountAgentId),
      ),
    );

  const subaccountsWithRoot = rootRows.map((r) => r.subaccountId);

  // 3. Compute the gap via the pure helper.
  const missing = findSubaccountsWithNoRoot(allSubaccountIds, subaccountsWithRoot);

  return missing.map((subaccountId): WorkspaceHealthFinding => ({
    detector: 'subaccountNoRoot',
    severity: 'info',
    resourceKind: 'subaccount',
    resourceId: subaccountId,
    resourceLabel: subaccountId,
    message: `Subaccount ${subaccountId} has no active root agent. Briefs route to the org-level fallback; assign a subaccount-level root (e.g. via hierarchy template) to enable per-subaccount routing.`,
    recommendation:
      'Apply a hierarchy template to assign a root agent to this subaccount, or configure one manually via the agent roster.',
  }));
}
