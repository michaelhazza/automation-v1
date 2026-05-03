/**
 * workflowRunCostLedgerServicePure.ts — pure helpers for cost ledger writes.
 *
 * No DB imports. Functions are deterministic given their inputs.
 * Spec: tasks/Workflows-spec.md §5.7 (cost/wall-clock runaway protection).
 */

export interface AccumulatorDeltaResult {
  /** The new accumulator value after applying the delta. */
  newCents: number;
  /** Whether the delta should trigger a write (accumulator UPDATE + future ledger INSERT). */
  shouldWrite: boolean;
}

/**
 * Compute the updated accumulator value and decide whether a write is needed.
 *
 * Rules:
 *   - deltaCents <= 0 : no-op (zero or negative deltas are guard-railed here so
 *     the impure layer never reaches the DB with a nonsensical write).
 *   - deltaCents > 0  : write the increment.
 */
export function computeAccumulatorDelta(
  currentCents: number,
  deltaCents: number
): AccumulatorDeltaResult {
  if (deltaCents <= 0) {
    return { newCents: currentCents, shouldWrite: false };
  }
  return { newCents: currentCents + deltaCents, shouldWrite: true };
}
