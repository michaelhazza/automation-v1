// ---------------------------------------------------------------------------
// computeBudgetServicePure — pure decision helpers for the Compute Budget
// system. No DB access, no side effects. Extracted from budgetService as
// part of the Compute Budget rename (Chunk 1 — migration 0270).
// ---------------------------------------------------------------------------

export interface ComputeBudgetContext {
  organisationId:     string;
  subaccountId?:      string;
  runId?:             string;
  subaccountAgentId?: string;
  // sourceType lets the service recognise non-billable system work
  // ('system', 'analyzer') and skip reservation entirely.
  sourceType?:        string;
  billingDay:         string;   // 'YYYY-MM-DD'
  billingMonth:       string;   // 'YYYY-MM'
}

export class ComputeBudgetExceededError extends Error {
  readonly code = 'COMPUTE_BUDGET_EXCEEDED' as const;

  constructor(
    public readonly limitType: string,
    public readonly limitCents: number,
    public readonly projectedCents: number,
    public readonly entityId: string,
  ) {
    super(`Compute Budget exceeded: ${limitType} limit ${limitCents}¢ < projected ${projectedCents}¢`);
    this.name = 'ComputeBudgetExceededError';
  }
}

/**
 * Type guard that handles both the typed error class and the plain-object
 * 402 shape thrown by the LLM router on the HTTP boundary.
 */
export function isComputeBudgetExceededError(err: unknown): boolean {
  if (err instanceof ComputeBudgetExceededError) return true;
  const shape = err as { statusCode?: number; code?: string } | null;
  if (!shape || typeof shape !== 'object') return false;
  return shape.statusCode === 402 && shape.code === 'COMPUTE_BUDGET_EXCEEDED';
}

/**
 * Pure cost projection: current committed/reserved spend plus a new delta.
 * Returns the total projected spend in cents.
 */
export function projectCostCents(currentCents: number, deltaCents: number): number {
  return currentCents + deltaCents;
}

/**
 * Compare projected spend against a limit.
 * Returns 'exceeded' when projectedCents > limitCents, 'within' otherwise.
 * A limit of 0 is treated as unset (no cap) — always returns 'within'.
 */
export function compareToLimit(
  projectedCents: number,
  limitCents: number,
): 'within' | 'exceeded' {
  if (limitCents === 0) return 'within';
  return projectedCents > limitCents ? 'exceeded' : 'within';
}

// ── Govern (spec §4.11) ────────────────────────────────────────────────────

/**
 * Project end-of-period spend by extrapolating the last N days at the current run rate.
 * Spec §4.11. Default window 7 days.
 * Integer-cents in, integer-cents out. Convert to USD at the API boundary only.
 * If daysElapsedInWindow <= 0 → returns currentMtdCents (cannot project from zero data).
 * If daysRemaining <= 0      → returns currentMtdCents (period ends today).
 */
export function projectPaceCents(
  currentMtdCents: number,
  spendInWindowCents: number,
  daysElapsedInWindow: number,
  daysRemaining: number,
): number {
  if (daysElapsedInWindow <= 0 || daysRemaining <= 0) return currentMtdCents;
  const dailyRate = spendInWindowCents / daysElapsedInWindow;
  return Math.round(currentMtdCents + dailyRate * daysRemaining);
}

/**
 * Compute the period reset timestamp (UTC).
 * Calendar-month period: first instant of next calendar month.
 */
export function computePeriodResetAt(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
}

/**
 * Days remaining in the current calendar month from now (UTC).
 * Returns 0 on the last day at-or-after reset.
 */
export function daysRemainingInPeriod(now: Date): number {
  const reset = computePeriodResetAt(now);
  const ms = reset.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Classify pace against a cap. Spec §4.11.
 * cap <= 0 treated as unbounded → 'on_track'.
 */
export function classifyPace(
  projectedCents: number,
  capCents: number,
): 'on_track' | 'warning' | 'over' {
  if (capCents <= 0) return 'on_track';
  const pct = (projectedCents / capCents) * 100;
  if (pct > 100) return 'over';
  if (pct > 80) return 'warning';
  return 'on_track';
}
