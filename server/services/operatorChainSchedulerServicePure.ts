// operatorChainSchedulerServicePure.ts — slot-count, queue-eligibility, FIFO-order helpers.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.17 item 5, §7.3
//
// Pure module — no DB, no IO.

// ---------------------------------------------------------------------------
// Slot count predicate
// ---------------------------------------------------------------------------

export interface RunningChainLinkRow {
  subaccountId: string;
  status: string;
  supersededByAttempt: number | null;
}

/**
 * Counts the number of active (running, non-superseded) chain links for a subaccount.
 *
 * Active slot = status='running' AND superseded_by_attempt IS NULL.
 * Per spec §3.17 item 5: concurrent_operator_sessions_cap is enforced from the
 * live subaccount_operator_settings row, not the snapshot.
 */
export function countActiveSlots(chainLinks: RunningChainLinkRow[]): number {
  return chainLinks.filter(
    (link) => link.status === 'running' && link.supersededByAttempt === null,
  ).length;
}

/**
 * Returns true when a new chain link can be dispatched (slot is available).
 *
 * @param activeSlots - Count of currently running non-superseded chain links.
 * @param concurrentSessionsCap - The live subaccount-level concurrency cap.
 */
export function isSlotAvailable(activeSlots: number, concurrentSessionsCap: number): boolean {
  return activeSlots < concurrentSessionsCap;
}

// ---------------------------------------------------------------------------
// Queue-eligibility predicate
// ---------------------------------------------------------------------------

export interface PausedForContinuationTask {
  agentRunId: string;
  status: string;
  updatedAt: Date;
}

/**
 * Returns true when a task is eligible to be enqueued for chain continuation.
 *
 * Eligibility: task must be in 'paused_for_chain_continuation' status.
 */
export function isQueueEligibleForContinuation(task: PausedForContinuationTask): boolean {
  return task.status === 'paused_for_chain_continuation';
}

// ---------------------------------------------------------------------------
// FIFO ordering
// ---------------------------------------------------------------------------

/**
 * Sorts tasks eligible for chain-continuation dispatch in FIFO order.
 *
 * Per spec §3.17 item 5: FIFO order is agent_runs.updated_at ASC.
 * The oldest paused task gets the next freed slot.
 *
 * Returns a new sorted array; does not mutate the input.
 */
export function sortByFifoOrder(
  tasks: PausedForContinuationTask[],
): PausedForContinuationTask[] {
  return [...tasks].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
}

/**
 * Selects the next task to dispatch when a slot is freed.
 *
 * Returns the task with the oldest updated_at among those in
 * 'paused_for_chain_continuation', or null if no eligible tasks exist.
 */
export function selectNextDispatchCandidate(
  tasks: PausedForContinuationTask[],
): PausedForContinuationTask | null {
  const eligible = tasks.filter(isQueueEligibleForContinuation);
  if (eligible.length === 0) {
    return null;
  }
  const sorted = sortByFifoOrder(eligible);
  return sorted[0] ?? null;
}
