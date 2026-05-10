/**
 * _ieeShared — internal helper consumed by `ieeBrowserBackend.ts` and
 * `ieeDevBackend.ts`.
 *
 * The two IEE adapters share storage (`iee_runs`), share an event queue
 * (`iee-run-completed`), and share most of their lifecycle plumbing —
 * dispatch, terminal-state load, finalisation, reconcile, cancel. The only
 * per-adapter delta is the discriminator (`'browser'` vs `'dev'`) used to:
 *   - validate the inbound `ieeTask.type` at `dispatch()` entry,
 *   - scope `reconcile()` so each adapter processes a disjoint slice of
 *     `iee_runs` rows (no double-processing — spec § 9.2 / § 4.5).
 *
 * The plan (Chunk 3 module shape) sets a 30-line threshold for inlining
 * vs extracting; the duplicated body (dispatch + finalise + reconcile) is
 * well above that threshold so the helper is justified.
 *
 * Cycle prevention — same rule as `executionBackends/types.ts`: this file
 * MUST NOT import from `agentExecutionService.ts`. It imports pure helpers
 * from `agentRunFinalizationServicePure.ts` and `updateMeaningfulRunTracking`
 * from `agentRunFinalizationService.ts`. No cycle exists: the orchestrator
 * (`agentRunFinalizationService.ts`) imports the registry which imports only
 * `types.ts` — there is no path back to `_ieeShared.ts`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.5,
 *       § 9.2, § 13.1.1.
 */

import { z } from 'zod';
import { eq, sql, and, isNull, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentRuns } from '../../db/schema/agentRuns.js';
import { ieeRuns } from '../../db/schema/ieeRuns.js';
import { llmRequests } from '../../db/schema/llmRequests.js';
import { emitAgentRunUpdate, emitOrgUpdate, emitSubaccountUpdate } from '../../websocket/emitters.js';
import { logger } from '../../lib/logger.js';
import { assertValidTransition } from '../../../shared/stateMachineGuards.js';
import { TERMINAL_RUN_STATUSES } from '../../../shared/runStatus.js';
import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
} from '../agentRunFinalizationServicePure.js';
import { updateMeaningfulRunTracking } from '../agentRunFinalizationService.js';
import { computeRunResultStatus } from '../agentExecutionServicePure.js';

import type { Transaction } from '../../db/index.js';
import type {
  BackendDispatchInput,
  BackendDispatchResult,
  BackendFinalisationInput,
  BackendFinalisationResult,
  BackendTerminalState,
} from './types.js';
import {
  BackendOptionsMismatch,
  ParentRunNotDispatchable,
} from './types.js';

type IeeRunRow = typeof ieeRuns.$inferSelect;
type IeeType = 'browser' | 'dev';

// ---------------------------------------------------------------------------
// Terminal event payload — single source of truth.
//
// Mirrors the shallow shape the worker emits onto `iee-run-completed`. The
// existing handler-side `validatePayload` body in `ieeRunCompletedHandler.ts`
// derives from this schema so adapter and handler never drift.
//
// ---------------------------------------------------------------------------

export const SUPPORTED_IEE_EVENT_VERSION = 1 as const;

export const ieeRunCompletedPayloadSchema = z.object({
  // Pre-versioning (no `version` field) events are treated as v1 for
  // backwards compatibility with any in-flight pg-boss jobs at deploy
  // time. Future bumps must NOT accept a missing version — make this a
  // required `z.literal(SUPPORTED_IEE_EVENT_VERSION)` once the v0 deploy
  // window has fully drained.
  version: z.number().optional(),
  eventKey: z.string(),
  ieeRunId: z.string().min(1),
  status: z.enum(['completed', 'failed', 'cancelled']),
  failureReason: z.string().nullable().optional(),
  totalCostCents: z.number().optional(),
  stepCount: z.number().optional(),
});

export type IeeRunCompletedPayload = z.infer<typeof ieeRunCompletedPayloadSchema>;

// ---------------------------------------------------------------------------
// Shared identity slots.
// ---------------------------------------------------------------------------

export const IEE_COMPLETED_QUEUE = 'iee-run-completed' as const;
export const IEE_TERMINAL_STATE_TABLE = 'iee_runs' as const;

// ---------------------------------------------------------------------------
// dispatch() — orphan-cleanup-aware delegated dispatch (§ 13.1.1).
// ---------------------------------------------------------------------------

interface IeeDispatchArgs {
  type: IeeType;
  /** The adapter's own id, used for the typed mismatch error and parent-row backendId write. */
  adapterId: 'iee_browser' | 'iee_dev';
  input: BackendDispatchInput;
}

/**
 * Shared dispatch body. Lifts the IEE branch of
 * `agentExecutionService.ts:1413–1473` into the adapter contract.
 *
 * Sequence (per § 13.1.1):
 *   1. enqueueIEETask — backend task created/dedup-resolved against
 *      `iee_runs.idempotency_key` UNIQUE.
 *   2. Parent UPDATE — gated on `status IN ('pending', 'running')`.
 *   3. On 0-rows Step 2: write `iee_runs.status = 'cancelled',
 *      failure_reason = 'parent_orphaned'` and throw
 *      `ParentRunNotDispatchable`.
 */
export async function ieeDispatch(args: IeeDispatchArgs): Promise<BackendDispatchResult> {
  const { type, adapterId, input } = args;
  const opts = input.backendOptions;

  // Mismatch check — every adapter's dispatch() first statement. Pinning
  // the discriminator narrows `opts` to the IEE variant of the union so
  // `opts.ieeTask` is reachable below without a cast.
  if (opts.backendId !== adapterId) {
    throw new BackendOptionsMismatch(adapterId, opts.backendId);
  }

  // Required-task guard. The dispatch-site no longer pre-validates this
  // (Chunk 5 acceptance criterion § 16 #1 requires zero `if (effectiveMode
  // === 'iee_*')` blocks in `agentExecutionService.ts`), so the
  // typecheck-narrowed but value-undefined case is handled here.
  const ieeTask = opts.ieeTask;
  if (!ieeTask) {
    throw Object.assign(new Error(`adapter '${adapterId}' requires ieeTask but received undefined`), {
      statusCode: 400,
      errorCode: 'IEE_TASK_REQUIRED',
    });
  }
  if (ieeTask.type !== type) {
    throw Object.assign(new Error(`adapter '${adapterId}' requires ieeTask.type='${type}', got '${ieeTask.type}'`), {
      statusCode: 400,
      errorCode: 'IEE_TASK_TYPE_MISMATCH',
    });
  }

  // Step 1 — backend task enqueue. Late-imported to avoid the
  // `executionBackends` -> `ieeExecutionService` -> ... import cycle.
  const { enqueueIEETask } = await import('../ieeExecutionService.js');
  const enqueueResult = await enqueueIEETask({
    task: ieeTask as Parameters<typeof enqueueIEETask>[0]['task'],
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    agentId: input.agentId,
    agentRunId: input.runId,
    correlationId: input.runId,
  });

  // Step 2 — parent UPDATE. Gated on non-terminal status set so a parent
  // that has raced past the delegation window (cancellation, etc.) does
  // NOT receive a stale `status='delegated'` write. `ieeRunId` dual-write
  // preserves the existing denormalised cache (migration 0176) until
  // Chunk 5 retires it.
  const updated = await db.update(agentRuns)
    .set({
      status: 'delegated',
      backendId: adapterId,
      backendTaskId: enqueueResult.ieeRunId,
      ieeRunId: enqueueResult.ieeRunId,
      summary: `Delegated to IEE ${type} (ieeRunId=${enqueueResult.ieeRunId}${enqueueResult.deduplicated ? ', deduplicated' : ''})`,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(agentRuns.id, input.runId),
      eq(agentRuns.organisationId, input.organisationId),
      inArray(agentRuns.status, ['pending', 'running'] as const),
    ))
    .returning({ id: agentRuns.id });

  if (updated.length === 0) {
    // Step 3 — orphan cleanup. The backend task was created in Step 1 but
    // the parent has already moved past the delegation window. Mark the
    // backend row as orphaned and throw the typed diagnostic so the
    // dispatch-site caller can log + return rather than 5xx.
    await db.update(ieeRuns)
      .set({
        status: 'cancelled',
        failureReason: 'parent_orphaned',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(ieeRuns.id, enqueueResult.ieeRunId),
        eq(ieeRuns.organisationId, input.organisationId),
        inArray(ieeRuns.status, ['pending', 'running'] as const),
      ));

    logger.warn('iee.dispatch.parent_orphaned', {
      adapterId,
      runId: input.runId,
      ieeRunId: enqueueResult.ieeRunId,
    });

    throw new ParentRunNotDispatchable(input.runId, 'already_terminal');
  }

  emitAgentRunUpdate(input.runId, 'agent:run:delegated', {
    ieeRunId: enqueueResult.ieeRunId,
    mode: adapterId,
    deduplicated: enqueueResult.deduplicated,
  });

  return {
    lifecycle: 'delegated',
    backendTaskId: enqueueResult.ieeRunId,
    loopResult: null,
    deduplicated: enqueueResult.deduplicated,
  };
}

// ---------------------------------------------------------------------------
// loadTerminalState — common across the two IEE adapters.
// ---------------------------------------------------------------------------

export async function ieeLoadTerminalState(
  tx: Transaction,
  backendTaskId: string,
): Promise<BackendTerminalState | null> {
  const [row] = await tx
    .select()
    .from(ieeRuns)
    .where(eq(ieeRuns.id, backendTaskId))
    .for('update')
    .limit(1);

  if (!row) return null;

  return {
    agentRunId: row.agentRunId ?? '',
    backendTaskId: row.id,
    status: row.status,
    failureReason: row.failureReason ?? null,
    completedAt: row.completedAt ?? null,
    eventEmittedAt: row.eventEmittedAt ?? null,
    resultSummary: row.resultSummary,
    raw: row,
  };
}

// ---------------------------------------------------------------------------
// finalise — lift of the legacy IEE finaliser body that previously
// lived in agentRunFinalizationService.ts, minus row-loading.
// ---------------------------------------------------------------------------

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

async function aggregateTokensForIeeRun(tx: Transaction, ieeRunId: string): Promise<TokenTotals> {
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

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export async function ieeFinalise(
  finalisationInput: BackendFinalisationInput,
): Promise<BackendFinalisationResult> {
  const { tx, terminalState, parentRun } = finalisationInput;
  const ieeRun = terminalState.raw as IeeRunRow;

  // Defensive guard. The pure mapping table only handles terminal IEE
  // statuses; a non-terminal `loadTerminalState` row should never reach
  // here because the worker emits the event after the terminal write,
  // but keeping the guard makes the function self-contained.
  if (ieeRun.status !== 'completed' && ieeRun.status !== 'failed' && ieeRun.status !== 'cancelled') {
    logger.warn('agentRunFinalization.non_terminal_iee_run', {
      ieeRunId: ieeRun.id,
      ieeStatus: ieeRun.status,
    });
    return { finalised: false, parentTerminalStatus: parentRun?.status ?? '' };
  }

  // No parent run available — either standalone backend task
  // (`!ieeRun.agentRunId`) or parent row was deleted between dispatch and
  // finalisation (`parentRun === null`). In both cases the orchestrator
  // has nothing to transition; we still stamp `eventEmittedAt` so the
  // worker's retry sweep stops re-firing the terminal event.
  if (!ieeRun.agentRunId || parentRun === null) {
    if (!ieeRun.eventEmittedAt) {
      await tx
        .update(ieeRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(ieeRuns.id, ieeRun.id),
          eq(ieeRuns.organisationId, ieeRun.organisationId),
        ));
    }
    return { finalised: false, parentTerminalStatus: parentRun?.status ?? '' };
  }

  const parentAlreadyTerminal = TERMINAL_SET.has(parentRun.status);

  // Idempotent race-loser: parent already terminal AND the iee event has
  // already been marked emitted. Both writes have happened — exit without
  // another touch.
  if (parentAlreadyTerminal && terminalState.eventEmittedAt) {
    return { finalised: false, parentTerminalStatus: parentRun.status };
  }

  const terminalStatus = mapIeeStatusToAgentRunStatus(ieeRun.status, ieeRun.failureReason);

  // Reconciliation observability — if the parent was already in
  // 'cancelling' but the IEE run resolved to something other than
  // 'cancelled', the run completed before the worker observed the cancel.
  if (parentRun.status === 'cancelling' && terminalStatus !== 'cancelled') {
    logger.warn('agentRunFinalization.cancel_intent_divergence', {
      ieeRunId: ieeRun.id,
      agentRunId: parentRun.id,
      parentStatusAtFinalization: parentRun.status,
      finalStatus: terminalStatus,
    });
  }

  const summary = buildSummaryFromIeeRun(ieeRun);
  const parentSubaccountId = (parentRun.subaccountId ?? null) as string | null;
  const parentIsSubAgent = (parentRun.isSubAgent ?? false) as boolean;
  const parentAgentId = (parentRun.agentId ?? null) as string | null;
  const parentOrganisationId = (parentRun.organisationId ?? null) as string | null;
  const parentStartedAt = (parentRun.startedAt ?? null) as Date | null;
  const parentCreatedAt = (parentRun.createdAt ?? new Date()) as Date;
  const startedAt = parentStartedAt ?? ieeRun.startedAt ?? parentCreatedAt;
  const completedAt = ieeRun.completedAt ?? new Date();
  const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

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

  let performedTransition = false;

  if (!parentAlreadyTerminal) {
    assertValidTransition({
      kind: 'agent_run',
      recordId: parentRun.id,
      from: parentRun.status,
      to: terminalStatus,
    });

    const tokens = await aggregateTokensForIeeRun(tx, ieeRun.id);

    const ieeDerivedRunResultStatus = computeRunResultStatus(
      terminalStatus,
      /* hasError */ isFailureStatus,
      /* hadUncertainty */ false,
    );

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
        totalToolCalls: tokens.llmCallCount,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.id, parentRun.id),
        eq(agentRuns.organisationId, parentRun.organisationId as string),
        inArray(agentRuns.status, ['pending', 'running', 'delegated', 'cancelling'] as const),
        isNull(agentRuns.completedAt),
        isNull(agentRuns.runResultStatus),
      ))
      .returning({ id: agentRuns.id });
    performedTransition = updated.length > 0;
    if (!performedTransition) {
      logger.warn('runResultStatus.write_skipped', {
        runId: parentRun.id,
        ieeRunId: ieeRun.id,
        attemptedStatus: ieeDerivedRunResultStatus,
        writeSite: 'ieeFinalise',
      });
    }
  }

  if (!ieeRun.eventEmittedAt) {
    await tx
      .update(ieeRuns)
      .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(ieeRuns.id, ieeRun.id),
        eq(ieeRuns.organisationId, ieeRun.organisationId),
      ));
  }

  // Build the post-commit emit closure ONLY when the transition fired.
  // The orchestrator awaits it after `db.transaction()` resolves so a
  // tx rollback does not produce ghost websocket events.
  const postCommit = performedTransition
    ? async () => {
        emitAgentRunUpdate(ieeRun.agentRunId!, 'agent:run:completed', {
          ieeRunId: ieeRun.id,
          finalStatus: terminalStatus,
          failureReason: ieeRun.failureReason ?? null,
        });

        if (!parentIsSubAgent && parentOrganisationId) {
          emitOrgUpdate(parentOrganisationId, 'dashboard.activity.updated', {
            source: 'agent_run',
            runId: ieeRun.agentRunId,
            finalStatus: terminalStatus,
          });
        }

        if (parentSubaccountId && !parentIsSubAgent) {
          emitSubaccountUpdate(parentSubaccountId, 'live:agent_completed', {
            runId: ieeRun.agentRunId,
            agentId: parentAgentId,
            ieeRunId: ieeRun.id,
            finalStatus: terminalStatus,
          });
        }

        logger.info('agentRunFinalization.transitioned', {
          ieeRunId: ieeRun.id,
          agentRunId: ieeRun.agentRunId,
          fromStatus: 'delegated',
          toStatus: terminalStatus,
          failureReason: ieeRun.failureReason ?? null,
        });

        if (terminalStatus === 'completed') {
          await updateMeaningfulRunTracking(ieeRun.agentRunId!, terminalStatus).catch((err) => {
            logger.warn('agentRunFinalization.meaningful_hook_failed', {
              agentRunId: ieeRun.agentRunId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    : undefined;

  return {
    finalised: performedTransition,
    parentTerminalStatus: performedTransition ? terminalStatus : parentRun.status,
    postCommit,
  };
}

// ---------------------------------------------------------------------------
// reconcile — scoped by `iee_runs.type` so the two adapters process
// disjoint slices of the shared table (spec § 4.5 / § 9.2).
// ---------------------------------------------------------------------------

export async function ieeReconcile(args: {
  type: IeeType;
  /** The orchestrator entrypoint. Imported lazily to avoid a registry import. */
  finaliseAgentRunFromBackend: (a: { backendId: string; backendTaskId: string }) => Promise<boolean>;
  /** Adapter id passed back into the orchestrator. */
  adapterId: 'iee_browser' | 'iee_dev';
}): Promise<number> {
  const { type, finaliseAgentRunFromBackend, adapterId } = args;

  const stuck = await db
    .select({
      agentRunId: agentRuns.id,
      ieeRunId: ieeRuns.id,
    })
    .from(agentRuns)
    .innerJoin(ieeRuns, eq(ieeRuns.agentRunId, agentRuns.id))
    .where(
      and(
        inArray(agentRuns.status, ['delegated', 'cancelling'] as const),
        sql`${ieeRuns.status} IN ('completed', 'failed', 'cancelled')`,
        isNull(ieeRuns.deletedAt),
        eq(ieeRuns.type, type),
        sql`${agentRuns.updatedAt} < now() - interval '120 seconds'`,
      ),
    )
    .limit(100);

  let transitioned = 0;
  for (const { ieeRunId } of stuck) {
    try {
      const did = await finaliseAgentRunFromBackend({
        backendId: adapterId,
        backendTaskId: ieeRunId,
      });
      if (did) transitioned += 1;
    } catch (err) {
      logger.error('agentRunFinalization.reconciliation_failed', {
        ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (transitioned > 0) {
    logger.warn('agentRunFinalization.reconciled_stuck_delegated', {
      adapterId,
      type,
      count: transitioned,
      candidates: stuck.length,
    });
  }

  return transitioned;
}

// ---------------------------------------------------------------------------
// cancel — thin pass-through to the existing cancelIeeRun.
// ---------------------------------------------------------------------------

export async function ieeCancel(input: {
  runId: string;
  backendTaskId: string | null;
}): Promise<void> {
  if (!input.backendTaskId) return;
  // Late import to avoid the executionBackends -> agentRunCancelService cycle
  // (cancelService imports the IEE schemas which depend on shared types).
  const { agentRunCancelService } = await import('../agentRunCancelService.js');
  await agentRunCancelService.cancelIeeRun(input.backendTaskId);
}
