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
