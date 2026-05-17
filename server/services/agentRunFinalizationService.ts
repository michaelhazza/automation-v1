/**
 * agentRunFinalizationService — transitions a parent agent_runs row from the
 * non-terminal 'delegated' state to a terminal state, based on the outcome
 * reported by a delegated execution backend.
 *
 * After Chunk 3 (Execution Backend Adapter Contract) the public entry point
 * is `finaliseAgentRunFromBackend({ backendId, backendTaskId })` — a thin
 * orchestrator that resolves an adapter from `executionBackendRegistry`,
 * opens the canonical `db.transaction(...)`, loads the terminal state and
 * parent run under `FOR UPDATE`, and dispatches to the adapter's
 * `finalise(input)`. The adapter owns the per-backend mapping + writes;
 * this file owns ordering, locking, and post-commit emit dispatch.
 *
 * Callers (post Chunk 5 of the refactor):
 *   1. server/jobs/ieeRunCompletedHandler.ts — pg-boss event handler.
 *   2. server/jobs/ieeMainAppReconciliationJob.ts — periodic orphan sweep.
 *
 * Idempotency: multiple invocations for the same backend task are safe.
 * The orchestrator acquires `FOR UPDATE` locks on both the parent
 * `agent_runs` row and the canonical terminal-state row; the adapter's
 * `finalise()` short-circuits when the parent is already terminal AND
 * `terminalState.eventEmittedAt !== null`.
 *
 * See docs/iee-delegation-lifecycle-spec.md §3–5 for the IEE-specific
 * design and tasks/builds/execution-backend-adapter-contract/spec.md
 * § 9 for the orchestrator contract.
 */

import { eq, sql, and, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns } from '../db/schema/agentRuns.js';
import { actions } from '../db/schema/actions.js';
import { memoryBlocks } from '../db/schema/memoryBlocks.js';
import { subaccountAgents } from '../db/schema/subaccountAgents.js';
import { logger } from '../lib/logger.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import {
  mapIeeStatusToAgentRunStatus,
  buildSummaryFromIeeRun,
  computeMeaningfulOutputPure,
} from './agentRunFinalizationServicePure.js';
import { executionBackendRegistry } from './executionBackends/registry.js';
import {
  FinaliseRequiresDelegatedAdapter,
  type ExecutionBackendId,
} from './executionBackends/types.js';

// Re-export the pure helpers so existing importers don't need to update
// their import paths.
export { mapIeeStatusToAgentRunStatus, buildSummaryFromIeeRun, computeMeaningfulOutputPure };

/**
 * F22 — count actions proposed and memory blocks written for an agent run,
 * then update subaccount_agents meaningful-run tracking columns if the run
 * produced meaningful output. Best-effort: errors are caught by the caller.
 *
 * Exported so the non-IEE finalization path in `agentExecutionService.ts`
 * can call it directly. The IEE path now lives inside the IEE adapter
 * (`executionBackends/_ieeShared.ts::ieeFinalise` post-commit hook); the
 * non-IEE path is the only remaining direct caller.
 */
export async function updateMeaningfulRunTracking(
  agentRunId: string,
  status: string,
): Promise<void> {
  const finalizeDb = getOrgScopedDb('agentRunFinalizationService.updateMeaningfulRunTracking');
  // Count actions proposed for this run (agentRunId is the FK from actions).
  const [actionsRow] = await finalizeDb
    .select({ c: count() })
    .from(actions)
    .where(eq(actions.agentRunId, agentRunId));
  const actionProposedCount = Number(actionsRow?.c ?? 0);

  // Count memory blocks written during this run (sourceRunId is the closest
  // FK — it tracks the workflow/agent run that last wrote the block).
  const [memoryRow] = await finalizeDb
    .select({ c: count() })
    .from(memoryBlocks)
    .where(and(eq(memoryBlocks.sourceRunId, agentRunId), isNull(memoryBlocks.deletedAt)));
  const memoryBlockWrittenCount = Number(memoryRow?.c ?? 0);

  const isMeaningful = computeMeaningfulOutputPure({
    status,
    actionProposedCount,
    memoryBlockWrittenCount,
  });

  // Look up the subaccount_agent row for this run so we can update its tracking.
  const [run] = await finalizeDb
    .select({ subaccountAgentId: agentRuns.subaccountAgentId })
    .from(agentRuns)
    .where(eq(agentRuns.id, agentRunId))
    .limit(1);

  const subaccountAgentId = run?.subaccountAgentId;
  if (!subaccountAgentId) return;

  if (isMeaningful) {
    // Reset the streak.
    await finalizeDb
      .update(subaccountAgents)
      .set({
        lastMeaningfulTickAt: new Date(),
        ticksSinceLastMeaningfulRun: 0,
        updatedAt: new Date(),
      })
      .where(eq(subaccountAgents.id, subaccountAgentId));
  } else {
    // Non-meaningful completion advances the streak counter so monitoring
    // built on `ticksSinceLastMeaningfulRun` can detect prolonged
    // empty-completion runs. Without this branch the counter is stuck at 0
    // and no consumer can observe the streak the F22 spec was added for.
    await finalizeDb
      .update(subaccountAgents)
      .set({
        ticksSinceLastMeaningfulRun: sql`${subaccountAgents.ticksSinceLastMeaningfulRun} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(subaccountAgents.id, subaccountAgentId));
  }
}

// ---------------------------------------------------------------------------
// Public entry — finaliseAgentRunFromBackend (Chunk 3 orchestrator).
// ---------------------------------------------------------------------------

/**
 * Generic finalisation entry point — resolves the per-backend adapter from
 * `executionBackendRegistry`, opens the canonical transaction, loads the
 * canonical terminal-state row + parent run under `FOR UPDATE`, and
 * dispatches to the adapter's `finalise()`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 9.1
 *       (orchestration), § 4.1 (BackendFinalisationInput), § 13.1 / § 13.3
 *       (concurrency + idempotency posture).
 *
 * Returns `true` when this call performed the parent terminal transition.
 * `false` when the call was a no-op (race-loser, missing parent, missing
 * terminal-state row, or non-terminal canonical row that the adapter
 * declined to act on).
 *
 * Errors:
 *   - `BackendNotRegistered` if the registry has no adapter for `backendId`.
 *   - `FinaliseRequiresDelegatedAdapter` if the resolved adapter is not
 *     delegated (or is missing `loadTerminalState` / `finalise`). The
 *     registry already validates delegated adapters at registration, so
 *     this only trips on caller misuse (stale event payload, wrong
 *     `backendId` in a reconciliation invocation, etc.). Returning `false`
 *     here would make a programmer error look like a recoverable
 *     idempotent skip; throwing surfaces it so the caller is fixed
 *     instead of accumulating silent no-ops in the worker logs.
 *   - Adapter-level throws propagate unchanged (the tx aborts, caller logs).
 */
export async function finaliseAgentRunFromBackend(args: {
  backendId: ExecutionBackendId;
  backendTaskId: string;
  /** Required for operator_managed backend — needed to set dual RLS GUC before loadTerminalState. */
  organisationId?: string;
  /** Required for operator_managed backend — needed to set dual RLS GUC before loadTerminalState. */
  subaccountId?: string;
}): Promise<boolean> {
  const { backendId, backendTaskId, organisationId, subaccountId } = args;

  if (backendId === 'operator_managed') {
    if (!organisationId || !subaccountId) {
      throw new Error(
        'finaliseAgentRunFromBackend: organisationId and subaccountId are required for operator_managed backend',
      );
    }
  }

  const adapter = executionBackendRegistry.resolve(backendId);

  // Capability-gate sanity check. The registry's `register()` already
  // enforces that 'delegated' adapters declare `loadTerminalState` /
  // `finalise`, so this can only trip if a caller hands us a
  // non-delegated id (api/headless/claude-code) — which is a programmer
  // error, not a recoverable reconciliation result. Throw a typed error
  // so the misuse is visible in worker logs and crashes the consumer
  // (pg-boss retry / DLQ machinery handles the rest).
  if (
    !adapter.capabilities.includes('delegated') ||
    typeof adapter.loadTerminalState !== 'function' ||
    typeof adapter.finalise !== 'function'
  ) {
    logger.error('agentRunFinalization.non_delegated_adapter', { backendId });
    throw new FinaliseRequiresDelegatedAdapter(backendId);
  }

  let postCommit: (() => Promise<void>) | undefined;
  let finalised = false;

  // guard-ignore: with-org-tx-or-scoped-db reason="finalization orchestrator — cross-backend transaction; org GUC set inside tx for operator_managed backend"
  await db.transaction(async (tx) => {
    if (backendId === 'operator_managed') {
      await setOrgAndSubaccountGUC(tx, organisationId!, subaccountId!);
    }

    const terminalState = await adapter.loadTerminalState!(tx, backendTaskId);
    if (!terminalState) {
      logger.warn('agentRunFinalization.terminal_state_missing', {
        backendId,
        backendTaskId,
      });
      return;
    }

    if (!terminalState.agentRunId) {
      // Standalone backend task — no parent to finalise. Still let the
      // adapter run so it can stamp `eventEmittedAt` and stop the worker's
      // retry sweep.
      const result = await adapter.finalise!({
        tx,
        terminalState,
        // No parent FK on this row — adapters guard on the `null` parentRun
        // and stamp their own terminal-event column without touching
        // `agent_runs`.
        parentRun: null,
      });
      finalised = result.finalised;
      postCommit = result.postCommit;
      return;
    }

    // Row-level lock on the parent to serialise the event handler vs the
    // reconciliation cron.
    const [parent] = await tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, terminalState.agentRunId))
      .for('update')
      .limit(1);

    if (!parent) {
      logger.warn('agentRunFinalization.parent_missing', {
        backendId,
        backendTaskId,
        agentRunId: terminalState.agentRunId,
      });
      // Parent row is gone — nothing to transition. Still hand control to
      // the adapter so it can stamp its own terminal-event column (e.g.
      // `iee_runs.event_emitted_at`); without that, the worker's retry
      // sweep would re-fire the terminal event indefinitely. The adapter
      // MUST guard on `parentRun === null` and skip the parent UPDATE.
      const result = await adapter.finalise!({
        tx,
        terminalState,
        parentRun: null,
      });
      finalised = result.finalised;
      postCommit = result.postCommit;
      return;
    }

    const result = await adapter.finalise!({
      tx,
      terminalState,
      parentRun: parent as unknown as { id: string; status: string; [key: string]: unknown },
    });
    finalised = result.finalised;
    postCommit = result.postCommit;
  });

  // Run post-commit emissions OUTSIDE the transaction so a tx rollback
  // never produces ghost websocket events. Fires whenever the adapter
  // returns a non-undefined callback (typically the finalised: true path).
  if (postCommit) {
    await postCommit();
  }

  return finalised;
}

/**
 * Walk every registered delegated adapter and run its `reconcile()` once.
 * Returns the aggregate count plus per-adapter breakdown.
 *
 * Spec § 9.2.
 */
export async function reconcileBackends(): Promise<{
  total: number;
  perBackend: Partial<Record<ExecutionBackendId, number>>;
}> {
  const perBackend: Partial<Record<ExecutionBackendId, number>> = {};
  let total = 0;
  for (const adapter of executionBackendRegistry.forDelegated()) {
    if (typeof adapter.reconcile !== 'function') continue;
    try {
      const transitioned = await adapter.reconcile();
      perBackend[adapter.id] = transitioned;
      total += transitioned;
    } catch (err) {
      logger.error('reconcileBackends.adapter_failed', {
        backendId: adapter.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { total, perBackend };
}

// ---------------------------------------------------------------------------
// Legacy aliases were removed in Chunk 5 of the ExecutionBackend Adapter
// Contract refactor. Callers migrated to
// `finaliseAgentRunFromBackend({ backendId, backendTaskId })` and
// `reconcileBackends()` in Chunks 3 and 5 respectively.
// ---------------------------------------------------------------------------
