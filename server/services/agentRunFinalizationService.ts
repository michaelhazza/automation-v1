/**
 * agentRunFinalizationService — transitions a parent agent_runs row from the
 * non-terminal 'delegated' state to a terminal state, based on the outcome of
 * a linked iee_runs row.
 *
 * Callers:
 *   1. server/jobs/ieeRunCompletedHandler.ts — pg-boss event handler, fires
 *      when the worker publishes 'iee-run-completed' after a terminal
 *      iee_runs write.
 *   2. server/jobs/ieeMainAppReconciliationJob.ts — periodic main-app-side
 *      reconciliation for the "Class 2" orphan: parent stuck in 'delegated'
 *      while iee_runs is already terminal. Recovery path if the event
 *      handler crashed or was never delivered.
 *
 * Idempotency: multiple invocations for the same iee_run are safe. The
 * function acquires a row lock on the parent agent_run and short-circuits
 * if the parent is already terminal and iee_runs.eventEmittedAt is set.
 *
 * See docs/iee-delegation-lifecycle-spec.md §3–5 for the full design.
 */

import { eq, sql, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { llmRequests } from '../db/schema/llmRequests.js';
import { emitAgentRunUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

type IeeRun = typeof ieeRuns.$inferSelect;

/**
 * Map a terminal iee_runs outcome to a terminal agent_runs status.
 *
 * Decisions baked in per docs/iee-delegation-lifecycle-spec.md Appendix A:
 *  - User-initiated cancellation (iee_runs.status='cancelled') → 'cancelled'
 *  - Worker-originated stoppage (failureReason='worker_terminated') → 'failed'
 *    (NOT 'cancelled' — worker termination is an infrastructure failure,
 *     not user intent)
 *  - timeout / budget_exceeded / step_limit_reached map to their closest
 *    existing parent enum value.
 *  - All other failures fall through to generic 'failed' with failureReason
 *    carried in the summary.
 */
export function mapIeeStatusToAgentRunStatus(
  ieeStatus: IeeRun['status'],
  failureReason: IeeRun['failureReason'],
): 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' {
  if (ieeStatus === 'completed') return 'completed';
  if (ieeStatus === 'cancelled') return 'cancelled';
  switch (failureReason) {
    case 'timeout':            return 'timeout';
    case 'budget_exceeded':    return 'budget_exceeded';
    case 'step_limit_reached': return 'loop_detected';
    default:                   return 'failed';
  }
}

/**
 * Build a human-readable summary for the parent agent_run from an iee_run
 * row. Prefers iee_runs.resultSummary when present; falls back to a
 * templated string derived from status + failureReason. Truncates at 500
 * chars with ellipsis.
 */
export function buildSummaryFromIeeRun(ieeRun: IeeRun): string {
  let summary: string;
  const result = ieeRun.resultSummary as Record<string, unknown> | null;
  if (result && typeof result.output === 'string' && result.output.length > 0) {
    summary = result.output;
  } else if (ieeRun.status === 'completed') {
    summary = `IEE ${ieeRun.type} task completed`;
  } else if (ieeRun.status === 'cancelled') {
    summary = `IEE ${ieeRun.type} task cancelled`;
  } else {
    const reason = ieeRun.failureReason ?? 'unknown';
    summary = `IEE ${ieeRun.type} task failed (${reason})`;
  }
  if (summary.length > 500) {
    summary = summary.slice(0, 497) + '...';
  }
  return summary;
}

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

async function aggregateTokensForIeeRun(ieeRunId: string): Promise<TokenTotals> {
  const [row] = await db
    .select({
      inputTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensIn}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensOut}), 0)::int`,
      totalTokens: sql<number>`COALESCE(SUM(${llmRequests.tokensIn} + ${llmRequests.tokensOut}), 0)::int`,
      llmCallCount: sql<number>`COUNT(*)::int`,
    })
    .from(llmRequests)
    .where(eq(llmRequests.ieeRunId, ieeRunId));
  return {
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    llmCallCount: Number(row?.llmCallCount ?? 0),
  };
}

/**
 * Transition a parent agent_runs row to terminal state based on a
 * terminal iee_runs row. Idempotent.
 *
 * Returns `true` if this call performed the transition, `false` if the
 * parent was already terminal (no-op).
 */
export async function finaliseAgentRunFromIeeRun(
  ieeRun: IeeRun,
): Promise<boolean> {
  // Only terminal iee_runs can finalise a parent. Defensive guard.
  if (ieeRun.status !== 'completed' && ieeRun.status !== 'failed' && ieeRun.status !== 'cancelled') {
    logger.warn('agentRunFinalization.non_terminal_iee_run', {
      ieeRunId: ieeRun.id,
      ieeStatus: ieeRun.status,
    });
    return false;
  }

  if (!ieeRun.agentRunId) {
    // Standalone IEE run with no parent agent_run. Still mark eventEmittedAt
    // so the worker's retry sweep stops re-firing.
    if (!ieeRun.eventEmittedAt) {
      await db
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(eq(ieeRuns.id, ieeRun.id));
    }
    return false;
  }

  const tokens = await aggregateTokensForIeeRun(ieeRun.id);

  let performedTransition = false;
  let resolvedStatus: 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' | null = null;

  await db.transaction(async (tx) => {
    // Row-level lock on the parent to prevent races between the event
    // handler and the reconciliation job.
    const [parent] = await tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, ieeRun.agentRunId!))
      .for('update')
      .limit(1);

    if (!parent) {
      logger.warn('agentRunFinalization.parent_missing', {
        ieeRunId: ieeRun.id,
        agentRunId: ieeRun.agentRunId,
      });
      if (!ieeRun.eventEmittedAt) {
        await tx
          .update(ieeRuns)
          .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
          .where(eq(ieeRuns.id, ieeRun.id));
      }
      return;
    }

    // Idempotent: parent already terminal AND iee event already marked.
    // If parent is terminal but iee event is not marked, fall through so
    // we can stamp the event emission even though no DB state change is
    // required on the parent.
    const parentAlreadyTerminal = parent.status !== 'delegated'
      && parent.status !== 'pending'
      && parent.status !== 'running';

    if (parentAlreadyTerminal && ieeRun.eventEmittedAt) {
      return;
    }

    const terminalStatus = mapIeeStatusToAgentRunStatus(ieeRun.status, ieeRun.failureReason);
    resolvedStatus = terminalStatus;
    const summary = buildSummaryFromIeeRun(ieeRun);
    const startedAt = parent.startedAt ?? ieeRun.startedAt ?? parent.createdAt;
    const completedAt = ieeRun.completedAt ?? new Date();
    const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

    if (!parentAlreadyTerminal) {
      await tx
        .update(agentRuns)
        .set({
          status: terminalStatus,
          summary,
          completedAt,
          durationMs,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          totalTokens: tokens.totalTokens,
          // For IEE-delegated runs, llm_requests count is the best proxy for
          // tool-call count we have on the app side. Worker-side step counts
          // live on iee_runs.stepCount and are surfaced separately.
          totalToolCalls: tokens.llmCallCount,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, parent.id));
      performedTransition = true;
    }

    if (!ieeRun.eventEmittedAt) {
      await tx
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(eq(ieeRuns.id, ieeRun.id));
    }
  });

  if (performedTransition && resolvedStatus) {
    emitAgentRunUpdate(ieeRun.agentRunId, 'agent:run:completed', {
      ieeRunId: ieeRun.id,
      finalStatus: resolvedStatus,
      failureReason: ieeRun.failureReason ?? null,
    });
    logger.info('agentRunFinalization.transitioned', {
      ieeRunId: ieeRun.id,
      agentRunId: ieeRun.agentRunId,
      fromStatus: 'delegated',
      toStatus: resolvedStatus,
      failureReason: ieeRun.failureReason ?? null,
    });
  }

  return performedTransition;
}

/**
 * Scan for "Class 2" orphans: agent_runs stuck in 'delegated' whose linked
 * iee_runs row is already terminal. Recovers cases where the event handler
 * crashed post-DB-write or the event was lost between worker emit and
 * main-app consume.
 *
 * Grace window: 120 seconds. Rows younger than that may be legitimately
 * between the worker's terminal write and the main-app handler firing.
 *
 * Returns the number of orphans transitioned.
 */
export async function reconcileStuckDelegatedRuns(): Promise<number> {
  const stuck = await db
    .select({
      agentRunId: agentRuns.id,
      ieeRun: ieeRuns,
    })
    .from(agentRuns)
    .innerJoin(ieeRuns, eq(ieeRuns.agentRunId, agentRuns.id))
    .where(
      and(
        eq(agentRuns.status, 'delegated'),
        sql`${ieeRuns.status} IN ('completed', 'failed', 'cancelled')`,
        isNull(ieeRuns.deletedAt),
        sql`${agentRuns.updatedAt} < now() - interval '120 seconds'`,
      ),
    )
    .limit(100);

  let transitioned = 0;
  for (const { ieeRun } of stuck) {
    try {
      const did = await finaliseAgentRunFromIeeRun(ieeRun);
      if (did) transitioned += 1;
    } catch (err) {
      logger.error('agentRunFinalization.reconciliation_failed', {
        ieeRunId: ieeRun.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (transitioned > 0) {
    logger.warn('agentRunFinalization.reconciled_stuck_delegated', {
      count: transitioned,
      candidates: stuck.length,
    });
  }

  return transitioned;
}
