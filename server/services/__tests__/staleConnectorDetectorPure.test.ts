/**
 * staleConnectorDetectorPure.test.ts — Canonical Data Platform P1 pure tests.
 *
 * Tests for the computeStaleness pure function.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/staleConnectorDetectorPure.test.ts
 */

import { computeStaleness, type ConnectorHealth } from '../workspaceHealth/detectors/staleConnectorDetectorPure.js';

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
  assertEqual(result.severity, 'none', 'severity');
  assertEqual(result.reason, 'Healthy', 'reason');
});

test('returns warning when 2-5× overdue', () => {
  // 3× overdue: 3 * 60 min = 180 min ago
  const lastSync = new Date(FIXED_NOW.getTime() - 3 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  assertEqual(result.severity, 'warning', 'severity');
  assertTrue(result.reason.includes('3'), 'reason includes multiplier');
  assertTrue(result.reason.includes('overdue'), 'reason includes overdue');
});

test('returns error when >5× overdue', () => {
  // 6× overdue
  const lastSync = new Date(FIXED_NOW.getTime() - 6 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  assertEqual(result.severity, 'error', 'severity');
  assertTrue(result.reason.includes('6'), 'reason includes multiplier');
  assertTrue(result.reason.includes('overdue'), 'reason includes overdue');
});

test('returns error when never synced and past grace period', () => {
  // Created 48h ago, never synced (grace is 24h)
  const created = new Date(FIXED_NOW.getTime() - 48 * 60 * 60 * 1000);
  const result = computeStaleness(
    makeHealth({ lastSuccessfulSyncAt: null, createdAt: created }),
    FIXED_NOW,
  );
  assertEqual(result.severity, 'error', 'severity');
  assertTrue(result.reason.includes('Never synced'), 'reason includes Never synced');
  assertTrue(result.reason.includes('48h ago'), 'reason includes 48h ago');
});

test('returns none when never synced but within grace period', () => {
  // Created 12h ago, never synced (grace is 24h)
  const created = new Date(FIXED_NOW.getTime() - 12 * 60 * 60 * 1000);
  const result = computeStaleness(
    makeHealth({ lastSuccessfulSyncAt: null, createdAt: created }),
    FIXED_NOW,
  );
  assertEqual(result.severity, 'none', 'severity');
  assertEqual(result.reason, 'Within grace period', 'reason');
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
  assertEqual(result.severity, 'error', 'severity');
  assertTrue(result.reason.includes('Last sync error within 24h'), 'reason includes error context');
  assertTrue(result.reason.includes('overdue'), 'reason includes overdue');
});

test('edge case: exactly at 2× boundary returns none', () => {
  // Exactly 2× overdue — elapsed === WARNING_MULTIPLIER * interval
  // The check is `elapsed > WARNING_MULTIPLIER * interval` so exactly 2× should be 'none'
  const lastSync = new Date(FIXED_NOW.getTime() - 2 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  assertEqual(result.severity, 'none', 'severity at exact 2× boundary');
});

test('edge case: exactly at 5× boundary returns warning', () => {
  // Exactly 5× overdue — elapsed === ERROR_MULTIPLIER * interval
  // The check is `elapsed > ERROR_MULTIPLIER * interval` so exactly 5× should be 'warning'
  const lastSync = new Date(FIXED_NOW.getTime() - 5 * INTERVAL_MS);
  const result = computeStaleness(makeHealth({ lastSuccessfulSyncAt: lastSync }), FIXED_NOW);
  assertEqual(result.severity, 'warning', 'severity at exact 5× boundary');
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
