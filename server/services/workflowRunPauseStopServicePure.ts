/**
 * workflowRunPauseStopServicePure — pure state-transition logic for run pause/stop.
 *
 * No DB, no I/O. All decisions are deterministic given the input shape.
 * Spec: tasks/Workflows-spec.md §7 (pause card, operator-initiated Pause/Stop,
 * between-step semantics). Decision 12 (cost_accumulator_cents control-flow source).
 */

export type OperatorAction = 'pause' | 'resume' | 'stop' | null;
export type PauseReason = 'cost_ceiling' | 'wall_clock' | 'by_user';

export interface RunStateInput {
  currentStatus: string;
  currentCostCents: number;
  currentElapsedSeconds: number;
  effectiveCostCeilingCents: number | null;
  effectiveWallClockCapSeconds: number | null;
  operatorAction?: OperatorAction;
}

export interface RunStateDecision {
  nextStatus: string;
  reason: PauseReason | 'operator_stop' | 'operator_resume' | null;
  shouldPause: boolean;
  shouldStop: boolean;
}

/**
 * Decide next run state given current metrics and any operator action.
 *
 * Priority order (highest to lowest):
 *   1. operator stop  → failed
 *   2. operator pause → paused (by_user)
 *   3. operator resume → running
 *   4. cost ceiling breached → paused (cost_ceiling)
 *   5. wall-clock cap breached → paused (wall_clock)
 *   6. no change
 */
export function decideRunNextState(input: RunStateInput): RunStateDecision {
  const {
    currentStatus,
    currentCostCents,
    currentElapsedSeconds,
    effectiveCostCeilingCents,
    effectiveWallClockCapSeconds,
    operatorAction,
  } = input;

  if (operatorAction === 'stop') {
    return {
      nextStatus: 'failed',
      reason: 'operator_stop',
      shouldPause: false,
      shouldStop: true,
    };
  }

  if (operatorAction === 'pause') {
    return {
      nextStatus: 'paused',
      reason: 'by_user',
      shouldPause: true,
      shouldStop: false,
    };
  }

  if (operatorAction === 'resume') {
    return {
      nextStatus: 'running',
      reason: 'operator_resume',
      shouldPause: false,
      shouldStop: false,
    };
  }

  if (
    effectiveCostCeilingCents !== null &&
    currentCostCents >= effectiveCostCeilingCents
  ) {
    return {
      nextStatus: 'paused',
      reason: 'cost_ceiling',
      shouldPause: true,
      shouldStop: false,
    };
  }

  if (
    effectiveWallClockCapSeconds !== null &&
    currentElapsedSeconds >= effectiveWallClockCapSeconds
  ) {
    return {
      nextStatus: 'paused',
      reason: 'wall_clock',
      shouldPause: true,
      shouldStop: false,
    };
  }

  return {
    nextStatus: currentStatus,
    reason: null,
    shouldPause: false,
    shouldStop: false,
  };
}
