import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  createBreakerState,
  DEFAULT_SOFT_BREAKER_CONFIG,
  isOpen,
  recordOutcome,
  shouldAttempt,
  type SoftBreakerConfig,
} from '../softBreakerPure.js';

// ---------------------------------------------------------------------------
// Pins the soft circuit breaker state machine used by
// `llmInflightRegistry.persistHistoryEvent` and, potentially, any other
// fire-and-forget persistence path that wants to avoid log/CPU storms
// under DB degradation. See reviewer follow-up (2026-04-21).
// ---------------------------------------------------------------------------

const cfg: SoftBreakerConfig = {
  windowSize:     10,
  minSamples:     5,
  failThreshold:  0.5,
  openDurationMs: 60_000,
};

test('closed breaker allows every attempt', () => {
  const state = createBreakerState();
  for (let i = 0; i < 100; i++) {
    assert.equal(shouldAttempt(state, 1_000 + i), true, `attempt ${i} must pass`);
  }
});

test('below minSamples — never trips even at 100% failures', () => {
  const state = createBreakerState();
  for (let i = 0; i < cfg.minSamples - 1; i++) {
    const { trippedNow } = recordOutcome(state, false, 1_000, cfg);
    assert.equal(trippedNow, false);
  }
  assert.equal(isOpen(state, 1_000), false);
  assert.equal(shouldAttempt(state, 1_000), true);
});

test('trips exactly at threshold with enough samples', () => {
  const state = createBreakerState();
  // 5 failures hits minSamples and 100% fail rate.
  let trippedTimes = 0;
  for (let i = 0; i < cfg.minSamples; i++) {
    const { trippedNow } = recordOutcome(state, false, 1_000 + i, cfg);
    if (trippedNow) trippedTimes++;
  }
  assert.equal(trippedTimes, 1, 'exactly one trip notification per open cycle');
  assert.equal(isOpen(state, 1_000 + cfg.minSamples), true);
});

test('shouldAttempt returns false while open, true after openDuration', () => {
  const state = createBreakerState();
  for (let i = 0; i < cfg.minSamples; i++) {
    recordOutcome(state, false, 1_000, cfg);
  }
  // Breaker opens at timestamp 1_000; openedUntilMs = 1_000 + 60_000.
  assert.equal(shouldAttempt(state, 1_500), false, 'within open window — suppressed');
  assert.equal(shouldAttempt(state, 60_999), false, 'just before expiry — suppressed');
  assert.equal(shouldAttempt(state, 61_000), true, 'at expiry — half-open probe allowed');
});

test('successful probe after expiry closes the breaker (next call attempts normally)', () => {
  const state = createBreakerState();
  for (let i = 0; i < cfg.minSamples; i++) {
    recordOutcome(state, false, 1_000, cfg);
  }
  // Half-open probe at 61_000
  assert.equal(shouldAttempt(state, 61_000), true);
  // Probe succeeds — record it
  const { trippedNow } = recordOutcome(state, true, 61_000, cfg);
  assert.equal(trippedNow, false, 'probe success doesn\'t re-trip');
  // Subsequent attempts should flow normally
  assert.equal(shouldAttempt(state, 61_100), true);
});

test('probe failure after expiry re-opens immediately (trippedNow=true)', () => {
  const state = createBreakerState();
  for (let i = 0; i < cfg.minSamples; i++) {
    recordOutcome(state, false, 1_000, cfg);
  }
  assert.equal(shouldAttempt(state, 61_000), true, 'half-open probe allowed');
  // Fill the now-empty window (see recordOutcome clearing on trip) with
  // enough failures to re-trip.
  let trippedTimes = 0;
  for (let i = 0; i < cfg.minSamples; i++) {
    const { trippedNow } = recordOutcome(state, false, 61_000 + i, cfg);
    if (trippedNow) trippedTimes++;
  }
  assert.equal(trippedTimes, 1, 're-trip fires exactly one notification');
  assert.equal(isOpen(state, 61_000 + cfg.minSamples), true);
});

test('sliding window — stale failures outside window are forgotten', () => {
  const state = createBreakerState();
  // Start gently — 2 failures stays below minSamples so no trip check fires.
  for (let i = 0; i < 2; i++) recordOutcome(state, false, 1_000 + i, cfg);
  // Interleave enough successes to keep the rate below threshold while
  // the sample count crosses minSamples. After 3 successes (total 5)
  // the rate is 2/5 = 40% < 50%; no trip.
  for (let i = 0; i < 3; i++) recordOutcome(state, true, 1_100 + i, cfg);
  // Fill remaining window with successes — window is 10 so add 5 more.
  // After these 5, outcomes is [f, f, s, s, s, s, s, s, s, s].
  for (let i = 0; i < 5; i++) recordOutcome(state, true, 1_200 + i, cfg);
  // Push 2 more successes — this shifts both f's out of the window.
  for (let i = 0; i < 2; i++) recordOutcome(state, true, 1_300 + i, cfg);
  // Now outcomes is all s's. Adding one failure → rate 1/10 = 10%, no trip.
  const { trippedNow } = recordOutcome(state, false, 1_400, cfg);
  assert.equal(trippedNow, false, 'stale failures outside window shouldn\'t trip');
  assert.equal(isOpen(state, 1_400), false);
});

test('default config — trips at 10 failures out of 50 sample slider? no, at 25/50', () => {
  // Sanity-check the shipping config: 50% of 50 is 25. Trip fires at
  // failure rate >= 50% over >= minSamples samples.
  const state = createBreakerState();
  // 10 failures (= minSamples), 100% rate, must trip
  for (let i = 0; i < DEFAULT_SOFT_BREAKER_CONFIG.minSamples; i++) {
    recordOutcome(state, false, 1_000 + i);
  }
  assert.equal(isOpen(state, 1_000 + DEFAULT_SOFT_BREAKER_CONFIG.minSamples), true);
});

test('trippedNow fires exactly once per open cycle, not on every subsequent failure', () => {
  const state = createBreakerState();
  // Initial trip
  let trips = 0;
  for (let i = 0; i < cfg.minSamples; i++) {
    const out = recordOutcome(state, false, 1_000 + i, cfg);
    if (out.trippedNow) trips++;
  }
  assert.equal(trips, 1, 'one trip during the ramp-up');
  // Now continue recording failures while open — trippedNow must NOT
  // re-fire (that would spam the "breaker opened" log).
  for (let i = 0; i < 20; i++) {
    const out = recordOutcome(state, false, 1_000 + i, cfg);
    assert.equal(out.trippedNow, false, 'no re-trip while already open');
  }
});
