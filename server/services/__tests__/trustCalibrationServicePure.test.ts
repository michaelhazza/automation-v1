/**
 * trustCalibrationServicePure.test.ts — threshold ladder logic
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/trustCalibrationServicePure.test.ts
 */

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

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function approxEqual(a: number, b: number, label: string, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`${label} — expected ${b}, got ${a}`);
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false`);
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
  assertEqual(s.consecutiveValidated, 0, 'counter');
  assertEqual(s.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT, 'default threshold');
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
  assertEqual(nextState.consecutiveValidated, 1, 'counter +1');
  assertFalse(thresholdChanged, 'no change');
  assertEqual(nextState.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT, 'threshold unchanged');
});

test(`${TRUST_VALIDATION_COUNT} validated events lower threshold by ${TRUST_THRESHOLD_STEP}`, () => {
  let state: TrustState = initialTrustState(now);
  let changed = false;
  for (let i = 0; i < TRUST_VALIDATION_COUNT; i++) {
    const d = applyTrustEvent({ event: 'validated_no_override', currentState: state, now });
    state = d.nextState;
    changed = changed || d.thresholdChanged;
  }
  assertTrue(changed, 'threshold changed at least once');
  approxEqual(state.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT - TRUST_THRESHOLD_STEP, 'lowered by step');
  // counter resets after lowering
  assertEqual(state.consecutiveValidated, 0, 'counter reset');
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
  assertEqual(drops, 3, 'three threshold drops before floor');
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
  assertEqual(nextState.consecutiveValidated, 0, 'counter reset');
  assertEqual(nextState.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT, 'threshold restored');
  assertTrue(thresholdChanged, 'threshold was at 0.80, now 0.85');
});

test('override with threshold already at default → no change', () => {
  const state = initialTrustState(now);
  const { thresholdChanged } = applyTrustEvent({ event: 'override', currentState: state, now });
  assertFalse(thresholdChanged, 'already at default');
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
  assertEqual(nextState.consecutiveValidated, 1, 'counter reset + incremented');
  assertFalse(thresholdChanged, 'no threshold change');
});

test('auto_applied event within window does not affect threshold', () => {
  const state = initialTrustState(now);
  const { nextState, thresholdChanged } = applyTrustEvent({
    event: 'auto_applied',
    currentState: state,
    now,
  });
  assertEqual(nextState.consecutiveValidated, 0, 'unchanged');
  assertFalse(thresholdChanged, 'no change');
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
  assertEqual(state.consecutiveValidated, 4, 'counter at 4');

  const { nextState } = applyTrustEvent({ event: 'override', currentState: state, now });
  assertEqual(nextState.consecutiveValidated, 0, 'reset by override');
  assertEqual(nextState.autoThreshold, TRUST_AUTO_THRESHOLD_DEFAULT, 'default restored');
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
  assertFalse(thresholdChanged, 'already floored');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
