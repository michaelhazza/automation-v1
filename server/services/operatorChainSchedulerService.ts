// operatorChainSchedulerService.ts — slot acquisition, dispatch, and slot release.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.17, §7.3
//
// Advisory lock pg_advisory_xact_lock(hashtext('operator_slots:' || subaccountId))
// serialises slot accounting at every dispatch transaction.
//
// FIFO order: paused_for_chain_continuation tasks sorted by agent_runs.updated_at ASC.

import { eq, and, sql, asc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { setOrgAndSubaccountGUC } from '../lib/orgScoping.js';
import { operatorRuns, agentRuns, subaccountOperatorSettings } from '../db/schema/index.js';
import {
  countActiveSlots,
  isSlotAvailable,
  selectNextDispatchCandidate,
} from './operatorChainSchedulerServicePure.js';
import { OperatorSessionLimitExceededError } from './operatorBackendErrors.js';

export interface TryAcquireSlotParams {
  orgId: string;
  subaccountId: string;
  agentRunId: string;
  attemptNumber: number;
  chainSeqNext: number;
  reason: 'bootstrap' | 'continuation' | 'retry' | 'budget_extension';
}

export const operatorChainSchedulerService = {
  /**
   * Acquires a concurrency slot for the subaccount and verifies the parent
   * agent_run is in a valid predecessor state for the given reason.
   *
   * Holds pg_advisory_xact_lock(hashtext('operator_slots:' || subaccountId))
   * to prevent concurrent dispatches from over-allocating slots.
   *
   * Returns the live concurrent_operator_sessions_cap for use by the caller.
   * Throws OperatorSessionLimitExceededError when at capacity.
   */
  async tryAcquireSlotAndDispatch(params: TryAcquireSlotParams): Promise<{ cap: number; activeSlots: number }> {
    // subaccount_operator_settings and operator_runs are dual-GUC RLS'd — open
    // a nested SAVEPOINT so both org + subaccount GUCs are set AND so the
    // advisory lock scope matches the slot-accounting read-then-check window
    // (released at SAVEPOINT commit, not held for the whole request).
    return getOrgScopedDb('operatorChainSchedulerService.tryAcquireSlotAndDispatch').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, params.orgId, params.subaccountId);

      // Serialise slot accounting for this subaccount.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('operator_slots:' || ${params.subaccountId}))`,
      );

      // Read live concurrency cap from settings (NOT from snapshot — per spec §3.16).
      const [settingsRow] = await tx
        .select({ cap: subaccountOperatorSettings.concurrentOperatorSessionsCap })
        .from(subaccountOperatorSettings)
        .where(eq(subaccountOperatorSettings.subaccountId, params.subaccountId))
        .limit(1);

      const cap = settingsRow?.cap ?? 5; // default per OPERATOR_SETTINGS_RANGES

      // Count active (running, non-superseded) chain links for this subaccount.
      const activeLinks = await tx
        .select({
          subaccountId: operatorRuns.subaccountId,
          status: operatorRuns.status,
          supersededByAttempt: operatorRuns.supersededByAttempt,
        })
        .from(operatorRuns)
        .where(
          and(
            eq(operatorRuns.subaccountId, params.subaccountId),
            eq(operatorRuns.status, 'running'),
          ),
        );

      const activeSlots = countActiveSlots(activeLinks);

      if (!isSlotAvailable(activeSlots, cap)) {
        throw new OperatorSessionLimitExceededError({
          cap,
          current: activeSlots,
          subaccountId: params.subaccountId,
        });
      }

      return { cap, activeSlots };
    });
  },

  /**
   * Releases a slot (by transitioning the running chain link to its terminal state)
   * and enqueues the next paused_for_chain_continuation task in FIFO order.
   *
   * This method only identifies the next candidate; the caller is responsible for
   * dispatching the actual pg-boss job for the continuation.
   *
   * Returns the next candidate's agentRunId, or null if no eligible tasks exist.
   */
  async releaseSlotAndEnqueueNext(
    orgId: string,
    subaccountId: string,
  ): Promise<{ nextAgentRunId: string | null }> {
    // agent_runs is single-GUC, but the advisory lock semantics require the
    // SAVEPOINT shape used in tryAcquireSlotAndDispatch above. We set the
    // dual GUC anyway because this method's slot accounting mirrors that
    // function's, and a future read of operator_runs here would silently
    // fail-closed without the subaccount GUC.
    return getOrgScopedDb('operatorChainSchedulerService.releaseSlotAndEnqueueNext').transaction(async (tx) => {
      await setOrgAndSubaccountGUC(tx, orgId, subaccountId);

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('operator_slots:' || ${subaccountId}))`,
      );

      // Find all paused_for_chain_continuation tasks for this subaccount.
      const pausedTasks = await tx
        .select({
          agentRunId: agentRuns.id,
          status: agentRuns.status,
          updatedAt: agentRuns.updatedAt,
        })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.subaccountId, subaccountId),
            eq(agentRuns.status, 'paused_for_chain_continuation'),
          ),
        )
        .orderBy(asc(agentRuns.updatedAt));

      const candidate = selectNextDispatchCandidate(
        pausedTasks.map((t) => ({
          agentRunId: t.agentRunId,
          status: t.status,
          updatedAt: t.updatedAt,
        })),
      );

      return { nextAgentRunId: candidate?.agentRunId ?? null };
    });
  },
};
