// IEE browser cost-alarm evaluators + event name constants (spec §8.7).
//
// Event name constants are defined here so all emitters share a single
// source-of-truth string. No formal incident registry exists — the
// convention is constants-in-this-file + recordIncident() at call sites.

// Event names (spec §8.7) — hidden from UI, appear in incident schema + run logs only.
export const IEE_BROWSER_EVENT_TASK_COST_ANOMALY = 'iee_browser.task_cost_anomaly';
export const IEE_BROWSER_EVENT_SUBACCOUNT_COST_ANOMALY = 'iee_browser.subaccount_cost_anomaly';
export const IEE_BROWSER_EVENT_WARM_POOL_MISS = 'iee_browser.warm_pool_miss';

// Payload types

export interface TaskCostAnomalyPayload {
  subaccountId: string;
  agentRunId: string;
  ieeRunId: string;
  costCents: number;
  ceilingCents: number;
}

export interface SubaccountCostAnomalyPayload {
  subaccountId: string;
  dayUTC: string;
  spendCents: number;
  ceilingCents: number;
}

/**
 * Evaluates whether a single task's cost breaches the per-task ceiling.
 * Threshold is STRICT greater-than: cost === ceiling → fire: false.
 *
 * Idempotency key: `(event_name, agentRunId)` — at most one incident per run.
 */
export function evaluateTaskCost(
  cost: { agentRunId: string; ieeRunId: string; subaccountId: string; costCents: number },
  settings: { perTaskCostCeilingCents: number },
): { fire: false } | { fire: true; payload: TaskCostAnomalyPayload } {
  if (cost.costCents > settings.perTaskCostCeilingCents) {
    return {
      fire: true,
      payload: {
        subaccountId: cost.subaccountId,
        agentRunId: cost.agentRunId,
        ieeRunId: cost.ieeRunId,
        costCents: cost.costCents,
        ceilingCents: settings.perTaskCostCeilingCents,
      },
    };
  }
  return { fire: false };
}

/**
 * Evaluates whether a subaccount's daily spend breaches the daily ceiling.
 * Threshold is STRICT greater-than: spend === ceiling → fire: false.
 *
 * Idempotency key: `(event_name, subaccountId, dayUTC, ceilingCents)`.
 * If the ceiling changes mid-day, a NEW key is produced → new incident may fire.
 */
export function evaluateDailyCost(
  rollup: { subaccountId: string; dayUTC: string; spendCents: number },
  settings: { perSubaccountDailyCostCeilingCents: number },
): { fire: false } | { fire: true; payload: SubaccountCostAnomalyPayload } {
  if (rollup.spendCents > settings.perSubaccountDailyCostCeilingCents) {
    return {
      fire: true,
      payload: {
        subaccountId: rollup.subaccountId,
        dayUTC: rollup.dayUTC,
        spendCents: rollup.spendCents,
        ceilingCents: settings.perSubaccountDailyCostCeilingCents,
      },
    };
  }
  return { fire: false };
}
