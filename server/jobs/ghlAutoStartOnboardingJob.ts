/**
 * GHL auto-start onboarding job — Pre-launch hardening D-P0-1.
 *
 * Replaces the inline synchronous call to autoStartOwedOnboardingWorkflows
 * in the unauthenticated webhook/OAuth-callback paths. By deferring via
 * pg-boss the GUC propagation problem is eliminated: the worker runs with
 * a proper admin connection that can bypass RLS, and pg-boss singletonKey
 * deduplicates within a 5-minute window so webhook replay is idempotent.
 */

import { getPgBoss } from '../lib/pgBossInstance.js';
import { logger } from '../lib/logger.js';

export const GHL_AUTO_START_ONBOARDING_JOB = 'ghl:auto-start-onboarding' as const;

export interface GhlAutoStartOnboardingPayload {
  organisationId: string;
  subaccountId: string;
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
  const { organisationId, subaccountId } = payload;

  const { subaccountOnboardingService } = await import(
    '../services/subaccountOnboardingService.js'
  );

  logger.info('ghl.autoStartOnboarding.start', {
    event: 'ghl.autoStartOnboarding.start',
    provider: 'ghl',
    orgId: organisationId,
    subaccountId,
  });

  const result = await subaccountOnboardingService.autoStartOwedOnboardingWorkflows({
    organisationId,
    subaccountId,
    startedByUserId: 'system',
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
