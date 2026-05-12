/**
 * operatorSessionProgressedHandler — sole writer for last_progress_at + step_count.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.9, §10.4
 *
 * Sole writer contract:
 *   UPDATE operator_runs
 *   SET last_progress_at = greatest(coalesce(last_progress_at, '-infinity'), $ts),
 *       step_count = greatest(step_count, $idx)
 *   WHERE id = $1 AND status = 'running'
 *
 * The WHERE status='running' guard drops post-terminal events silently
 * (logs the drop; no WebSocket emit).
 *
 * Also emits:
 *   - 'operator-session.progressed' WebSocket event on every step.
 *   - 'operator-session.preparing_checkpoint' when is_resumable_now is present.
 *   - 'operator-session.auto_extending' once per chain link (singleton key guard).
 */

import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { operatorRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { createWorker } from '../lib/createWorker.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';

export const OPERATOR_SESSION_PROGRESSED_QUEUE = 'operator-session-progressed';

const payloadSchema = z.object({
  operatorRunId: z.string().uuid(),
  agentRunId: z.string().uuid(),
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  progressedAt: z.string().datetime(),
  /** is_resumable_now field from checkpoint step-state payload (deferred-verification field name). */
  isResumableNow: z.boolean().optional(),
  /** Whether auto-extend grace period is active. */
  isAutoExtending: z.boolean().optional(),
});

type ProgressedPayload = z.infer<typeof payloadSchema>;

/**
 * Registers the operator-session-progressed pg-boss handler.
 */
export async function registerOperatorSessionProgressedHandler(boss: PgBoss): Promise<void> {
  await createWorker<Record<string, unknown>>({
    queue: OPERATOR_SESSION_PROGRESSED_QUEUE,
    boss,
    concurrency: 8,
    resolveOrgContext: (job) => {
      const data = (job.data ?? {}) as Record<string, unknown>;
      const organisationId = data.organisationId;
      const subaccountId = data.subaccountId;
      if (typeof organisationId !== 'string' || typeof subaccountId !== 'string') return null;
      return { organisationId, subaccountId };
    },
    handler: async (job) => {
      const parsed = payloadSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn('operator.session_progressed.invalid_payload', {
          jobId: job.id,
          issues: parsed.error.issues,
        });
        return;
      }

      const payload = parsed.data as ProgressedPayload;
      const { operatorRunId, agentRunId, organisationId, subaccountId, stepIndex, progressedAt, isResumableNow, isAutoExtending } = payload;

      const progressTs = new Date(progressedAt);

      // Sole writer update with NULL-safe greatest() and post-terminal guard.
      let updatedRows: Array<{ id: string; status: string }> = [];

      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, organisationId, subaccountId);

        updatedRows = await tx
          .update(operatorRuns)
          .set({
            lastProgressAt: sql`greatest(coalesce(${operatorRuns.lastProgressAt}, '-infinity'::timestamptz), ${progressTs})`,
            stepCount: sql`greatest(${operatorRuns.stepCount}, ${stepIndex})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operatorRuns.id, operatorRunId),
              eq(operatorRuns.status, 'running'),
            ),
          )
          .returning({ id: operatorRuns.id, status: operatorRuns.status });
      });

      if (updatedRows.length === 0) {
        // Post-terminal event — drop silently.
        logger.info('operator.session_progressed.post_terminal_drop', {
          operatorRunId,
          agentRunId,
          stepIndex,
        });
        return;
      }

      // Emit progressed WebSocket event.
      emitAgentRunUpdate(agentRunId, 'operator-session.progressed', {
        operatorRunId,
        stepIndex,
        progressedAt,
      });

      // Emit preparing_checkpoint when is_resumable_now is true.
      if (isResumableNow === true) {
        emitAgentRunUpdate(agentRunId, 'operator-session.preparing_checkpoint', {
          operatorRunId,
          stepIndex,
        });
      }

      // Emit auto_extending once per chain link (singleton key via pg-boss).
      if (isAutoExtending === true) {
        try {
          const { getPgBoss } = await import('../lib/pgBossInstance.js');
          const bossInstance = await getPgBoss();
          await bossInstance.send(
            'operator-session-progressed',
            {
              operatorRunId,
              agentRunId,
              organisationId,
              subaccountId,
              stepIndex: -1, // sentinel: auto-extending signal
              progressedAt: new Date().toISOString(),
              isAutoExtendingEmit: true,
            },
            {
              singletonKey: `operator-auto-extending:${operatorRunId}`,
            },
          );
          emitAgentRunUpdate(agentRunId, 'operator-session.auto_extending', {
            operatorRunId,
          });
        } catch (err) {
          logger.warn('operator.session_progressed.auto_extending_emit_failed', {
            operatorRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  });

  logger.info('operator.session_progressed.handler_registered');
}
