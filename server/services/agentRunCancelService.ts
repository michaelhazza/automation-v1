/**
 * agentRunCancelService — user-triggered cancellation of an in-flight
 * agent run.
 *
 * Mirrors the workflow run cancel pattern (workflowRunService.cancelRun):
 *  1. 404 if the run does not belong to the calling org.
 *  2. Idempotent no-op if the run is already terminal.
 *  3. Sets agent_runs.status = 'cancelling'.
 *  4. If the run was delegated to an IEE worker, writes the linked
 *     iee_runs row to status='cancelled' (gated WHERE status IN
 *     ('pending','running') so the terminal-finality contract on
 *     iee_runs is preserved) and enqueues an iee-run-completed event so
 *     finaliseAgentRunFromIeeRun parks the parent on 'cancelled'.
 *  5. For non-IEE in-process runs, the running agentExecutionService
 *     loop reads agent_runs.status at the top of each iteration and
 *     exits cleanly on 'cancelling'. No further action required here.
 *
 * Scope (intentional):
 *  - Best-effort stop. Side-effects already committed by tools that
 *    ran before the cancel observation are NOT rolled back. Same
 *    semantics as workflow run cancel.
 *  - The 'cancelling' status is non-terminal. The run reaches
 *    'cancelled' once the loop / worker observes the request and
 *    finalises.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { logger } from '../lib/logger.js';
import { isTerminalRunStatus } from '../../shared/runStatus.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';

const IEE_RUN_COMPLETED_QUEUE = 'iee-run-completed';

interface CancelResult {
  /** Final status the row landed on after the cancel call. */
  status: 'cancelling' | 'cancelled' | string;
  /** True when this call performed the transition; false on no-op (already terminal or already cancelling). */
  performedTransition: boolean;
}

export const agentRunCancelService = {
  async cancelRun(
    organisationId: string,
    runId: string,
    userId: string,
  ): Promise<CancelResult> {
    // ── 1. Read parent agent_run, scoped to org ──────────────────────────────
    const [run] = await db
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        ieeRunId: agentRuns.ieeRunId,
        organisationId: agentRuns.organisationId,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, organisationId)))
      .limit(1);

    if (!run) {
      throw { statusCode: 404, message: 'Agent run not found' };
    }

    // ── 2. Idempotent no-op if already terminal or already cancelling ────────
    if (isTerminalRunStatus(run.status) || run.status === 'cancelling') {
      return { status: run.status, performedTransition: false };
    }

    // ── 3. Flip parent to 'cancelling' ───────────────────────────────────────
    // Gated WHERE excludes terminal states + cancelling so concurrent cancel
    // requests collapse to a single transition.
    const updated = await db
      .update(agentRuns)
      .set({ status: 'cancelling', updatedAt: new Date() })
      .where(and(
        eq(agentRuns.id, run.id),
        inArray(agentRuns.status, ['pending', 'running', 'delegated'] as const),
      ))
      .returning({ id: agentRuns.id });

    if (updated.length === 0) {
      // Race with finaliser — re-read to report the actual current state.
      const [refreshed] = await db
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, run.id))
        .limit(1);
      return { status: refreshed?.status ?? run.status, performedTransition: false };
    }

    logger.info('agent_run.cancel_requested', {
      runId: run.id,
      organisationId,
      userId,
      previousStatus: run.status,
      ieeRunId: run.ieeRunId ?? null,
    });

    emitAgentRunUpdate(run.id, 'agent:run:cancelling', {
      runId: run.id,
      previousStatus: run.status,
    });

    // ── 4. IEE-delegated path: stop the worker via the iee_runs row ──────────
    if (run.ieeRunId) {
      await this.cancelIeeRun(run.ieeRunId);
    }

    // ── 5. Non-IEE path: in-process loop polls agent_runs.status and exits ──
    // Nothing else to do here.

    return { status: 'cancelling', performedTransition: true };
  },

  /**
   * Write iee_runs.status='cancelled' and emit an iee-run-completed event so
   * finaliseAgentRunFromIeeRun parks the parent. Gated on the iee_runs
   * terminal-finality contract (only writes if currently pending/running).
   *
   * Exposed separately so tests and reconciliation jobs can call it without
   * going through cancelRun.
   */
  async cancelIeeRun(ieeRunId: string): Promise<void> {
    const now = new Date();
    // Per shared/iee/failureReason.ts decision 1, user-initiated cancellation
    // is signalled by iee_runs.status='cancelled' alone — failureReason stays
    // null. Worker-originated stoppage uses 'worker_terminated' instead.
    const updated = await db
      .update(ieeRuns)
      .set({
        status: 'cancelled',
        completedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(ieeRuns.id, ieeRunId),
        inArray(ieeRuns.status, ['pending', 'running'] as const),
      ))
      .returning({ id: ieeRuns.id });

    if (updated.length === 0) {
      // Already terminal — finaliser will handle (or has handled) the parent.
      logger.info('agent_run.cancel.iee_already_terminal', { ieeRunId });
      return;
    }

    // Enqueue the iee-run-completed event so finaliseAgentRunFromIeeRun runs.
    // Payload mirrors the worker's emitted shape (server/jobs/ieeRunCompletedHandler.ts).
    try {
      const boss = await getPgBoss();
      const config = getJobConfig(IEE_RUN_COMPLETED_QUEUE);
      await boss.send(
        IEE_RUN_COMPLETED_QUEUE,
        {
          version: 1,
          eventKey: `cancel:${ieeRunId}:${now.getTime()}`,
          ieeRunId,
          status: 'cancelled' as const,
          failureReason: null,
        },
        config,
      );
    } catch (err) {
      // Non-fatal — the periodic reconciler (ieeMainAppReconciliationJob)
      // will pick up the orphan via the eventEmittedAt IS NULL sweep.
      logger.warn('agent_run.cancel.iee_event_publish_failed', {
        ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
