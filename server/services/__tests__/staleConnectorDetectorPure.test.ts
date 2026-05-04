/**
 * staleConnectorDetectorPure.test.ts — Canonical Data Platform P1 pure tests.
 *
 * Tests for the computeStaleness pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/staleConnectorDetectorPure.test.ts
 */

import { expect, test } from 'vitest';
import { computeStaleness, type ConnectorHealth } from '../workspaceHealth/detectors/staleConnectorDetectorPure.js';

const FIXED_NOW = new Date('2026-04-17T12:00:00.000Z');
const POLL_INTERVAL = 60; // 60 minutes
const INTERVAL_MS = POLL_INTERVAL * 60 * 1000;

function makeHealth(overrides: Partial<ConnectorHealth> = {}): ConnectorHealth {
  return {
    connectionId: 'conn-1',
    connectionLabel: 'Test Connection',
    lastSuccessfulSyncAt: new Date(FIXED_NOW.getTime() - 30 * 60 * 1000), // 30 min ago — healthy
    lastSyncError: null,
    lastSyncErrorAt: null,
    pollIntervalMinutes: POLL_INTERVAL,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  };
}

console.log('');
console.log('staleConnectorDetectorPure — Canonical Data Platform P1');
console.log('');

// ── computeStaleness ─────────────────────────────────────────────────────

test('returns none when within interval', () => {
  const result = computeStaleness(makeHealth(), FIXED_NOW);
  expect(result.severity, 'severity').toBe('none');
  expect(result.reason, 'reason').toBe('Healthy');
});

test('returns warning when 2-5× overdue', () => {
  // 3× overdue: 3 * 60 min = 180 min ago
  const lastSync = new Date(FIXED_NOW.getTime() - 3 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  expect(result.severity, 'severity').toBe('warning');
  expect(result.reason.includes('3'), 'reason includes multiplier').toBe(true);
  expect(result.reason.includes('overdue'), 'reason includes overdue').toBe(true);
});

test('returns error when >5× overdue', () => {
  // 6× overdue
  const lastSync = new Date(FIXED_NOW.getTime() - 6 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  expect(result.severity, 'severity').toBe('error');
  expect(result.reason.includes('6'), 'reason includes multiplier').toBe(true);
  expect(result.reason.includes('overdue'), 'reason includes overdue').toBe(true);
});

test('returns error when never synced and past grace period', () => {
  // Created 48h ago, never synced (grace is 24h)
  const created = new Date(FIXED_NOW.getTime() - 48 * 60 * 60 * 1000);
  const result = computeStaleness(
    makeHealth({ lastSuccessfulSyncAt: null, createdAt: created }),
    FIXED_NOW,
  );
  expect(result.severity, 'severity').toBe('error');
  expect(result.reason.includes('Never synced'), 'reason includes Never synced').toBe(true);
  expect(result.reason.includes('48h ago'), 'reason includes 48h ago').toBe(true);
});

test('returns none when never synced but within grace period', () => {
  // Created 12h ago, never synced (grace is 24h)
  const created = new Date(FIXED_NOW.getTime() - 12 * 60 * 60 * 1000);
  const result = computeStaleness(
    makeHealth({ lastSuccessfulSyncAt: null, createdAt: created }),
    FIXED_NOW,
  );
  expect(result.severity, 'severity').toBe('none');
  expect(result.reason, 'reason').toBe('Within grace period');
});

test('returns error when recent error and >5× overdue', () => {
  // 6× overdue with a recent error (10h ago)
  const lastSync = new Date(FIXED_NOW.getTime() - 6 * INTERVAL_MS);
  const errorAt = new Date(FIXED_NOW.getTime() - 10 * 60 * 60 * 1000);
  const result = computeStaleness(
    makeHealth({
      lastSuccessfulSyncAt: lastSync,
      lastSyncError: 'Connection refused',
      lastSyncErrorAt: errorAt,
    }),
    FIXED_NOW,
  );
  expect(result.severity, 'severity').toBe('error');
  expect(result.reason.includes('Last sync error within 24h'), 'reason includes error context').toBe(true);
  expect(result.reason.includes('overdue'), 'reason includes overdue').toBe(true);
});

test('edge case: exactly at 2× boundary returns none', () => {
  // Exactly 2× overdue — elapsed === WARNING_MULTIPLIER * interval
  // The check is `elapsed > WARNING_MULTIPLIER * interval` so exactly 2× should be 'none'
  const lastSync = new Date(FIXED_NOW.getTime() - 2 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  expect(result.severity, 'severity at exact 2× boundary').toBe('none');
});

test('edge case: exactly at 5× boundary returns warning', () => {
  // Exactly 5× overdue — elapsed === ERROR_MULTIPLIER * interval
  // The check is `elapsed > ERROR_MULTIPLIER * interval` so exactly 5× should be 'warning'
  const lastSync = new Date(FIXED_NOW.getTime() - 5 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  expect(result.severity, 'severity at exact 5× boundary').toBe('warning');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
