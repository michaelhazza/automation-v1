/**
 * trustCalibrationServicePure — trust-builds-over-time decision logic (pure)
 *
 * The S7 rule: after N consecutive retrospectively-validated auto-applies
 * without override (in a 30-day window), lower the agent's auto-threshold
 * by 0.05. Floor at 0.70. Overrides reset the counter.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */

export const TRUST_AUTO_THRESHOLD_DEFAULT = 0.85;
export const TRUST_AUTO_THRESHOLD_FLOOR = 0.70;
export const TRUST_THRESHOLD_STEP = 0.05;
export const TRUST_VALIDATION_COUNT = 5; // N consecutive validated auto-applies
export const TRUST_WINDOW_DAYS = 30;

export interface TrustState {
  consecutiveValidated: number;
  autoThreshold: number;
  windowStartAt: Date;
}

export interface TrustEventInput {
  /** The type of event driving the state change. */
  event:
    | 'auto_applied'        // a new auto-apply just occurred
    | 'validated_no_override' // an auto-apply was retrospectively confirmed (no override within window)
    | 'override';            // an auto-apply was overridden → reset counter
  currentState: TrustState;
  now: Date;
}

export interface TrustDecision {
  nextState: TrustState;
  thresholdChanged: boolean;
}

/**
 * Apply a trust event to the current state and return the next state plus a
 * flag indicating whether the auto-threshold changed.
 */
export function applyTrustEvent(input: TrustEventInput): TrustDecision {
  const { event, currentState, now } = input;
  const state = { ...currentState };

  // 30-day window reset — if the window start is older than TRUST_WINDOW_DAYS,
  // the counter is stale regardless of events.
  const windowExpired =
    (now.getTime() - state.windowStartAt.getTime()) / (1000 * 60 * 60 * 24) >
    TRUST_WINDOW_DAYS;
  if (windowExpired) {
    state.consecutiveValidated = 0;
    state.windowStartAt = now;
  }

  if (event === 'override') {
    // Any override resets the counter and restores the default threshold.
    const changed = state.autoThreshold !== TRUST_AUTO_THRESHOLD_DEFAULT;
    return {
      nextState: {
        consecutiveValidated: 0,
        autoThreshold: TRUST_AUTO_THRESHOLD_DEFAULT,
        windowStartAt: now,
      },
      thresholdChanged: changed,
    };
  }

  if (event === 'auto_applied') {
    // An auto-apply occurred; we don't know yet if it will be validated.
    // No state change until the validation window closes.
    return {
      nextState: state,
      thresholdChanged: false,
    };
  }

  // event === 'validated_no_override'
  state.consecutiveValidated += 1;

  let thresholdChanged = false;
  if (state.consecutiveValidated >= TRUST_VALIDATION_COUNT) {
    const proposed = state.autoThreshold - TRUST_THRESHOLD_STEP;
    if (proposed >= TRUST_AUTO_THRESHOLD_FLOOR - 1e-9) {
      const clamped = Math.max(TRUST_AUTO_THRESHOLD_FLOOR, Math.round(proposed * 100) / 100);
      if (clamped < state.autoThreshold) {
        state.autoThreshold = clamped;
        thresholdChanged = true;
      }
      // Reset the consecutive counter so we require another N validations
      // before lowering again.
      state.consecutiveValidated = 0;
      state.windowStartAt = now;
    }
    // else: at floor — no further lowering
  }

  return {
    nextState: state,
    thresholdChanged,
  };
}

/**
 * Initial state for a newly-created trust record.
 */
export function initialTrustState(now: Date): TrustState {
  return {
    consecutiveValidated: 0,
    autoThreshold: TRUST_AUTO_THRESHOLD_DEFAULT,
    windowStartAt: now,
  };
}
