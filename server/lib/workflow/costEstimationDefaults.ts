/**
 * Default cost estimates per step type (cents), used for pre-step cost-cap check.
 * These are estimates only — actual costs are recorded in the ledger after execution.
 */
export const STEP_COST_ESTIMATE_CENTS: Record<string, number> = {
  agent_call: 50,
  agent: 50,
  action_call: 5,
  action: 5,
  prompt: 10,
  invoke_automation: 25,
  ask: 0,
  approval: 0,
  user_input: 0,
  conditional: 0,
  agent_decision: 0,
};

export const DEFAULT_STEP_COST_ESTIMATE_CENTS = 0;

export function getStepCostEstimate(stepType: string): number {
  return STEP_COST_ESTIMATE_CENTS[stepType] ?? DEFAULT_STEP_COST_ESTIMATE_CENTS;
}
