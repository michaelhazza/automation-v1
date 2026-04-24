/**
 * agentActivityService — pure unit tests — runnable via:
 *   npx tsx server/services/__tests__/agentActivityService.test.ts
 *
 * Tests the PURE helpers extracted from agentActivityService:
 *   - coerceEventCount: ensures the eventCount field returned by getRunDetail
 *     is always a non-negative integer (never null / undefined).
 *
 * Database I/O is not exercised here. The pure helper reflects the exact
 * transformation applied to the count(*) aggregate before it is added to
 * the getRunDetail response.
 */

import { coerceEventCount } from '../agentActivityServicePure.js';

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

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== agentActivityService — eventCount unit tests ===\n');

test('eventCount is 0 for runs with no events (null aggregate)', () => {
  // When no agent_execution_events rows exist, count(*) returns null via SQL
  assertEqual(coerceEventCount(null), 0, 'null → 0');
});

test('eventCount is 0 for runs with no events (undefined aggregate)', () => {
  assertEqual(coerceEventCount(undefined), 0, 'undefined → 0');
});

test('eventCount is the integer count when events exist', () => {
  assertEqual(coerceEventCount(5), 5, '5 events');
  assertEqual(coerceEventCount(1), 1, '1 event');
  assertEqual(coerceEventCount(100), 100, '100 events');
});

test('eventCount is never negative (zero minimum)', () => {
  // A non-positive raw value (shouldn't happen in practice) is clamped to 0
  const result = coerceEventCount(0);
  assert(result >= 0, 'eventCount >= 0');
  assertEqual(result, 0, 'zero raw → 0');
});

test('eventCount is an integer (number type)', () => {
  const result = coerceEventCount(7);
  assert(typeof result === 'number', 'result is number type');
  assertEqual(result, 7, 'value preserved');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
