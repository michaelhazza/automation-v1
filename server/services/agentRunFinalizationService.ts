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

import { eq, sql, and, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { llmRequests } from '../db/schema/llmRequests.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';
import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
} from './agentRunFinalizationServicePure.js';
import { computeRunResultStatus } from './agentExecutionServicePure.js';

// Re-export the pure helpers so existing importers don't need to update
// their import paths. The DB-touching entry points below are the only
// additions here.
export { mapIeeStatusToAgentRunStatus, buildSummaryFromIeeRun };

type IeeRun = typeof ieeRuns.$inferSelect;

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Aggregate token + call counts from llm_requests for an iee_run.
 *
 * Takes a tx handle so the aggregation runs inside the same transaction as
 * the parent-run update. Previously this was called BEFORE the transaction
 * opened and llm_requests inserted in the window between the aggregation
 * query and the transaction's FOR UPDATE lock were silently missed from
 * the rolled-up counts (pr-reviewer blocker #4).
 */
async function aggregateTokensForIeeRun(tx: TxLike, ieeRunId: string): Promise<TokenTotals> {
  const [row] = await tx
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

  let performedTransition = false;
  let resolvedStatus: 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' | null = null;
  // Captured inside the tx so we can emit the subaccount-level
  // 'live:agent_completed' event after commit (Codex dual-review finding #3).
  // The non-IEE execution path emits this event from agentExecutionService,
  // but the IEE delegation branch returns early before those emitters run,
  // so the sidebar/live counters never decrement for delegated runs.
  let parentSubaccountId: string | null = null;
  let parentIsSubAgent = false;
  let parentAgentId: string | null = null;

  await db.transaction(async (tx) => {
    // IMPORTANT: this transaction deliberately does NOT invoke the normal
    // post-completion hooks that the non-IEE path runs in
    // agentExecutionService (buildHandoffForRun, memoryCitationDetector,
    // notifyWorkflowEngineOnAgentRunComplete, toolCallsLog snapshot write).
    // IEE-delegated runs do not currently receive handoffs, memory-
    // citation scoring, or playbook completion notifications. Tracked as
    // a known gap; see docs/iee-delegation-lifecycle-spec.md "Out of
    // scope" and pr-reviewer finding #11.
    //
    // Defensive re-check inside the transaction: the null guard at the
    // function entry is correct today, but keeping the check here makes
    // the transaction block self-contained so future refactors cannot
    // accidentally lift it out. (pr-reviewer finding #7.)
    if (!ieeRun.agentRunId) {
      if (!ieeRun.eventEmittedAt) {
        await tx
          .update(ieeRuns)
          .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
          .where(eq(ieeRuns.id, ieeRun.id));
      }
      return;
    }

    // Row-level lock on the parent to prevent races between the event
    // handler and the reconciliation job.
    const [parent] = await tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, ieeRun.agentRunId))
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
    parentSubaccountId = parent.subaccountId ?? null;
    parentIsSubAgent = parent.isSubAgent ?? false;
    parentAgentId = parent.agentId ?? null;
    const summary = buildSummaryFromIeeRun(ieeRun);
    const startedAt = parent.startedAt ?? ieeRun.startedAt ?? parent.createdAt;
    const completedAt = ieeRun.completedAt ?? new Date();
    const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

    // Codex iteration-3 finding P2: on failure, the RunTraceView "Error
    // Details" panel reads agent_runs.errorMessage + errorDetail. The
    // previous IEE finaliser only set status + summary, so delegated-run
    // failures showed an empty panel even though the worker produced a
    // concrete failureReason and resultSummary payload.
    const isFailureStatus = terminalStatus === 'failed'
      || terminalStatus === 'timeout'
      || terminalStatus === 'loop_detected'
      || terminalStatus === 'budget_exceeded';
    const errorMessage = isFailureStatus
      ? `IEE run ${ieeRun.failureReason ?? 'failed'}`
      : null;
    const errorDetail = isFailureStatus
      ? {
          failureReason: ieeRun.failureReason,
          ieeRunId: ieeRun.id,
          resultSummary: ieeRun.resultSummary,
        }
      : null;

    if (!parentAlreadyTerminal) {
      // Roll up token + call counts inside the transaction so late
      // llm_requests inserts (up to the FOR UPDATE lock) are included.
      // See aggregateTokensForIeeRun JSDoc for the race this avoids.
      const tokens = await aggregateTokensForIeeRun(tx, ieeRun.id);

      // Hermes Tier 1 Phase B §6.3 / §6.3.1 — derive runResultStatus for
      // the IEE-delegated terminal transition using the same pure helper
      // as the main path so identical inputs yield identical derivations.
      // `hadUncertainty` is not tracked on the IEE path; pass `false`.
      const ieeDerivedRunResultStatus = computeRunResultStatus(
        terminalStatus,
        /* hasError */ isFailureStatus,
        /* hadUncertainty */ false,
        /* hasSummary */ !!(summary && summary.trim().length > 0),
      );

      // Defence-in-depth: gate the terminal transition on the parent's
      // current status being non-terminal. FOR UPDATE + the
      // parentAlreadyTerminal check above already serialise writers, but
      // this WHERE adds a DB-level guarantee that a future refactor
      // losing the application check cannot accidentally overwrite a
      // terminal parent row. (External review finding: Blocker 2.)
      // Phase B: also gate on `runResultStatus IS NULL` so a retry that
      // somehow re-enters this branch cannot overwrite a prior writer's
      // classification (§6.3.1 write-once invariant).
      const updated = await tx
        .update(agentRuns)
        .set({
          status: terminalStatus,
          runResultStatus: ieeDerivedRunResultStatus,
          summary,
          errorMessage,
          errorDetail,
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
        .where(and(
          eq(agentRuns.id, parent.id),
          inArray(agentRuns.status, ['pending', 'running', 'delegated'] as const),
          // isNull(completedAt) is pre-existing defense-in-depth for the parent's
          // transitional gate. The write-once invariant for Phase B is guaranteed by
          // isNull(runResultStatus) alone; the completedAt guard can cause the update
          // to be silently skipped if completedAt is set by an external path (e.g.,
          // admin backfill) before runResultStatus is written. See PR review S4.
          isNull(agentRuns.completedAt),
          isNull(agentRuns.runResultStatus),
        ))
        .returning({ id: agentRuns.id });
      performedTransition = updated.length > 0;
      if (!performedTransition) {
        logger.warn('runResultStatus.write_skipped', {
          runId: parent.id,
          ieeRunId: ieeRun.id,
          attemptedStatus: ieeDerivedRunResultStatus,
          writeSite: 'finaliseAgentRunFromIeeRun',
        });
      }
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

    // Codex dual-review finding #3: the non-IEE path pairs every
    // 'live:agent_started' emission with a matching 'live:agent_completed'
    // on the subaccount room when the run terminates. IEE-delegated runs
    // also fire 'live:agent_started' at enqueue time (agentExecutionService
    // runs that emission before the delegation branch), so without the
    // mirror emission here the Layout sidebar badge and AdminAgentsPage
    // counter never decrement for delegated runs — they stay stuck until
    // the next full REST reload. Only subaccount-scoped, non-sub-agent
    // runs update these badges, matching the emission rules on the
    // start/complete pair in agentExecutionService.
    if (parentSubaccountId && !parentIsSubAgent) {
      emitSubaccountUpdate(parentSubaccountId, 'live:agent_completed', {
        runId: ieeRun.agentRunId,
        agentId: parentAgentId,
        ieeRunId: ieeRun.id,
        finalStatus: resolvedStatus,
      });
    }

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
