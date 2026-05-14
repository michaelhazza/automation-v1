/**
 * operatorSessionCompletedHandler — consumes 'operator-session-completed' events.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §7.4
 *
 * Triggered when an operator_run reaches a terminal state. Calls
 * finaliseAgentRunFromBackend({ backendId: 'operator_managed', backendTaskId }).
 *
 * Idempotency:
 *   - event_emitted_at IS NULL → run finalisation (winner path).
 *   - event_emitted_at IS NOT NULL → no-op (redelivery guard; already finalised).
 *
 * pg-boss singleton key: 'operator-session-task-terminal:${agentRunId}'
 * prevents duplicate task-terminal events from racing.
 */

import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { operatorRuns } from '../db/schema/index.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import { finaliseAgentRunFromBackend } from '../services/agentRunFinalizationService.js';
import {
  operatorSessionCompletedPayloadSchema,
  OPERATOR_SESSION_COMPLETED_QUEUE,
} from '../services/executionBackends/operatorManagedBackend.js';
import { logger } from '../lib/logger.js';
import { createWorker } from '../lib/createWorker.js';

/**
 * Registers the operator-session-completed pg-boss handler.
 */
export async function registerOperatorSessionCompletedHandler(boss: PgBoss): Promise<void> {
  await createWorker<Record<string, unknown>>({
    queue: OPERATOR_SESSION_COMPLETED_QUEUE,
    boss,
    concurrency: 4,
    resolveOrgContext: () => null, // cross-org: GUC is set per-tx inside the handler
    handler: async (job) => {
      const parsed = operatorSessionCompletedPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn('operator.session_completed.invalid_payload', {
          jobId: job.id,
          issues: parsed.error.issues,
        });
        // Ack — malformed payload will never succeed on retry.
        return;
      }

      const { operatorRunId, agentRunId, organisationId, subaccountId } = parsed.data;

      // Idempotency re-read: check event_emitted_at before touching finaliser.
      // Must set dual GUC so RLS on operator_runs returns the row.
      let eventEmittedAt: Date | null | undefined;
      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);
        const [run] = await tx
          .select({ eventEmittedAt: operatorRuns.eventEmittedAt })
          .from(operatorRuns)
          .where(eq(operatorRuns.id, operatorRunId))
          .limit(1);
        eventEmittedAt = run?.eventEmittedAt;
      });

      if (eventEmittedAt === undefined) {
        logger.warn('operator.session_completed.unknown_run', { operatorRunId, agentRunId });
        return;
      }

      if (eventEmittedAt !== null) {
        // Redelivery — already finalised. No-op.
        logger.info('operator.session_completed.already_finalised', {
          operatorRunId,
          agentRunId,
          eventEmittedAt,
        });
        return;
      }

      try {
        await finaliseAgentRunFromBackend({
          backendId: 'operator_managed',
          backendTaskId: operatorRunId,
          organisationId,
          subaccountId,
        });
      } catch (err) {
        logger.error('operator.session_completed.finalise_failed', {
          operatorRunId,
          agentRunId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err; // let pg-boss retry / DLQ
      }

      logger.info('operator.session_completed.done', { operatorRunId, agentRunId });
    },
  });

  logger.info('operator.session_completed.handler_registered');
}
