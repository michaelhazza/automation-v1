/**
 * sandboxCeilingMonitorPure.ts — Pure helpers for the sandbox ceiling monitor job.
 *
 * Spec B §10.2: cost-ceiling fallback estimator.
 *
 * No imports — pure functions only, no DB, no network, no side effects.
 * Consumed by sandboxCeilingMonitorJob.ts.
 */

/**
 * Conservative upper-bound estimate of accumulated sandbox cost in cents.
 *
 * Uses the vendor-published worst-case rate from CURRENT_VERSION (parsed by
 * templateVersionParserPure.ts) so the estimate can NEVER silently undercount.
 * When the worker terminates a sandbox at the cost ceiling using this estimate,
 * the actual provider-reported cost at harvest may be lower; any delta is then
 * captured as a cost-correction ledger row (spec §12.4).
 *
 * Formula from spec §10.2:
 *   estimated_cost_cents = elapsedMs / 1000 × maxCostCentsPerSecond
 *
 * @param elapsedMs             Wall-clock time elapsed since sandbox start (milliseconds).
 * @param maxCostCentsPerSecond Vendor worst-case rate from CURRENT_VERSION.max_cost_cents_per_second.
 */
export function estimateSandboxCostCents(
  elapsedMs: number,
  maxCostCentsPerSecond: number,
): number {
  if (elapsedMs < 0) return 0;
  if (maxCostCentsPerSecond < 0) return 0;
  return (elapsedMs / 1000) * maxCostCentsPerSecond;
}

/**
 * Determine whether the wall-clock ceiling has been tripped.
 *
 * @param elapsedMs      Wall-clock time elapsed since sandbox start (milliseconds).
 * @param wallClockMs    Ceiling value from policy.ceilings.wallClockMs.
 */
export function isWallClockCeilingTripped(
  elapsedMs: number,
  wallClockMs: number,
): boolean {
  return elapsedMs >= wallClockMs;
}

/**
 * Determine whether the estimated cost ceiling has been tripped.
 *
 * @param estimatedCostCents  Output of estimateSandboxCostCents.
 * @param costCeilCents       Ceiling value from policy.ceilings.costCents.
 */
export function isCostCeilingTripped(
  estimatedCostCents: number,
  costCeilCents: number,
): boolean {
  return estimatedCostCents >= costCeilCents;
}

/**
 * The shape of a ceiling-tripped transition the caller must execute.
 *
 * `harvesting`    — the row is in `running` AND has a provider_sandbox_id;
 *                   may safely move to `harvesting` with the ceiling-trip
 *                   reason recorded.
 * `start_failed`  — the row is still in `pending` with NULL
 *                   provider_sandbox_id; the sandbox never claimed a
 *                   provider-side handle, so it must terminate directly as
 *                   `provider_unavailable` (no harvest call).
 * `noop`          — the row is in `harvesting` (already in flight) or some
 *                   other non-eligible state; the caller skips the write.
 */
export type CeilingTransition =
  | { kind: 'harvesting'; reason: 'timed_out' | 'cost_ceiling_hit' }
  | { kind: 'start_failed'; terminalStatus: 'provider_unavailable'; errorReason: 'sandbox_provider_unavailable' }
  | { kind: 'noop'; rationale: 'already_harvesting' | 'unexpected_state' };

/**
 * Classify how a ceiling-tripped sandbox execution row should transition.
 *
 * Required because the DB CHECK constraint
 * `sandbox_executions_running_harvesting_needs_provider_id` rejects any row
 * that has status='running' or 'harvesting' with NULL provider_sandbox_id. A
 * pending row (which has NULL provider_sandbox_id by the paired
 * `provider_sandbox_id_not_pending` CHECK) cannot be moved to 'harvesting' —
 * it never started, so the only legal terminal transition is
 * 'provider_unavailable' direct.
 *
 * Pure function: no DB, no time, no side effects. Caller supplies the row's
 * current status + providerSandboxId + which ceiling tripped, gets a
 * machine-readable instruction back.
 */
export function classifyCeilingTransition(
  status: string,
  providerSandboxId: string | null,
  ceilingType: 'timed_out' | 'cost_ceiling_hit',
): CeilingTransition {
  if (status === 'running' && providerSandboxId !== null) {
    return { kind: 'harvesting', reason: ceilingType };
  }
  if (status === 'pending' && providerSandboxId === null) {
    return {
      kind: 'start_failed',
      terminalStatus: 'provider_unavailable',
      errorReason: 'sandbox_provider_unavailable',
    };
  }
  if (status === 'harvesting') {
    return { kind: 'noop', rationale: 'already_harvesting' };
  }
  return { kind: 'noop', rationale: 'unexpected_state' };
}
