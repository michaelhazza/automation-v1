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
  // state write above.
  if (bossRef) {
    try {
      await bossRef.send('iee-run-completed', {
        ieeRunId: input.ieeRunId,
        status: input.status,
        failureReason: input.failureReason,
        totalCostCents,
        stepCount: input.stepCount,
      }, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
    } catch (err) {
      logger.warn('iee.run_completed.emit_failed', {
        ieeRunId: input.ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
