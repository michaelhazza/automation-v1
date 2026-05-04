// ---------------------------------------------------------------------------
// ieeExecutionService — enqueue path for the Integrated Execution Environment.
//
// Spec: docs/iee-development-spec.md §3.3, §9, §11.5.8 (budget enforcement),
//       §13.1 (executionRunId integrity), §13.2 (reservation), §13.6.1 (TTL).
//
// Responsibilities:
//   1. Validate the task payload + tenant scope.
//   2. Idempotent insert into iee_runs (DB-level unique constraint).
//   3. Conservative cost estimate.
//   4. Reuse the existing budget_reservations table for the soft reservation.
//   5. Enqueue the pg-boss job.
//
// The worker picks up the job and updates the iee_runs row by id. The id is
// passed on the payload — never re-derived — so the reservation lifecycle is
// strictly tied to the row.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { computeReservations } from '../db/schema/computeReservations.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { createEvent } from '../lib/tracing.js';
import {
  IEEJobPayload,
  IEETask,
  type BrowserTaskPayload,
  type DevTaskPayload,
} from '../../shared/iee/jobPayload.js';

// ---------------------------------------------------------------------------
// Cost estimation — conservative; better to over-reserve and reject than to
// under-reserve and overspend. Tunable via env (no code change to adjust).
// ---------------------------------------------------------------------------

const MAX_STEPS_DEFAULT = Number(process.env.IEE_MAX_STEPS ?? '25');
const AVG_LLM_COST_CENTS_PER_STEP = Number(process.env.IEE_AVG_LLM_COST_CENTS_PER_STEP ?? '5');
const FLAT_RUNTIME_COST_CENTS = Number(process.env.IEE_FLAT_RUNTIME_COST_CENTS ?? '20');

export function estimateIeeCostCents(_task: BrowserTaskPayload | DevTaskPayload): number {
  return MAX_STEPS_DEFAULT * AVG_LLM_COST_CENTS_PER_STEP + FLAT_RUNTIME_COST_CENTS;
}

// ---------------------------------------------------------------------------
// Idempotency key — derived (not random) so retries of the same agent step
// do not double-execute. Pattern matches the existing llmRouter convention.
// ---------------------------------------------------------------------------

function deriveIdempotencyKey(input: {
  organisationId: string;
  agentRunId: string;
  agentId: string;
  task: BrowserTaskPayload | DevTaskPayload;
}): string {
  const taskHash = createHash('sha256')
    .update(JSON.stringify(input.task))
    .digest('hex')
    .slice(0, 32);
  return createHash('sha256')
    .update([input.organisationId, input.agentRunId, input.agentId, taskHash].join(':'))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Service input/output
// ---------------------------------------------------------------------------

export interface EnqueueIEETaskInput {
  task: BrowserTaskPayload | DevTaskPayload;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  agentRunId: string;
  correlationId: string;
}

export interface EnqueueIEETaskResult {
  ieeRunId: string;
  deduplicated: boolean;
  // 'cancelled' added in IEE Phase 0 (docs/iee-delegation-lifecycle-spec.md)
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enqueueIEETask(input: EnqueueIEETaskInput): Promise<EnqueueIEETaskResult> {
  // ── 1. Validate task ──────────────────────────────────────────────────────
  const task = IEETask.parse(input.task);

  // ── 2. Validate tenant scope ──────────────────────────────────────────────
  if (input.subaccountId) {
    await resolveSubaccount(input.subaccountId, input.organisationId);
  }

  // ── 3. Derive idempotency key ─────────────────────────────────────────────
  const idempotencyKey = deriveIdempotencyKey({
    organisationId: input.organisationId,
    agentRunId: input.agentRunId,
    agentId: input.agentId,
    task,
  });

  // ── 4. Idempotent insert ──────────────────────────────────────────────────
  // The unique partial index on iee_runs.idempotency_key (WHERE deleted_at IS
  // NULL) prevents duplicates at the DB layer. ON CONFLICT DO NOTHING +
  // RETURNING gives us a single round-trip race-safe upsert.
  const inserted = await db
    .insert(ieeRuns)
    .values({
      agentRunId:      input.agentRunId,
      organisationId:  input.organisationId,
      subaccountId:    input.subaccountId ?? undefined,
      agentId:         input.agentId,
      type:            task.type,
      mode:            task.type,
      status:          'pending',
      idempotencyKey,
      correlationId:   input.correlationId,
      goal:            task.goal,
      task,
    })
    .onConflictDoNothing()
    .returning({ id: ieeRuns.id, status: ieeRuns.status });

  if (inserted.length === 0) {
    // Existing row — apply the §2.2 behaviour table
    const [existing] = await db
      .select({ id: ieeRuns.id, status: ieeRuns.status })
      .from(ieeRuns)
      .where(and(eq(ieeRuns.idempotencyKey, idempotencyKey), isNull(ieeRuns.deletedAt)))
      .limit(1);

    if (!existing) {
      // Vanishingly rare race: insert hit conflict but row was soft-deleted
      // between conflict and select. Treat as a hard failure for the caller
      // to retry.
      throw {
        statusCode: 409,
        message: 'iee_runs idempotency conflict could not be resolved',
        errorCode: 'IEE_IDEMPOTENCY_RACE',
      };
    }

    return {
      ieeRunId: existing.id,
      deduplicated: true,
      status: existing.status,
    };
  }

  const ieeRunId = inserted[0].id;

  // ── 5. Soft budget reservation (rev 6 §13.2) ──────────────────────────────
  // Reuse the existing budget_reservations table — entityType='iee_run',
  // entityId = the iee_runs.id we just minted. The TTL is 15 minutes
  // (§13.6.1.a) — comfortably above the pg-boss expireInSeconds ceiling.
  // computeBudgetService is the canonical place for the actual budget check; here
  // we only record the reservation row so the existing aggregator can see it.
  const estimatedCostCents = estimateIeeCostCents(task);
  const reservationKey = `iee:${ieeRunId}`;
  const ttlMinutes = Number(process.env.IEE_RESERVATION_TTL_MINUTES ?? '15');

  await db
    .insert(computeReservations)
    .values({
      idempotencyKey: reservationKey,
      entityType:     'iee_run',
      entityId:       ieeRunId,
      estimatedCostCents,
      status:         'active',
      expiresAt:      new Date(Date.now() + ttlMinutes * 60 * 1000),
    })
    .onConflictDoNothing();

  // ── 6. Enqueue pg-boss job ────────────────────────────────────────────────
  const jobName = task.type === 'browser' ? 'iee-browser-task' : 'iee-dev-task';
  const payload = IEEJobPayload.parse({
    organisationId:  input.organisationId,
    subaccountId:    input.subaccountId,
    agentId:         input.agentId,
    runId:           input.agentRunId,
    executionRunId:  ieeRunId,
    correlationId:   input.correlationId,
    idempotencyKey,
    task,
  });

  const boss = await getPgBoss();
  const config = getJobConfig(jobName);
  await boss.send(jobName, payload, config);

  // ── 7. Trace event ────────────────────────────────────────────────────────
  createEvent('iee.execution.start', {
    ieeRunId,
    type: task.type,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    agentRunId: input.agentRunId,
    correlationId: input.correlationId,
    estimatedCostCents,
  });

  return {
    ieeRunId,
    deduplicated: false,
    status: 'pending',
  };
}
