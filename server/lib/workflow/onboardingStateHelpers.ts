/**
 * Helpers that upsert `subaccount_onboarding_state` from wherever a
 * Workflow run transitions state. Isolated from `subaccountOnboardingService`
 * to avoid the circular import between `WorkflowRunService ↔
 * subaccountOnboardingService`.
 *
 * Spec §10.3 (G10.3). Failures are logged and swallowed — bookkeeping must
 * never block execution.
 */

import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../orgScopedDb.js';
import { subaccountOnboardingState } from '../../db/schema/subaccountOnboardingState.js';
import type { SubaccountOnboardingStatus } from '../../db/schema/subaccountOnboardingState.js';
import type { WorkflowRunStatus } from '../../db/schema/workflowRuns.js';
import { logger } from '../logger.js';

export function mapRunStatusToOnboardingStatus(
  runStatus: WorkflowRunStatus,
): SubaccountOnboardingStatus {
  switch (runStatus) {
    case 'completed':
    case 'completed_with_errors':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return 'failed';
    default:
      return 'in_progress';
  }
}

export async function upsertSubaccountOnboardingState(params: {
  runId: string;
  organisationId: string;
  // Nullable post-migration 0171 — org-scope Workflow runs have no subaccount.
  // Onboarding state is inherently subaccount-scoped, so we skip silently for
  // null. This prevents org-scope terminal paths from throwing (pr-reviewer
  // catch 2026-04-18: requireSubaccountId on terminal state left runs zombie).
  subaccountId: string | null;
  workflowSlug: string | null;
  isOnboardingRun: boolean;
  runStatus: WorkflowRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
}): Promise<void> {
  if (!params.isOnboardingRun || !params.workflowSlug || params.subaccountId === null) return;
  const subaccountId: string = params.subaccountId;

  const status = mapRunStatusToOnboardingStatus(params.runStatus);
  const now = new Date();

  try {
    const db = getOrgScopedDb('onboardingStateHelpers.upsertSubaccountOnboardingState');
    await db
      .insert(subaccountOnboardingState)
      .values({
        organisationId: params.organisationId,
        subaccountId,
        workflowSlug: params.workflowSlug,
        status,
        lastRunId: params.runId,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          subaccountOnboardingState.subaccountId,
          subaccountOnboardingState.workflowSlug,
        ],
        set: {
          status,
          lastRunId: params.runId,
          // Keep the earliest startedAt once set — status flips back to
          // in_progress for resumes but the original startedAt is preserved.
          startedAt: params.startedAt ?? sql`${subaccountOnboardingState.startedAt}`,
          completedAt: params.completedAt,
          updatedAt: now,
        },
      });
  } catch (err) {
    logger.error('subaccount_onboarding_state_upsert_failed', {
      runId: params.runId,
      subaccountId,
      workflowSlug: params.workflowSlug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
