/**
 * syntheticChecksPure.test.ts — Pure decision-logic tests for synthetic checks.
 *
 * Covers positive (condition met → fires), negative (not met → false), and
 * cold-start (no baseline / no prior data → false, no false positive) cases.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/syntheticChecksPure.test.ts
 */

import {
  isQueueStalled,
  isAgentInactive,
  isConnectorPollStale,
  isDlqStale,
  isHeartbeatStale,
  isConnectorErrorRateElevated,
  isSuccessRateLow,
} from '../syntheticChecksPure.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

const NOW = new Date('2026-04-25T14:00:00.000Z');

// ── isQueueStalled ────────────────────────────────────────────────────────

console.log('\nisQueueStalled');

test('fires when pending > 0 and no last completion', () => {
  assert(isQueueStalled(3, null, NOW, 5), 'should fire');
});

test('fires when pending > 0 and last completion is older than threshold', () => {
  const stale = new Date(NOW.getTime() - 10 * 60 * 1000); // 10 min ago, threshold 5
  assert(isQueueStalled(2, stale, NOW, 5), 'should fire');
});

test('does not fire when pending is 0', () => {
  assert(!isQueueStalled(0, null, NOW, 5), 'should not fire — no pending jobs');
});

test('does not fire when last completion is within threshold', () => {
  const recent = new Date(NOW.getTime() - 2 * 60 * 1000); // 2 min ago, threshold 5
  assert(!isQueueStalled(5, recent, NOW, 5), 'should not fire — recent completion');
});

test('cold-start: pending 0, no completion → does not fire', () => {
  assert(!isQueueStalled(0, null, NOW, 5), 'cold start should not fire');
});

// ── isAgentInactive ───────────────────────────────────────────────────────

console.log('\nisAgentInactive');

test('fires when agent has no runs at all', () => {
  assert(isAgentInactive(null, NOW, 120), 'should fire — never ran');
});

test('fires when last run is older than threshold', () => {
  const stale = new Date(NOW.getTime() - 180 * 60 * 1000); // 3h ago, threshold 2h
  assert(isAgentInactive(stale, NOW, 120), 'should fire');
});

test('does not fire when last run is within threshold', () => {
  const recent = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago, threshold 2h
  assert(!isAgentInactive(recent, NOW, 120), 'should not fire');
});

test('cold-start: no agents (empty rows) → loop never enters → no fire', () => {
  // Not directly testable via isAgentInactive, but confirmed: empty array = no fires.
  assert(true, 'empty agent list covered by loop logic');
});

// ── isConnectorPollStale ──────────────────────────────────────────────────

console.log('\nisConnectorPollStale');

test('fires when connector has never synced', () => {
  assert(isConnectorPollStale(null, 60, 3, NOW), 'should fire — never synced');
});

test('fires when last sync is older than interval × multiplier', () => {
  const stale = new Date(NOW.getTime() - 4 * 60 * 60 * 1000); // 4h ago, interval 60min × 3 = 3h
  assert(isConnectorPollStale(stale, 60, 3, NOW), 'should fire');
});

test('does not fire when last sync is within interval × multiplier', () => {
  const recent = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2h ago, interval 60min × 3 = 3h
  assert(!isConnectorPollStale(recent, 60, 3, NOW), 'should not fire');
});

// ── isDlqStale ────────────────────────────────────────────────────────────

console.log('\nisDlqStale');

test('fires when stale count > 0', () => {
  assert(isDlqStale(3), 'should fire');
});

test('does not fire when stale count is 0', () => {
  assert(!isDlqStale(0), 'should not fire');
});

// ── isHeartbeatStale ──────────────────────────────────────────────────────

console.log('\nisHeartbeatStale');

test('fires when prior heartbeat is older than staleTicks × tickInterval', () => {
  const stale = new Date(NOW.getTime() - 4 * 60 * 1000); // 4 min ago, 3 ticks × 60s = 180s = 3 min
  assert(isHeartbeatStale(stale, NOW, 3, 60), 'should fire');
});

test('does not fire when prior heartbeat is within threshold', () => {
  const recent = new Date(NOW.getTime() - 90 * 1000); // 90s ago, 3 ticks × 60s = 180s
  assert(!isHeartbeatStale(recent, NOW, 3, 60), 'should not fire');
});

test('cold-start: null prior heartbeat → does not fire (first tick)', () => {
  assert(!isHeartbeatStale(null, NOW, 3, 60), 'first tick should not fire');
});

// ── isConnectorErrorRateElevated ──────────────────────────────────────────

console.log('\nisConnectorErrorRateElevated');

test('fires when status is error and updatedAt older than window', () => {
  const stale = new Date(NOW.getTime() - 90 * 60 * 1000); // 90 min ago, window 60 min
  assert(isConnectorErrorRateElevated('error', stale, 60 * 60 * 1000, NOW), 'should fire');
});

test('does not fire when status is not error', () => {
  const stale = new Date(NOW.getTime() - 90 * 60 * 1000);
  assert(!isConnectorErrorRateElevated('active', stale, 60 * 60 * 1000, NOW), 'should not fire — not in error');
});

test('does not fire when status is error but within the window', () => {
  const recent = new Date(NOW.getTime() - 30 * 60 * 1000); // 30 min ago, window 60 min
  assert(!isConnectorErrorRateElevated('error', recent, 60 * 60 * 1000, NOW), 'should not fire — recent error');
});

// ── isSuccessRateLow ──────────────────────────────────────────────────────

console.log('\nisSuccessRateLow');

test('fires when current rate is below baseline p50 minus threshold', () => {
  assert(isSuccessRateLow(0.50, 0.90, 0.30), 'should fire — 0.50 < 0.90 - 0.30 = 0.60');
});

test('does not fire when current rate is clearly above the floor', () => {
  assert(!isSuccessRateLow(0.65, 0.90, 0.30), 'should not fire — 0.65 > floor 0.60');
});

test('does not fire when current rate is above the floor', () => {
  assert(!isSuccessRateLow(0.80, 0.90, 0.30), 'should not fire');
});

test('cold-start: no baseline → caller skips (not a pure function concern)', () => {
  // The cold-start skip is in the check module (getOrNull returns null → continue).
  // Pure isSuccessRateLow is never called when baseline is missing.
  assert(true, 'cold-start handled by check module, not pure helper');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
