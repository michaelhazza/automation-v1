/**
 * waitpointExpirySweepJob — sweeps pending waitpoints whose expiresAt has passed.
 *
 * Runs every 5 minutes via pg-boss (registered in queueService.startMaintenanceJobs).
 * For every waitpoint in status='pending' with expiresAt < now(), transitions the
 * waitpoint to status='expired' and performs per-kind downstream cleanup:
 *   - oauth: cancels the bound agent_run
 *   - approval: marks the bound workflow_step_run as failed
 *   - external_event: no downstream cleanup (no bound run in V1)
 *
 * Cross-org maintenance contract:
 *   - Delegates to waitpointService.expireWaitpoints(), which uses
 *     withAdminConnection + SET LOCAL ROLE admin_role. Every downstream SELECT
 *     and UPDATE carries an explicit organisation_id predicate.
 *
 * Overlap prevention:
 *   - teamSize: 1, teamConcurrency: 1 on the worker registration.
 *   - expireInSeconds: 90 in jobConfig (well under the 5-minute cadence).
 *   - The sweep is idempotent (state-based UPDATE WHERE status='pending')
 *     so a hypothetical overlap would be harmless.
 */

import { logger } from '../lib/logger.js';
import * as waitpointService from '../services/waitpointService.js';

export interface WaitpointExpirySweepSummary {
  expiredCount: number;
  durationMs: number;
}

export async function runFn(): Promise<WaitpointExpirySweepSummary> {
  const started = Date.now();

  const { expiredCount } = await waitpointService.expireWaitpoints();

  const summary: WaitpointExpirySweepSummary = {
    expiredCount,
    durationMs: Date.now() - started,
  };

  logger.info('waitpoint_expiry_sweep', {
    ...summary,
    action: 'waitpoint_expiry_sweep',
  });

  return summary;
}
