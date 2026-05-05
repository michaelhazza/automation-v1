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
