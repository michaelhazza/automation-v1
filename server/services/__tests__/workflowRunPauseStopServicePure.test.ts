/**
 * workflowRunPauseStopServicePure.test.ts
 *
 * Pure-logic tests for decideRunNextState and computeRetryBackoffMs.
 * No database required.
 *
 * Run via:
 *   npx tsx server/services/__tests__/workflowRunPauseStopServicePure.test.ts
 */

import {
  decideRunNextState,
  computeRetryBackoffMs,
} from '../workflowRunPauseStopServicePure.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── decideRunNextState ───────────────────────────────────────────────────────

console.log('\ndecideRunNextState:');

// Cost exceeded → paused with cost_ceiling
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 100,
    currentElapsedSeconds: 10,
    effectiveCostCeilingCents: 100,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.nextStatus, 'paused', 'cost_exceeded: nextStatus=paused');
  assertEqual(r.reason, 'cost_ceiling', 'cost_exceeded: reason=cost_ceiling');
  assert(r.shouldPause === true, 'cost_exceeded: shouldPause=true');
  assertEqual(r.capType, 'cost_ceiling', 'cost_exceeded: capType=cost_ceiling');
}

// Wall-clock exceeded → paused with wall_clock
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 10,
    currentElapsedSeconds: 3600,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.nextStatus, 'paused', 'time_exceeded: nextStatus=paused');
  assertEqual(r.reason, 'wall_clock', 'time_exceeded: reason=wall_clock');
  assert(r.shouldPause === true, 'time_exceeded: shouldPause=true');
  assertEqual(r.capType, 'wall_clock', 'time_exceeded: capType=wall_clock');
}

// Both exceeded → cost fires first (cost checked before time)
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 500,
    currentElapsedSeconds: 9999,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.reason, 'cost_ceiling', 'both_exceeded: cost fires first');
  assertEqual(r.capType, 'cost_ceiling', 'both_exceeded: capType=cost_ceiling');
}

// Neither exceeded → stays running
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 10,
    currentElapsedSeconds: 60,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.nextStatus, 'running', 'no_cap: nextStatus=running');
  assert(r.shouldPause === false, 'no_cap: shouldPause=false');
  assert(r.reason === null, 'no_cap: reason=null');
}

// Operator stop → failed
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 10,
    currentElapsedSeconds: 60,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
    operatorAction: 'stop',
  });
  assertEqual(r.nextStatus, 'failed', 'operator_stop: nextStatus=failed');
  assertEqual(r.reason, 'operator_stop', 'operator_stop: reason=operator_stop');
  assert(r.shouldPause === false, 'operator_stop: shouldPause=false');
}

// Operator pause → paused with 'operator'
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 10,
    currentElapsedSeconds: 60,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
    operatorAction: 'pause',
  });
  assertEqual(r.nextStatus, 'paused', 'operator_pause: nextStatus=paused');
  assertEqual(r.reason, 'operator', 'operator_pause: reason=operator');
  assert(r.shouldPause === true, 'operator_pause: shouldPause=true');
}

// Operator stop overrides exceeded caps (stop priority is highest)
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 999,
    currentElapsedSeconds: 99999,
    effectiveCostCeilingCents: 100,
    effectiveWallClockCapSeconds: 3600,
    operatorAction: 'stop',
  });
  assertEqual(r.nextStatus, 'failed', 'stop_overrides_caps: nextStatus=failed');
  assertEqual(r.reason, 'operator_stop', 'stop_overrides_caps: reason=operator_stop');
}

// Exactly at ceiling → pauses (>= check)
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 500,
    currentElapsedSeconds: 0,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.nextStatus, 'paused', 'at_ceiling: nextStatus=paused');
  assertEqual(r.reason, 'cost_ceiling', 'at_ceiling: reason=cost_ceiling');
}

// One below ceiling → does not pause
{
  const r = decideRunNextState({
    currentStatus: 'running',
    currentCostCents: 499,
    currentElapsedSeconds: 0,
    effectiveCostCeilingCents: 500,
    effectiveWallClockCapSeconds: 3600,
  });
  assertEqual(r.nextStatus, 'running', 'below_ceiling: nextStatus=running');
  assert(r.shouldPause === false, 'below_ceiling: shouldPause=false');
}

// ─── computeRetryBackoffMs ────────────────────────────────────────────────────

console.log('\ncomputeRetryBackoffMs:');

assertEqual(computeRetryBackoffMs(1), 1000, 'attempt_1=1000ms');
assertEqual(computeRetryBackoffMs(2), 2000, 'attempt_2=2000ms');
assertEqual(computeRetryBackoffMs(3), 4000, 'attempt_3=4000ms');
assertEqual(computeRetryBackoffMs(4), 8000, 'attempt_4=8000ms');
assertEqual(computeRetryBackoffMs(5), 16000, 'attempt_5=16000ms');
assertEqual(computeRetryBackoffMs(6), 32000, 'attempt_6=32000ms');
assertEqual(computeRetryBackoffMs(7), 60000, 'attempt_7_capped=60000ms');
assertEqual(computeRetryBackoffMs(100), 60000, 'attempt_100_capped=60000ms');

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
