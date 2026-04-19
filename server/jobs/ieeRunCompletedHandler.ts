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

/**
 * Current supported event payload version. Bump the worker-side emitter
 * and this constant together when the shape changes. Events arriving
 * with a different version are rejected (logged and acked) rather than
 * parsed blindly — external review Blocker 6.
 */
const SUPPORTED_EVENT_VERSION = 1;

interface IeeRunCompletedPayload {
  version: number;
  eventKey: string;
  ieeRunId: string;
  status: 'completed' | 'failed' | 'cancelled';
  failureReason?: string | null;
  totalCostCents?: number;
  stepCount?: number;
}

/**
 * Shallow payload validation — enough to catch version mismatch and
 * gross shape drift before we hit the DB. The iee_runs row is the
 * source of truth, so we do not trust payload content beyond the
 * fields needed to locate the row.
 */
function validatePayload(data: unknown): IeeRunCompletedPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  // Pre-versioning (no `version` field) events are treated as v1 for
  // backwards compatibility with any in-flight pg-boss jobs at deploy
  // time. Future bumps should NOT accept a missing version.
  const version = typeof obj.version === 'number' ? obj.version : 1;
  if (version !== SUPPORTED_EVENT_VERSION) return null;
  if (typeof obj.ieeRunId !== 'string' || obj.ieeRunId.length === 0) return null;
  if (typeof obj.eventKey !== 'string') return null;
  if (obj.status !== 'completed' && obj.status !== 'failed' && obj.status !== 'cancelled') return null;
  return {
    version,
    eventKey: obj.eventKey,
    ieeRunId: obj.ieeRunId,
    status: obj.status,
    failureReason: typeof obj.failureReason === 'string' ? obj.failureReason : null,
    totalCostCents: typeof obj.totalCostCents === 'number' ? obj.totalCostCents : undefined,
    stepCount: typeof obj.stepCount === 'number' ? obj.stepCount : undefined,
  };
}

export async function registerIeeRunCompletedHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);
  await (boss as unknown as {
    work: (
      queue: string,
      options: { teamSize: number; teamConcurrency: number },
      handler: (job: { id: string; data: unknown }) => Promise<void>,
    ) => Promise<string>;
  }).work(QUEUE, { teamSize: 4, teamConcurrency: 1 }, async (job) => {
    // Validate payload shape + version before touching the DB.
    const payload = validatePayload(job.data);
    if (!payload) {
      logger.warn('iee.run_completed.invalid_payload', {
        jobId: job.id,
        rawKeys: typeof job.data === 'object' && job.data !== null
          ? Object.keys(job.data as Record<string, unknown>)
          : typeof job.data,
      });
      // Return (ack) rather than throw — retrying a malformed payload
      // will always produce the same result. Poison pills go to the DLQ
      // via retry exhaustion anyway; ack here keeps the sweep clean.
      return;
    }
    const { ieeRunId, eventKey } = payload;

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
