/**
 * connectorPollingSchedulerPure.test.ts — Canonical Data Platform P1 pure tests.
 *
 * Tests for the selectConnectionsDue pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/connectorPollingSchedulerPure.test.ts
 */

import { expect, test } from 'vitest';
import { selectConnectionsDue, type PollingConnection } from '../connectorPollingSchedulerPure.js';

const FIXED_NOW = new Date('2026-04-17T12:00:00.000Z');

function makeConnection(overrides: Partial<PollingConnection> = {}): PollingConnection {
  return {
    id: 'conn-1',
    syncPhase: 'live',
    lastSuccessfulSyncAt: null,
    pollIntervalMinutes: 15,
    ...overrides,
  };
}

console.log('');
console.log('connectorPollingSchedulerPure — Canonical Data Platform P1');
console.log('');

// ── selectConnectionsDue ─────────────────────────────────────────────────

test('returns empty for no connections', () => {
  expect(selectConnectionsDue([], FIXED_NOW), 'empty array').toEqual([]);
});

test('returns connection with null lastSuccessfulSyncAt', () => {
  const connections = [makeConnection({ id: 'c-1', lastSuccessfulSyncAt: null })];
  expect(selectConnectionsDue(connections, FIXED_NOW), 'null sync returns id').toEqual(['c-1']);
});

test('filters out connections with wrong syncPhase', () => {
  const connections = [
    makeConnection({ id: 'c-wrong', syncPhase: 'idle' as any, lastSuccessfulSyncAt: null }),
  ];
  expect(selectConnectionsDue(connections, FIXED_NOW), 'wrong syncPhase filtered out').toEqual([]);
});

test('returns connection when elapsed > pollIntervalMinutes', () => {
  const lastSync = new Date(FIXED_NOW.getTime() - 20 * 60 * 1000); // 20 min ago
  const connections = [makeConnection({ id: 'c-due', pollIntervalMinutes: 15, lastSuccessfulSyncAt: lastSync })];
  expect(selectConnectionsDue(connections, FIXED_NOW), 'overdue connection returned').toEqual(['c-due']);
});

test('does not return connection when elapsed < pollIntervalMinutes', () => {
  const lastSync = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000); // 5 min ago
  const connections = [makeConnection({ id: 'c-not-due', pollIntervalMinutes: 15, lastSuccessfulSyncAt: lastSync })];
  expect(selectConnectionsDue(connections, FIXED_NOW), 'not-due connection excluded').toEqual([]);
});

test('returns multiple due connections', () => {
  const connections = [
    makeConnection({ id: 'c-a', lastSuccessfulSyncAt: null }),
    makeConnection({ id: 'c-b', lastSuccessfulSyncAt: new Date(FIXED_NOW.getTime() - 60 * 60 * 1000) }), // 1h ago
    makeConnection({ id: 'c-c', lastSuccessfulSyncAt: new Date(FIXED_NOW.getTime() - 1 * 60 * 1000) }), // 1 min ago, not due
  ];
  const result = selectConnectionsDue(connections, FIXED_NOW);
  expect(result.includes('c-a'), 'c-a due (never synced)').toBe(true);
  expect(result.includes('c-b'), 'c-b due (1h ago)').toBe(true);
  expect(!result.includes('c-c'), 'c-c not due (1 min ago)').toBe(true);
  expect(result.length, 'exactly 2 due').toBe(2);
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
