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
import { finaliseAgentRunFromBackend } from '../services/agentRunFinalizationService.js';
import {
  ieeRunCompletedPayloadSchema,
  SUPPORTED_IEE_EVENT_VERSION,
  type IeeRunCompletedPayload,
} from '../services/executionBackends/_ieeShared.js';
import type { ExecutionBackendId } from '../services/executionBackends/types.js';
import { logger } from '../lib/logger.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createWorker } from '../lib/createWorker.js';

export const QUEUE = 'iee-run-completed';

/**
 * Shallow payload validation — wraps the canonical Zod schema declared on
 * `ieeBrowserBackend.completedEventPayload` (and exported from
 * `_ieeShared.ts`) so adapter and handler share one source of truth.
 *
 * Pre-versioning (no `version` field) events are treated as v1 for
 * backwards compatibility with any in-flight pg-boss jobs at deploy
 * time. Future version bumps must NOT accept a missing version — make
 * the `version` field required on the schema and remove the fallback
 * here at the same time.
 */
function validatePayload(data: unknown): IeeRunCompletedPayload | null {
  const parsed = ieeRunCompletedPayloadSchema.safeParse(data);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const version = payload.version ?? 1;
  if (version !== SUPPORTED_IEE_EVENT_VERSION) return null;
  if (payload.ieeRunId.length === 0) return null;
  return payload;
}

export async function registerIeeRunCompletedHandler(boss: PgBoss): Promise<void> {
  const config = getJobConfig(QUEUE);
  await createWorker<Record<string, unknown>>({
    queue: QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: () => null,  // cross-org: payload carries no organisationId
    handler: async (job) => {
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
        const backendId: ExecutionBackendId = ieeRun.type === 'browser' ? 'iee_browser' : 'iee_dev';
        await finaliseAgentRunFromBackend({ backendId, backendTaskId: ieeRun.id });
      } catch (err) {
        logger.error('iee.run_completed.finalise_failed', {
          ieeRunId,
          eventKey,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // let pg-boss retry / DLQ per jobConfig
      }
    },
  });

  logger.info('iee.run_completed.handler_registered', {
    retryLimit: config.retryLimit,
    deadLetter: 'deadLetter' in config ? config.deadLetter : undefined,
  });
}
