/**
 * GHL auto-start onboarding job — Pre-launch hardening D-P0-1.
 *
 * Replaces the inline synchronous call to autoStartOwedOnboardingWorkflows
 * in the unauthenticated webhook/OAuth-callback paths. By deferring via
 * pg-boss the GUC propagation problem is eliminated: the worker runs inside
 * an org-scoped tx (set up by createWorker's default resolveOrgContext) so
 * `app.organisation_id` is set and FORCE-RLS reads in
 * subaccountOnboardingService (via getOrgScopedDb) pass. pg-boss singletonKey
 * deduplicates within a 5-minute window so webhook replay is idempotent.
 */

import { getPgBoss } from '../lib/pgBossInstance.js';
import { logger } from '../lib/logger.js';

export const GHL_AUTO_START_ONBOARDING_JOB = 'ghl:auto-start-onboarding' as const;

export interface GhlAutoStartOnboardingPayload {
  organisationId: string;
  subaccountId: string;
  /**
   * UUID of the user who triggered the enqueue (UI-driven creation), or
   * null for unauthenticated trigger paths (webhook / OAuth callback).
   * `started_by_user_id` is a nullable UUID FK — passing a non-UUID literal
   * like 'system' fails Postgres uuid parsing and aborts the run.
   */
  startedByUserId?: string | null;
}

export async function enqueueGhlOnboarding(
  payload: GhlAutoStartOnboardingPayload,
): Promise<void> {
  const boss = await getPgBoss();
  await boss.send(GHL_AUTO_START_ONBOARDING_JOB, payload, {
    singletonKey: `onboard:${payload.organisationId}:${payload.subaccountId}`,
    singletonSeconds: 300,
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  });
}

export async function ghlAutoStartOnboardingWorker(
  payload: GhlAutoStartOnboardingPayload,
): Promise<void> {
  const { organisationId, subaccountId, startedByUserId } = payload;

  const { subaccountOnboardingService } = await import(
    '../services/subaccountOnboardingService.js'
  );

  logger.info('ghl.autoStartOnboarding.start', {
    event: 'ghl.autoStartOnboarding.start',
    provider: 'ghl',
    orgId: organisationId,
    subaccountId,
  });

  // TODO(post-T3, spec §10): wrap in withOrgTx — explicitly deferred per spec §0.4 + §10. Depends on the GHL unauthenticated path landing first.
  const result = await subaccountOnboardingService.autoStartOwedOnboardingWorkflows({
    organisationId,
    subaccountId,
    startedByUserId: startedByUserId ?? null,
  });

  logger.info('ghl.autoStartOnboarding.complete', {
    event: 'ghl.autoStartOnboarding.complete',
    provider: 'ghl',
    orgId: organisationId,
    subaccountId,
    startedRunIds: result.startedRunIds,
    skippedSlugs: result.skippedSlugs,
    errorCount: result.errors.length,
  });
}
