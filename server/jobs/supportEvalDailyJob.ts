// supportEvalDailyJob.ts — pg-boss daily job for the Support Agent eval harness.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.5.1, §5.5.3, §7.3
//
// Triggered once per day per organisation. Calls runOnce which runs the
// 5-fixture classify+judge loop, inserts a support_eval_runs row, and
// emits phase1.support.eval_drift_detected if drift is detected.
//
// Idempotency: singleton-key per organisationId so concurrent cron ticks
// collapse into one run per org.

import type PgBoss from 'pg-boss';
import { createWorker } from '../lib/createWorker.js';
import { logger } from '../lib/logger.js';
import { runOnce } from '../services/supportEvalHarness.js';

export const QUEUE = 'support-eval-daily';

export interface SupportEvalDailyPayload {
  organisationId: string;
}

export function registerSupportEvalDailyJob(boss: PgBoss): void {
  createWorker<SupportEvalDailyPayload>({
    queue: QUEUE,
    boss,
    concurrency: 1,

    handler: async (job) => {
      const { organisationId } = job.data;

      logger.info('support.eval_daily.started', { organisationId });

      const { evalRunId, partial } = await runOnce(organisationId);

      logger.info('support.eval_daily.completed', {
        organisationId,
        evalRunId,
        partial,
      });
    },
  });

  logger.info('support.eval_daily.handler_registered');
}

export async function enqueueSupportEvalDaily(
  boss: PgBoss,
  payload: SupportEvalDailyPayload,
): Promise<string | null> {
  return boss.send(QUEUE, payload, { singletonKey: payload.organisationId });
}
