// ---------------------------------------------------------------------------
// Pure soft circuit breaker for fire-and-forget persistence paths.
//
// Reviewer feedback (2026-04-21, llm-inflight follow-up): the
// `persistHistoryEvent` helper writes to `llm_inflight_history` on every
// registry add/remove. Under DB degradation, every in-flight event
// attempts a write, failures log once per event, and CPU + log volume
// balloon. A soft breaker keeps the "fire-and-forget" promise intact
// without the resource drain.
//
// Design posture:
//   - Sliding outcome window (default 50 attempts).
//   - Trip threshold: failure rate >= 50% over at least 10 samples.
//   - Open duration: 5 minutes. After expiry, the next call probes
//     (half-open); a success closes the breaker, a failure extends.
//   - Calling code checks `shouldAttempt()` before the work; records
//     the outcome via `recordOutcome(success)` after.
//   - `markOpenLog()` returns true at most once per open cycle so the
//     log doesn't fire on every suppressed attempt.
//
// Kept pure (no logger / clock injection) so tests can pin the breaker
// state machine with deterministic inputs.
// ---------------------------------------------------------------------------

export interface SoftBreakerConfig {
  /** Sliding window size. */
  windowSize:      number;
  /** Minimum samples before the breaker can trip. */
  minSamples:      number;
  /** Failure ratio [0, 1] at/above which the breaker trips. */
  failThreshold:   number;
  /** How long the breaker stays open once tripped (ms). */
  openDurationMs:  number;
}

export const DEFAULT_SOFT_BREAKER_CONFIG: SoftBreakerConfig = {
  windowSize:     50,
  minSamples:     10,
  failThreshold:  0.5,
  openDurationMs: 5 * 60 * 1000,
};

export interface SoftBreakerState {
  outcomes:        boolean[];      // true = success, false = fail
  openedUntilMs:   number | null;  // ms epoch; null when closed
  lastOpenedLogMs: number;         // last time we logged "opened"; rate-limits the log
}

export function createBreakerState(): SoftBreakerState {
  return { outcomes: [], openedUntilMs: null, lastOpenedLogMs: 0 };
}

/**
 * Pure predicate — should the caller attempt the work right now?
 * Mutates `state.openedUntilMs` from non-null to null when the open
 * duration has elapsed (half-open transition). The subsequent
 * outcome feeds back via `recordOutcome`.
 */
export function shouldAttempt(
  state: SoftBreakerState,
  nowMs: number,
): boolean {
  if (state.openedUntilMs === null) return true;
  if (nowMs >= state.openedUntilMs) {
    // Half-open: allow one probe.
    state.openedUntilMs = null;
    return true;
  }
  return false;
}

/**
 * Record an outcome and possibly trip the breaker. Returns `true` iff
 * this call just transitioned the breaker from closed → open (caller
 * uses this to log exactly once per open cycle).
 */
export function recordOutcome(
  state: SoftBreakerState,
  success: boolean,
  nowMs: number,
  config: SoftBreakerConfig = DEFAULT_SOFT_BREAKER_CONFIG,
): { trippedNow: boolean } {
  state.outcomes.push(success);
  while (state.outcomes.length > config.windowSize) state.outcomes.shift();

  if (state.outcomes.length < config.minSamples) {
    return { trippedNow: false };
  }

  const failures = state.outcomes.reduce((n, s) => (s ? n : n + 1), 0);
  const rate = failures / state.outcomes.length;

  if (rate >= config.failThreshold) {
    const wasClosed = state.openedUntilMs === null;
    state.openedUntilMs = nowMs + config.openDurationMs;
    // Clear the window on trip so the half-open probe gets a fresh
    // decision window — otherwise one probe failure + 49 stale failures
    // keeps the breaker open for another full cycle even if the DB
    // recovered mid-way through.
    state.outcomes = [];
    return { trippedNow: wasClosed };
  }

  return { trippedNow: false };
}

/**
 * Test-only helper — inspect whether the breaker is currently open at
 * `nowMs`. Calling code uses `shouldAttempt` for the real gating; this
 * is only for assertions.
 */
export function isOpen(state: SoftBreakerState, nowMs: number): boolean {
  return state.openedUntilMs !== null && nowMs < state.openedUntilMs;
}
