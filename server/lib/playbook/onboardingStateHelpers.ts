/**
 * Helpers that upsert `subaccount_onboarding_state` from wherever a
 * playbook run transitions state. Isolated from `subaccountOnboardingService`
 * to avoid the circular import between `playbookRunService ↔
 * subaccountOnboardingService`.
 *
 * Spec §10.3 (G10.3). Failures are logged and swallowed — bookkeeping must
 * never block execution.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { subaccountOnboardingState } from '../../db/schema/subaccountOnboardingState.js';
import type { SubaccountOnboardingStatus } from '../../db/schema/subaccountOnboardingState.js';
import type { PlaybookRunStatus } from '../../db/schema/playbookRuns.js';
import { logger } from '../logger.js';

export function mapRunStatusToOnboardingStatus(
  runStatus: PlaybookRunStatus,
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
  subaccountId: string;
  playbookSlug: string | null;
  isOnboardingRun: boolean;
  runStatus: PlaybookRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
}): Promise<void> {
  if (!params.isOnboardingRun || !params.playbookSlug) return;

  const status = mapRunStatusToOnboardingStatus(params.runStatus);
  const now = new Date();

  try {
    await db
      .insert(subaccountOnboardingState)
      .values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        playbookSlug: params.playbookSlug,
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
          subaccountOnboardingState.playbookSlug,
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
      subaccountId: params.subaccountId,
      playbookSlug: params.playbookSlug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
