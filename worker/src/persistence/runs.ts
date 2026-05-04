// ---------------------------------------------------------------------------
// iee_runs persistence helpers — status transitions, terminal writes.
// Spec §5.1 (loop contract), §11.7.2 (denormalised costs), §13.7 (schema).
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { computeReservations } from '../../../server/db/schema/computeReservations.js';
import { llmRequests } from '../../../server/db/schema/llmRequests.js';
import type { ResultSummary } from '../../../shared/iee/jobPayload.js';
import type { FailureReason } from '../../../shared/iee/failureReason.js';
import { logger } from '../logger.js';

// Lazy boss reference set by bootstrap so persistence/runs.ts can emit
// iee-run-completed events without a circular import on bootstrap.ts.
let bossRef: PgBoss | null = null;
export function setPersistenceBoss(boss: PgBoss): void {
  bossRef = boss;
}

export interface IeeRunRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string | null;
  type: 'browser' | 'dev';
  status: 'pending' | 'running' | 'completed' | 'failed';
  goal: string;
  task: unknown;
  correlationId: string;
}

export async function loadRun(ieeRunId: string): Promise<IeeRunRow | null> {
  const [row] = await db
    .select()
    .from(ieeRuns)
    .where(and(eq(ieeRuns.id, ieeRunId), isNull(ieeRuns.deletedAt)))
    .limit(1);
  if (!row) return null;
  return {
    id:             row.id,
    organisationId: row.organisationId,
    subaccountId:   row.subaccountId ?? null,
    agentId:        row.agentId,
    agentRunId:     row.agentRunId ?? null,
    type:           row.type as 'browser' | 'dev',
    status:         row.status as IeeRunRow['status'],
    goal:           row.goal,
    task:           row.task,
    correlationId:  row.correlationId,
  };
}

/** Mark the run as running and stamp worker ownership. Returns false if the
 *  row is not currently 'pending' (defensive guard against pg-boss double
 *  delivery — spec §2.2 step 4). */
export async function markRunning(ieeRunId: string, workerInstanceId: string): Promise<boolean> {
  const result = await db
    .update(ieeRuns)
    .set({
      status: 'running',
      startedAt: new Date(),
      workerInstanceId,
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(ieeRuns.id, ieeRunId), eq(ieeRuns.status, 'pending')))
    .returning({ id: ieeRuns.id });
  return result.length > 0;
}

export interface FinalizeRunInput {
  ieeRunId: string;
  status: 'completed' | 'failed';
  failureReason: FailureReason | null;
  resultSummary: ResultSummary;
  stepCount: number;
  llmCostCents: number;
  llmCallCount: number;
  runtimeWallMs: number;
  runtimeCpuMs: number;
  runtimePeakRssBytes: number;
  runtimeCostCents: number;
}

/** Terminal status write. Releases the budget reservation atomically. */
export async function finalizeRun(input: FinalizeRunInput): Promise<void> {
  const totalCostCents = input.llmCostCents + input.runtimeCostCents;
  // Terminal immutability guard: only update if the row is still in a
  // non-terminal state. If claimed is empty the row was already terminal
  // (double delivery, reconcile pre-empt, etc.) and we must not emit a
  // second reconnect event. External review Blocker 7.
  let claimedThisCall = false;
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(ieeRuns)
      .set({
        status:             input.status,
        completedAt:        new Date(),
        failureReason:      input.failureReason ?? undefined,
        resultSummary:      input.resultSummary,
        stepCount:          input.stepCount,
        llmCostCents:       input.llmCostCents,
        llmCallCount:       input.llmCallCount,
        runtimeWallMs:      input.runtimeWallMs,
        runtimeCpuMs:       input.runtimeCpuMs,
        runtimePeakRssBytes: input.runtimePeakRssBytes,
        runtimeCostCents:   input.runtimeCostCents,
        totalCostCents,
        updatedAt:          new Date(),
      })
      .where(and(
        eq(ieeRuns.id, input.ieeRunId),
        inArray(ieeRuns.status, ['pending', 'running']),
      ))
      .returning({ id: ieeRuns.id });
    if (claimed.length === 0) {
      logger.warn('iee.finalize.already_terminal', {
        ieeRunId: input.ieeRunId,
        attemptedStatus: input.status,
      });
      return;
    }
    claimedThisCall = true;

    // Release the soft reservation (committed status closes the lifecycle)
    await tx
      .update(computeReservations)
      .set({
        status: 'committed',
        actualCostCents: totalCostCents,
      })
      .where(eq(computeReservations.idempotencyKey, `iee:${input.ieeRunId}`));
  });

  if (!claimedThisCall) {
    // No terminal write happened this call — skip the event emit so the
    // main-app handler only sees one iee-run-completed per run. The
    // cleanup sweep will re-emit if the original event was lost.
    return;
  }

  // ── Reconnect hook (Appendix A.1 / reviewer round 2) ──────────────────────
  // Emit a pg-boss event so the main app can subscribe and resume the parent
  // agent run. Best-effort: a failure to emit must not undo the terminal
  // state write above. eventEmittedAt is set ONLY on successful emit so the
  // cleanup job can retry nulls (reviewer round 3 #1).
  if (bossRef) {
    try {
      await bossRef.send('iee-run-completed', {
        // Event version — bump on any breaking change to the payload
        // shape. Consumers reject unknown versions rather than silently
        // mis-parsing. External review Blocker 6 — relevant for the
        // Phase 5 external-worker trust boundary but cheap to add now.
        version: 1,
        // Reviewer round 4 #1 — deterministic dedup key. The retry sweep
        // re-emits any terminal row whose eventEmittedAt is still NULL,
        // including rows where the original send succeeded but the column
        // update failed. Consumers can skip duplicates by tracking eventKey.
        eventKey: `${input.ieeRunId}:${input.status}`,
        ieeRunId: input.ieeRunId,
        status: input.status,
        failureReason: input.failureReason,
        totalCostCents,
        stepCount: input.stepCount,
      }, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
      await db
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date() })
        .where(eq(ieeRuns.id, input.ieeRunId));
    } catch (err) {
      logger.warn('iee.run_completed.emit_failed', {
        ieeRunId: input.ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Leave eventEmittedAt NULL — cleanup job will retry.
    }
  }
}

/**
 * Retry the iee-run-completed event for any terminal row whose
 * eventEmittedAt is still NULL. Called by iee-cleanup-orphans.
 */
export async function retryUnemittedEvents(): Promise<number> {
  if (!bossRef) return 0;
  const candidates = await db
    .select({
      id: ieeRuns.id,
      status: ieeRuns.status,
      failureReason: ieeRuns.failureReason,
      totalCostCents: ieeRuns.totalCostCents,
      stepCount: ieeRuns.stepCount,
    })
    .from(ieeRuns)
    .where(
      and(
        isNull(ieeRuns.eventEmittedAt),
        isNull(ieeRuns.deletedAt),
        // Only terminal rows. 'cancelled' added in IEE Phase 0 for
        // symmetry with the main-app reconciliation sweep — if the
        // initial emit for a cancelled run fails transiently, the sweep
        // must re-emit. Previously the sweep skipped cancelled and the
        // main-app Class 2 reconciliation was the sole recovery path.
        sql`${ieeRuns.status} IN ('completed', 'failed', 'cancelled')`,
      ),
    )
    .limit(200);

  let retried = 0;
  for (const r of candidates) {
    try {
      await bossRef.send('iee-run-completed', {
        version: 1,
        // Same deterministic dedup key as the primary emit site so a
        // consumer dedupe table can collapse the two paths to one event.
        eventKey: `${r.id}:${r.status}`,
        ieeRunId: r.id,
        status: r.status,
        failureReason: r.failureReason,
        totalCostCents: r.totalCostCents,
        stepCount: r.stepCount,
      }, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
      await db
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date() })
        .where(eq(ieeRuns.id, r.id));
      retried++;
    } catch (err) {
      logger.warn('iee.run_completed.retry_failed', {
        ieeRunId: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return retried;
}

/**
 * Reviewer round 3 #3 — assert this worker still owns the run before doing
 * anything destructive in a step. Cheap (single PK read). Returns false if
 * another worker has reclaimed the row (e.g. boot reconciliation flipped it
 * to failed during a long-running step) so the loop can abort cleanly
 * without writing further state into a row it no longer owns.
 */
export async function assertWorkerOwnership(
  ieeRunId: string,
  expectedWorkerInstanceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ workerInstanceId: ieeRuns.workerInstanceId, status: ieeRuns.status })
    .from(ieeRuns)
    .where(eq(ieeRuns.id, ieeRunId))
    .limit(1);
  if (!row) return false;
  if (row.status !== 'running') return false;
  return row.workerInstanceId === expectedWorkerInstanceId;
}

// ---------------------------------------------------------------------------
// Spend round-trip helpers — iee-spend-request and iee-spend-completion emit
// (Agentic Commerce Chunk 11, spec §7.2, §8.3, §8.4a)
// ---------------------------------------------------------------------------

/**
 * Emit an agent-spend-request job to the main app.
 *
 * Called from the execution loop when the LLM emits a `spend_request` action.
 * The worker pre-builds the idempotency key; the main app recomputes and
 * rejects on mismatch (invariant 21).
 *
 * INVARIANT 3: The worker MUST carry agent_charges.idempotency_key as Stripe's
 * Idempotency-Key header on every merchant call. The idempotencyKey field in
 * this payload is that value — emitted to the main app here and later used
 * as the Stripe header when filling the merchant form on the worker_hosted_form path.
 */
export async function emitSpendRequest(
  payload: import('../../../shared/iee/actionSchema.js').SpendRequestPayload,
): Promise<void> {
  if (!bossRef) {
    logger.warn('iee.spend_request.boss_not_ready', { correlationId: payload.correlationId });
    return;
  }
  try {
    await bossRef.send('agent-spend-request', payload, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
    });
  } catch (err) {
    logger.warn('iee.spend_request.emit_failed', {
      correlationId: payload.correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err; // propagate so the loop can record the failure
  }
}

/**
 * Emit an agent-spend-completion job to the main app.
 *
 * Called from the execution loop after the worker fills the merchant's hosted
 * payment form (worker_hosted_form path). Reports whether the form-fill
 * succeeded or failed. The main app's handler updates the agent_charges row
 * per invariant 20.
 */
export async function emitSpendCompletion(
  payload: import('../../../shared/iee/actionSchema.js').SpendCompletionPayload,
): Promise<void> {
  if (!bossRef) {
    logger.warn('iee.spend_completion.boss_not_ready', { ledgerRowId: payload.ledgerRowId });
    return;
  }
  try {
    await bossRef.send('agent-spend-completion', payload, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
    });
  } catch (err) {
    logger.warn('iee.spend_completion.emit_failed', {
      ledgerRowId: payload.ledgerRowId,
      outcome: payload.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err; // propagate so the loop can record the failure
  }
}

/**
 * Poll the agent-spend-response queue for a response matching the given correlationId.
 * Returns the response payload if found within the timeout, or null on timeout.
 *
 * The 30-second deadline applies only to the IMMEDIATE decision response — not
 * to HITL approval resolution or merchant form-fill duration (spec §8.4).
 */
export async function awaitSpendResponse(
  correlationId: string,
  timeoutMs: number,
): Promise<import('../../../server/jobs/agentSpendRequestHandler.js').WorkerSpendResponse | null> {
  if (!bossRef) return null;

  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 200;

  while (Date.now() < deadline) {
    try {
      // Fetch next available job from the response queue.
      const jobs = await bossRef.fetch('agent-spend-response', 10);
      if (jobs) {
        const jobArray = Array.isArray(jobs) ? jobs : [jobs];
        for (const job of jobArray) {
          const data = job.data as Record<string, unknown>;
          if (data.correlationId === correlationId) {
            // Ack the job so it's removed from the queue.
            await bossRef.complete(job.id);
            return data as import('../../../server/jobs/agentSpendRequestHandler.js').WorkerSpendResponse;
          }
          // Not our correlationId — re-queue (nack) so another worker can pick it up.
          // pg-boss fetch does not nack automatically so we complete it back as a new job.
          // Since we can't put it back, complete and re-send so we don't drop it.
          await bossRef.complete(job.id);
          await bossRef.send('agent-spend-response', data);
        }
      }
    } catch (err) {
      logger.warn('iee.spend_response.poll_error', {
        correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return null; // timeout
}

/** Aggregate LLM cost for the run from llm_requests, used at finalization. */
export async function sumLlmCostForRun(ieeRunId: string): Promise<{ cents: number; callCount: number }> {
  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${llmRequests.costWithMarginCents}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(llmRequests)
    .where(eq(llmRequests.ieeRunId, ieeRunId));
  return {
    cents: Number(row?.cents ?? 0),
    callCount: Number(row?.count ?? 0),
  };
}
