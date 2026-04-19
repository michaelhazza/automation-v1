/**
 * iee-run-completed event handler — main-app side.
 *
 * The IEE worker emits an 'iee-run-completed' pg-boss event after every
 * terminal iee_runs write (see worker/src/persistence/runs.ts::finalizeRun).
 * This handler consumes those events and finalises the parent agent_runs
 * row via finaliseAgentRunFromIeeRun.
 *
 * Idempotency: the finalisation service is idempotent, so duplicate event
 * deliveries (expected — worker retry sweep re-emits unemitted events) are
 * safe no-ops.
 *
 * See docs/iee-delegation-lifecycle-spec.md Step 3.
 */

import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { finaliseAgentRunFromIeeRun } from '../services/agentRunFinalizationService.js';
import { logger } from '../lib/logger.js';
import { getJobConfig } from '../config/jobConfig.js';

export const QUEUE = 'iee-run-completed';

interface IeeRunCompletedPayload {
  eventKey: string;
  ieeRunId: string;
  status: 'completed' | 'failed' | 'cancelled';
  failureReason?: string | null;
  totalCostCents?: number;
  stepCount?: number;
}

export async function registerIeeRunCompletedHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);
  await (boss as unknown as {
    work: (
      queue: string,
      options: { teamSize: number; teamConcurrency: number },
      handler: (job: { id: string; data: IeeRunCompletedPayload }) => Promise<void>,
    ) => Promise<string>;
  }).work(QUEUE, { teamSize: 4, teamConcurrency: 1 }, async (job) => {
    const { ieeRunId, eventKey } = job.data;

    // Source-of-truth re-read. The event payload is a hint; the iee_runs row
    // is authoritative. This matters because the retry sweep may re-emit a
    // stale event after the main-app handler has already processed it.
    const [ieeRun] = await db
      .select()
      .from(ieeRuns)
      .where(eq(ieeRuns.id, ieeRunId))
      .limit(1);

    if (!ieeRun) {
      logger.warn('iee.run_completed.unknown_iee_run', { ieeRunId, eventKey });
      return;
    }

    try {
      await finaliseAgentRunFromIeeRun(ieeRun);
    } catch (err) {
      logger.error('iee.run_completed.finalise_failed', {
        ieeRunId,
        eventKey,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // let pg-boss retry / DLQ per jobConfig
    }
  });

  logger.info('iee.run_completed.handler_registered', {
    retryLimit: config.retryLimit,
    deadLetter: 'deadLetter' in config ? config.deadLetter : undefined,
  });
}
