/**
 * trustCalibrationServicePure.test.ts — threshold ladder logic
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/trustCalibrationServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  applyTrustEvent,
  initialTrustState,
  TRUST_AUTO_THRESHOLD_DEFAULT,
  TRUST_AUTO_THRESHOLD_FLOOR,
  TRUST_THRESHOLD_STEP,
  TRUST_VALIDATION_COUNT,
  TRUST_WINDOW_DAYS,
  type TrustState,
} from '../trustCalibrationServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function approxEqual(a: number, b: number, label: string, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`${label} — expected ${b}, got ${a}`);
}

console.log('');
console.log('trustCalibrationServicePure — threshold ladder (§5.3 S7)');
console.log('');

// ---------------------------------------------------------------------------
// initialTrustState
// ---------------------------------------------------------------------------

console.log('initialTrustState:');

test('fresh state at defaults', () => {
  const s = initialTrustState(new Date('2026-04-16T00:00:00Z'));
  expect(s.consecutiveValidated, 'counter').toBe(0);
  expect(s.autoThreshold, 'default threshold').toEqual(TRUST_AUTO_THRESHOLD_DEFAULT);
});

// ---------------------------------------------------------------------------
// Validation ladder
// ---------------------------------------------------------------------------

const now = new Date('2026-04-16T12:00:00Z');

console.log('validation ladder:');

test('single validated event does not cross threshold', () => {
  const s0 = initialTrustState(now);
  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'validated_no_override',
    currentState: s0,
    now,
  });
  expect(nextState.consecutiveValidated, 'counter +1').toBe(1);
  expect(thresholdChanged, 'no change').toBe(false);
  expect(nextState.autoThreshold, 'threshold unchanged').toEqual(TRUST_AUTO_THRESHOLD_DEFAULT);
});

test(`${TRUST_VALIDATION_COUNT} validated events lower threshold by ${TRUST_THRESHOLD_STEP}`, () => {
  let state: TrustState = initialTrustState(now);
  let changed = false;
  for (let i = 0; i < TRUST_VALIDATION_COUNT; i++) {
    const d = applyTrustEvent({ event: 'validated_no_override', currentState: state, now });
    state = d.nextState;
    changed = changed || d.thresholdChanged;
  }
  expect(changed, 'threshold changed at least once').toBe(true);
  approxEqual(state.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT - TRUST_THRESHOLD_STEP, 'lowered by step');
  // counter resets after lowering
  expect(state.consecutiveValidated, 'counter reset').toBe(0);
});

test('threshold floors at TRUST_AUTO_THRESHOLD_FLOOR', () => {
  let state: TrustState = { ...initialTrustState(now), autoThreshold: TRUST_AUTO_THRESHOLD_FLOOR };
  for (let i = 0; i < TRUST_VALIDATION_COUNT * 3; i++) {
    const d = applyTrustEvent({ event: 'validated_no_override', currentState: state, now });
    state = d.nextState;
  }
  approxEqual(state.autoThreshold, TRUST_AUTO_THRESHOLD_FLOOR, 'floor holds');
});

test('ladder: 3x floor drops → 0.85 → 0.80 → 0.75 → 0.70', () => {
  let state: TrustState = initialTrustState(now);
  let drops = 0;
  for (let i = 0; i < TRUST_VALIDATION_COUNT * 4; i++) {
    const d = applyTrustEvent({ event: 'validated_no_override', currentState: state, now });
    if (d.thresholdChanged) drops += 1;
    state = d.nextState;
  }
  expect(drops, 'three threshold drops before floor').toBe(3);
  approxEqual(state.autoThreshold, TRUST_AUTO_THRESHOLD_FLOOR, 'lands on floor');
});

// ---------------------------------------------------------------------------
// Override behaviour
// ---------------------------------------------------------------------------

console.log('override:');

test('override resets counter and restores default', () => {
  // Lower threshold first
  let state: TrustState = initialTrustState(now);
  for (let i = 0; i < TRUST_VALIDATION_COUNT; i++) {
    state = applyTrustEvent({ event: 'validated_no_override', currentState: state, now }).nextState;
  }
  // Simulate partial progress before override
  state = applyTrustEvent({ event: 'validated_no_override', currentState: state, now }).nextState;
  state = applyTrustEvent({ event: 'validated_no_override', currentState: state, now }).nextState;

  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'override',
    currentState: state,
    now,
  });
  expect(nextState.consecutiveValidated, 'counter reset').toBe(0);
  expect(nextState.autoThreshold, 'threshold restored').toEqual(TRUST_AUTO_THRESHOLD_DEFAULT);
  expect(thresholdChanged, 'threshold was at 0.80, now 0.85').toBe(true);
});

test('override with threshold already at default → no change', () => {
  const state = initialTrustState(now);
  const { thresholdChanged } = applyTrustEvent({ event: 'override', currentState: state, now });
  expect(thresholdChanged, 'already at default').toBe(false);
});

// ---------------------------------------------------------------------------
// 30-day window
// ---------------------------------------------------------------------------

console.log('30-day window:');

test('validated event after window expiry resets counter', () => {
  const oldNow = new Date('2026-01-01T00:00:00Z');
  const laterNow = new Date(oldNow.getTime() + (TRUST_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000);
  const state: TrustState = {
    consecutiveValidated: TRUST_VALIDATION_COUNT - 1,
    autoThreshold: TRUST_AUTO_THRESHOLD_DEFAULT,
    windowStartAt: oldNow,
  };
  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'validated_no_override',
    currentState: state,
    now: laterNow,
  });
  // Window expired: counter reset to 0 then +1 from the validated event
  expect(nextState.consecutiveValidated, 'counter reset + incremented').toBe(1);
  expect(thresholdChanged, 'no threshold change').toBe(false);
});

test('auto_applied event within window does not affect threshold', () => {
  const state = initialTrustState(now);
  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'auto_applied',
    currentState: state,
    now,
  });
  expect(nextState.consecutiveValidated, 'unchanged').toBe(0);
  expect(thresholdChanged, 'no change').toBe(false);
});

// ---------------------------------------------------------------------------
// Combined scenarios
// ---------------------------------------------------------------------------

console.log('combined scenarios:');

test('4 validated → 1 override → counter=0, threshold=default', () => {
  let state: TrustState = initialTrustState(now);
  for (let i = 0; i < 4; i++) {
    state = applyTrustEvent({ event: 'validated_no_override', currentState: state, now }).nextState;
  }
  expect(state.consecutiveValidated, 'counter at 4').toBe(4);

  const { nextState } = applyTrustEvent({ event: 'override', currentState: state, now });
  expect(nextState.consecutiveValidated, 'reset by override').toBe(0);
  expect(nextState.autoThreshold, 'default restored').toEqual(TRUST_AUTO_THRESHOLD_DEFAULT);
});

test('exactly TRUST_AUTO_THRESHOLD_FLOOR stays at floor', () => {
  const state: TrustState = {
    consecutiveValidated: TRUST_VALIDATION_COUNT - 1,
    autoThreshold: TRUST_AUTO_THRESHOLD_FLOOR,
    windowStartAt: now,
  };
  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'validated_no_override',
    currentState: state,
    now,
  });
  approxEqual(nextState.autoThreshold, TRUST_AUTO_THRESHOLD_FLOOR, 'floor holds');
  expect(thresholdChanged, 'already floored').toBe(false);
});

console.log('');
console.log('');
