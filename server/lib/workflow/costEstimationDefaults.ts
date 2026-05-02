/**
 * costEstimationDefaults.ts — step-level cost heuristics for the pre-step
 * cap check (spec §5.2 step 5 / Decision 12).
 *
 * Estimation is intentionally pessimistic: if the author has not provided a
 * per-step `estimatedCostCents` override, we apply a per-type default. One
 * expensive step can no longer overshoot the cap by an unbounded amount.
 */

export const STEP_COST_ESTIMATE_CENTS: Record<string, number> = {
  agent_call: 50,
  agent: 50,
  prompt: 10,
  action_call: 5,
  action: 5,
  invoke_automation: 25,
};

/**
 * Returns the estimated cost for a single step execution in cents.
 *
 * Priority order:
 *   1. `stepParams.estimatedCostCents` — explicit author override.
 *   2. `STEP_COST_ESTIMATE_CENTS[stepType]` — per-type default.
 *   3. 0 — unknown types are assumed free (conditional, user_input, etc.).
 */
export function estimateStepCostCents(
  stepType: string,
  stepParams?: Record<string, unknown>
): number {
  if (typeof stepParams?.estimatedCostCents === 'number') {
    return stepParams.estimatedCostCents;
  }
  return STEP_COST_ESTIMATE_CENTS[stepType] ?? 0;
}
