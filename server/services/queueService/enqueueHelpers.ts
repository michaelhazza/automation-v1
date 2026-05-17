import { db } from '../../db/index.js';
import { executions, executionFiles, computeReservations } from '../../db/schema/index.js';
import { eq, lt, sql } from 'drizzle-orm';
import { env } from '../../lib/env.js';
import { getPgBoss } from '../../lib/pgBossInstance.js';
import { getJobConfig } from '../../config/jobConfig.js';
import { WORKFLOW_RESUME_QUEUE } from './types.js';
import { getQueueBackend } from './backend.js';

export async function enqueueExecution(executionId: string): Promise<void> {
  // Stamp the queuedAt time when the job enters the queue
  await db
    .update(executions)
    .set({ queuedAt: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, executionId));

  const backend = await getQueueBackend();
  await backend.enqueue(executionId);
}

/**
 * Generic job enqueue — used by event-driven follow-on jobs (e.g. the
 * ClientPulse intervention proposer that fires after compute_churn_risk).
 * Thin wrapper over the backend's send method so callers don't need to
 * reach into getQueueBackend() directly.
 */
export async function sendJob(queueName: string, data: object): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    // In-memory backend used in tests / dev has no named-queue routing;
    // silently no-op so calling code stays the same.
    return;
  }
  const boss = await getPgBoss();
  await boss.send(queueName, data);
}

/**
 * M-17: Delete expired execution_files rows.
 */
export async function cleanupExpiredExecutionFiles(): Promise<number> {
  const result = await db
    .delete(executionFiles)
    .where(lt(executionFiles.expiresAt, new Date()));
  const count = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
  if (count > 0) console.log(JSON.stringify({ event: 'maintenance:cleanup_execution_files', rows_deleted: count }));
  return count;
}

/**
 * M-18: Release stale budget_reservations left in 'active' status.
 * Reservations expire after 5 minutes if the billing flow crashes.
 * Mark them as 'released' so they no longer inflate projected spend.
 */
export async function cleanupExpiredComputeReservations(): Promise<number> {
  const result = await db
    .update(computeReservations)
    .set({ status: 'released' })
    .where(
      sql`${computeReservations.status} = 'active' AND ${computeReservations.expiresAt} < NOW()`
    );
  const count = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
  if (count > 0) console.log(JSON.stringify({ event: 'maintenance:release_budget_reservations', rows_released: count }));
  return count;
}

/**
 * Enqueue a workflow resume job. Called from the approval handler when an
 * action that was created by a workflow step (identified by workflowRunId
 * in the action's metadataJson) is approved.
 *
 * Falls back to direct synchronous resume if pg-boss is not available.
 */
export async function enqueueWorkflowResume(params: {
  workflowRunId: string;
  approvedActionId?: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
  agentRunId?: string;
}): Promise<void> {
  if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
    const boss = await getPgBoss();
    await boss.send(WORKFLOW_RESUME_QUEUE, params, getJobConfig('workflow-resume'));
    return;
  }

  // Synchronous fallback — resume inline (no restart resilience, but functional)
  const { resumeFlow } = await import('../flowExecutorService.js');
  resumeFlow(params.workflowRunId, {
    organisationId: params.organisationId,
    subaccountId: params.subaccountId,
    agentId: params.agentId,
    agentRunId: params.agentRunId,
  }, params.approvedActionId).catch((err) => {
    console.error('[WorkflowResume] Inline resume failed', err);
  });
}

/**
 * Sprint 2 P1.2 — enqueue a regression-capture job for a rejected
 * review item. Best-effort: uses pg-boss when available, falls back
 * to an in-process call when the backend is in-memory. Failures are
 * logged, not rethrown — the caller (reviewService.rejectItem) must
 * not fail the user's rejection on a capture error.
 */
export async function enqueueRegressionCapture(params: {
  reviewItemId: string;
  organisationId: string;
}): Promise<void> {
  try {
    if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
      const boss = await getPgBoss();
      await boss.send('regression-capture', params, getJobConfig('regression-capture'));
      return;
    }

    // In-memory fallback — run the capture inline so in-memory
    // deployments still accumulate cases. Fire-and-forget with a
    // catch so the rejection flow never sees a capture failure.
    const { captureRegressionFromRejection } = await import(
      '../regressionCaptureService.js'
    );
    captureRegressionFromRejection(params).catch((err) => {
      console.error(
        JSON.stringify({
          event: 'regression_capture_inline_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'regression_capture_enqueue_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
