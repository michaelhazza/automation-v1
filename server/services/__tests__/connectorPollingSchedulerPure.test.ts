/**
 * connectorPollingSchedulerPure.test.ts — Canonical Data Platform P1 pure tests.
 *
 * Tests for the selectConnectionsDue pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/connectorPollingSchedulerPure.test.ts
 */

import { selectConnectionsDue, type PollingConnection } from '../connectorPollingSchedulerPure.js';

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

function assertEqual(a: unknown, b: unknown, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
}

function assertTrue(value: boolean, label: string) {
  if (!value) throw new Error(`${label} — expected truthy`);
}

const FIXED_NOW = new Date('2026-04-17T12:00:00.000Z');

function makeConnection(overrides: Partial<PollingConnection> = {}): PollingConnection {
  return {
    id: 'conn-1',
    syncPhase: 'live',
    lastSuccessfulSyncAt: null,
    pollIntervalMinutes: 15,
    deletedAt: null,
    ...overrides,
  };
}

console.log('');
console.log('connectorPollingSchedulerPure — Canonical Data Platform P1');
console.log('');

// ── selectConnectionsDue ─────────────────────────────────────────────────

test('returns empty for no connections', () => {
  assertEqual(selectConnectionsDue([], FIXED_NOW), [], 'empty array');
});

test('returns connection with null lastSuccessfulSyncAt', () => {
  const connections = [makeConnection({ id: 'c-1', lastSuccessfulSyncAt: null })];
  assertEqual(selectConnectionsDue(connections, FIXED_NOW), ['c-1'], 'null sync returns id');
});

test('filters out deleted connections', () => {
  const connections = [
    makeConnection({ id: 'c-del', deletedAt: new Date('2026-04-16T00:00:00Z'), lastSuccessfulSyncAt: null }),
  ];
  assertEqual(selectConnectionsDue(connections, FIXED_NOW), [], 'deleted filtered out');
});

test('filters out connections with wrong syncPhase', () => {
  const connections = [
    makeConnection({ id: 'c-wrong', syncPhase: 'idle' as any, lastSuccessfulSyncAt: null }),
  ];
  assertEqual(selectConnectionsDue(connections, FIXED_NOW), [], 'wrong syncPhase filtered out');
});

test('returns connection when elapsed > pollIntervalMinutes', () => {
  const lastSync = new Date(FIXED_NOW.getTime() - 20 * 60 * 1000); // 20 min ago
  const connections = [makeConnection({ id: 'c-due', pollIntervalMinutes: 15, lastSuccessfulSyncAt: lastSync })];
  assertEqual(selectConnectionsDue(connections, FIXED_NOW), ['c-due'], 'overdue connection returned');
});

test('does not return connection when elapsed < pollIntervalMinutes', () => {
  const lastSync = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000); // 5 min ago
  const connections = [makeConnection({ id: 'c-not-due', pollIntervalMinutes: 15, lastSuccessfulSyncAt: lastSync })];
  assertEqual(selectConnectionsDue(connections, FIXED_NOW), [], 'not-due connection excluded');
});

test('returns multiple due connections', () => {
  const connections = [
    makeConnection({ id: 'c-a', lastSuccessfulSyncAt: null }),
    makeConnection({ id: 'c-b', lastSuccessfulSyncAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000) }), // 1h ago
    makeConnection({ id: 'c-c', lastSuccessfulSyncAt: new Date(FIXED_NOW.getTime() - 1 * 60 * 1000) }), // 1 min ago, not due
  ];
  const result = selectConnectionsDue(connections, FIXED_NOW);
  assertTrue(result.includes('c-a'), 'c-a due (never synced)');
  assertTrue(result.includes('c-b'), 'c-b due (1h ago)');
  assertTrue(!result.includes('c-c'), 'c-c not due (1 min ago)');
  assertEqual(result.length, 2, 'exactly 2 due');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
