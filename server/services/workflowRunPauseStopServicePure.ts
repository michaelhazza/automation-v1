/**
 * workflowRunPauseStopServicePure.ts — pure state-transition logic for
 * pause / resume / stop decisions.
 *
 * No DB imports. All functions are deterministic given their inputs.
 * Spec: tasks/Workflows-spec.md §5.7 (cost/wall-clock runaway protection).
 */

export type RunStatus = 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type PauseReason = 'cost_ceiling' | 'wall_clock' | 'operator';
export type OperatorAction = 'pause' | 'stop';

export interface RunStateInputs {
  currentStatus: RunStatus;
  currentCostCents: number;
  currentElapsedSeconds: number;
  effectiveCostCeilingCents: number;
  effectiveWallClockCapSeconds: number;
  operatorAction?: OperatorAction;
}

export interface RunStateDecision {
  nextStatus: RunStatus;
  reason: PauseReason | 'operator_stop' | 'already_terminal' | null;
  shouldPause: boolean;
  capType?: 'cost_ceiling' | 'wall_clock';
}

/**
 * Decide the next status for a workflow run based on current state,
 * cap thresholds, and optional operator action.
 *
 * Priority order:
 *   1. Operator stop → failed
 *   2. Operator pause → paused (reason: 'operator')
 *   3. Cost ceiling breached → paused (reason: 'cost_ceiling')
 *   4. Wall-clock cap breached → paused (reason: 'wall_clock')
 *   5. No caps breached → running
 */
export function decideRunNextState(inputs: RunStateInputs): RunStateDecision {
  if (inputs.operatorAction === 'stop') {
    return {
      nextStatus: 'failed',
      reason: 'operator_stop',
      shouldPause: false,
    };
  }

  if (inputs.operatorAction === 'pause') {
    return {
      nextStatus: 'paused',
      reason: 'operator',
      shouldPause: true,
    };
  }

  // No operator action — check caps.
  const costExceeded = inputs.currentCostCents >= inputs.effectiveCostCeilingCents;
  const timeExceeded = inputs.currentElapsedSeconds >= inputs.effectiveWallClockCapSeconds;

  if (costExceeded) {
    return {
      nextStatus: 'paused',
      reason: 'cost_ceiling',
      shouldPause: true,
      capType: 'cost_ceiling',
    };
  }

  if (timeExceeded) {
    return {
      nextStatus: 'paused',
      reason: 'wall_clock',
      shouldPause: true,
      capType: 'wall_clock',
    };
  }

  return {
    nextStatus: 'running',
    reason: null,
    shouldPause: false,
  };
}

/**
 * Exponential backoff in milliseconds for step retry attempts.
 * Formula: min(1000 * 2^(attempt - 1), 60_000)
 *
 * Attempt 1 →  1000ms
 * Attempt 2 →  2000ms
 * Attempt 3 →  4000ms
 * ...
 * Attempt n → max 60_000ms (1 minute)
 */
export function computeRetryBackoffMs(attemptNumber: number): number {
  return Math.min(1000 * Math.pow(2, attemptNumber - 1), 60_000);
}
