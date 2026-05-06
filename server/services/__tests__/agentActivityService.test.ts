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

import { expect, test } from 'vitest';
import { coerceEventCount } from '../agentActivityServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== agentActivityService — eventCount unit tests ===\n');

test('eventCount is 0 for runs with no events (null aggregate)', () => {
  // When no agent_execution_events rows exist, count(*) returns null via SQL
  expect(coerceEventCount(null), 'null → 0').toBe(0);
});

test('eventCount is 0 for runs with no events (undefined aggregate)', () => {
  expect(coerceEventCount(undefined), 'undefined → 0').toBe(0);
});

test('eventCount is the integer count when events exist', () => {
  expect(coerceEventCount(5), '5 events').toBe(5);
  expect(coerceEventCount(1), '1 event').toBe(1);
  expect(coerceEventCount(100), '100 events').toBe(100);
});

test('eventCount is never negative (zero minimum)', () => {
  // A non-positive raw value (shouldn't happen in practice) is clamped to 0
  const result = coerceEventCount(0);
  expect(result >= 0, 'eventCount >= 0').toBeTruthy();
  expect(result, 'zero raw → 0').toBe(0);
});

test('eventCount is an integer (number type)', () => {
  const result = coerceEventCount(7);
  expect(typeof result === 'number', 'result is number type').toBeTruthy();
  expect(result, 'value preserved').toBe(7);
});

// ── Summary ───────────────────────────────────────────────────────────────────
