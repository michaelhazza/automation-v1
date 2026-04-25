/**
 * onboardingStateService — upserts subaccount_onboarding_state from
 * workflow run transitions.
 *
 * Extracted from server/lib/workflow/onboardingStateHelpers.ts to keep DB
 * access in the services layer per the RLS architecture contract.
 *
 * Spec §10.3 (G10.3). Failures are logged and swallowed — bookkeeping must
 * never block execution.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountOnboardingState } from '../db/schema/subaccountOnboardingState.js';
import type { SubaccountOnboardingStatus } from '../db/schema/subaccountOnboardingState.js';
import type { WorkflowRunStatus } from '../db/schema/workflowRuns.js';
import { logger } from '../lib/logger.js';

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
