/**
 * clarificationTimeoutJob — polls pending clarifications for expiration
 *
 * Runs periodically (scheduled in queueService.ts). For every
 * `memory_review_queue` row with `itemType='clarification_pending'` and
 * `status='pending'` whose `expiresAt < now`, transitions the row to
 * `expired` and emits a WebSocket event so any paused run can fall back to
 * best-guess.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 */

import { eq, and, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { memoryReviewQueue, agentRuns } from '../db/schema/index.js';
import { expireClarification } from '../services/clarificationService.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

export interface ClarificationTimeoutSummary {
  scanned: number;
  expired: number;
  runsFlagged: number;
  failed: number;
  durationMs: number;
}

export async function runClarificationTimeoutSweep(): Promise<ClarificationTimeoutSummary> {
  const started = Date.now();
  const now = new Date();
  let scanned = 0;
  let expired = 0;
  let runsFlagged = 0;
  let failed = 0;

  // Fetch all pending clarifications whose expiry has passed
  const pending = await db
    .select({
      id: memoryReviewQueue.id,
      payload: memoryReviewQueue.payload,
      expiresAt: memoryReviewQueue.expiresAt,
      organisationId: memoryReviewQueue.organisationId,
      requiresClarification: memoryReviewQueue.requiresClarification,
    })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.itemType, 'clarification_pending'),
        eq(memoryReviewQueue.status, 'pending'),
        lt(memoryReviewQueue.expiresAt, now),
      ),
    );

  scanned = pending.length;

  for (const row of pending) {
    try {
      await expireClarification({ clarificationId: row.id });
      expired += 1;

      // Flag the run with hadUncertainty=true and resume with best-guess.
      const payload = (row.payload as Record<string, unknown>) ?? {};
      const activeRunId = (payload.activeRunId as string | null) ?? null;
      const urgency = (payload.urgency as string | null) ?? null;
      const requiresClarification = row.requiresClarification ?? false;

      if (activeRunId && urgency === 'blocking') {
        // Mark the run as having uncertainty and update status so the
        // resume path knows to proceed with best-guess. The agentRun's
        // `status` is restored to 'running' to signal step resumption.
        const [runRow] = await db
          .select({
            id: agentRuns.id,
            runMetadata: agentRuns.runMetadata,
          })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, activeRunId),
              eq(agentRuns.organisationId, row.organisationId),
            ),
          )
          .limit(1);

        if (runRow) {
          const prior = (runRow.runMetadata as Record<string, unknown> | null) ?? {};
          const timeouts = (prior.clarificationTimeouts as Array<Record<string, unknown>> | undefined) ?? [];
          await db
            .update(agentRuns)
            .set({
              // Restore to 'running' so the execution loop can resume with
              // best-guess. Without this the run stays stuck indefinitely.
              status: 'running',
              runMetadata: {
                ...prior,
                hadUncertainty: true,
                clarificationTimeouts: [
                  ...timeouts,
                  {
                    clarificationId: row.id,
                    timedOutAt: now.toISOString(),
                    urgency,
                    requiresClarification,
                  },
                ],
              },
              updatedAt: now,
            })
            .where(eq(agentRuns.id, activeRunId));

          emitAgentRunUpdate(activeRunId, 'agent:run:clarification-timeout', {
            clarificationId: row.id,
            stepId: (payload.stepId as string | null) ?? null,
          });

          runsFlagged += 1;
        }
      }
    } catch (err) {
      failed += 1;
      logger.error('clarificationTimeoutJob.row_failed', {
        clarificationId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: ClarificationTimeoutSummary = {
    scanned,
    expired,
    runsFlagged,
    failed,
    durationMs: Date.now() - started,
  };

  logger.info('clarificationTimeoutJob.tick_complete', { ...summary });

  return summary;
}
