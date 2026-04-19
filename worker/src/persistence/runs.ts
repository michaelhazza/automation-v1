// ---------------------------------------------------------------------------
// iee_runs persistence helpers — status transitions, terminal writes.
// Spec §5.1 (loop contract), §11.7.2 (denormalised costs), §13.7 (schema).
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { budgetReservations } from '../../../server/db/schema/budgetReservations.js';
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
  await db.transaction(async (tx) => {
    await tx
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
      .where(eq(ieeRuns.id, input.ieeRunId));

    // Release the soft reservation (committed status closes the lifecycle)
    await tx
      .update(budgetReservations)
      .set({
        status: 'committed',
        actualCostCents: totalCostCents,
      })
      .where(eq(budgetReservations.idempotencyKey, `iee:${input.ieeRunId}`));
  });

  // ── Reconnect hook (Appendix A.1 / reviewer round 2) ──────────────────────
  // Emit a pg-boss event so the main app can subscribe and resume the parent
  // agent run. Best-effort: a failure to emit must not undo the terminal
  // state write above. eventEmittedAt is set ONLY on successful emit so the
  // cleanup job can retry nulls (reviewer round 3 #1).
  if (bossRef) {
    try {
      await bossRef.send('iee-run-completed', {
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
