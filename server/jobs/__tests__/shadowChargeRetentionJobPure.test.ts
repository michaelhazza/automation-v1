// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * shadowChargeRetentionJobPure.test.ts
 *
 * Pure-function tests for shadowChargeRetentionJob.
 * Tests cutoff math and per-row decision logic — no Postgres required.
 *
 * Run via: npx vitest run server/jobs/__tests__/shadowChargeRetentionJobPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  resolveShadowRetentionDays,
  computeShadowRetentionCutoff,
  decideShadowRetention,
  type ShadowSettledRow,
} from '../shadowChargeRetentionJobPure.js';

export {};

console.log('\nshadowChargeRetentionJobPure — pure-function tests\n');

// ---------------------------------------------------------------------------
// resolveShadowRetentionDays
// ---------------------------------------------------------------------------

test('resolveShadowRetentionDays returns org value when in [1, 365]', () => {
  expect(resolveShadowRetentionDays(90, 90)).toBe(90);
  expect(resolveShadowRetentionDays(1, 90)).toBe(1);
  expect(resolveShadowRetentionDays(365, 90)).toBe(365);
  expect(resolveShadowRetentionDays(30, 90)).toBe(30);
});

test('resolveShadowRetentionDays falls back to default when value is 0', () => {
  expect(resolveShadowRetentionDays(0, 90)).toBe(90);
});

test('resolveShadowRetentionDays falls back to default when value is negative', () => {
  expect(resolveShadowRetentionDays(-1, 90)).toBe(90);
  expect(resolveShadowRetentionDays(-365, 90)).toBe(90);
});

test('resolveShadowRetentionDays falls back to default when value exceeds 365', () => {
  expect(resolveShadowRetentionDays(366, 90)).toBe(90);
  expect(resolveShadowRetentionDays(1000, 90)).toBe(90);
});

test('resolveShadowRetentionDays floors fractional values', () => {
  expect(resolveShadowRetentionDays(90.9, 90)).toBe(90);
  expect(resolveShadowRetentionDays(30.1, 90)).toBe(30);
});

test('resolveShadowRetentionDays handles NaN by falling back to default', () => {
  expect(resolveShadowRetentionDays(NaN, 90)).toBe(90);
});

// ---------------------------------------------------------------------------
// computeShadowRetentionCutoff
// ---------------------------------------------------------------------------

test('computeShadowRetentionCutoff subtracts correct ms for 90-day window', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const expected = new Date('2026-05-03T03:30:00.000Z').getTime() - 90 * 24 * 60 * 60 * 1000;
  expect(cutoff.getTime()).toBe(expected);
});

test('computeShadowRetentionCutoff does not mutate input date', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const original = now.getTime();
  computeShadowRetentionCutoff(now, 30);
  expect(now.getTime()).toBe(original);
});

test('computeShadowRetentionCutoff with 1-day window', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 1);
  const expected = now.getTime() - 24 * 60 * 60 * 1000;
  expect(cutoff.getTime()).toBe(expected);
});

test('computeShadowRetentionCutoff with 365-day window', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 365);
  const expected = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  expect(cutoff.getTime()).toBe(expected);
});

// ---------------------------------------------------------------------------
// decideShadowRetention — per-row decision
// ---------------------------------------------------------------------------

test('shadow_settled row with settled_at before cutoff → shouldDelete=true', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-1',
    status: 'shadow_settled',
    settledAt: new Date(cutoff.getTime() - 1), // 1ms before cutoff
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(true);
  expect(decision.reason).toBe('past_retention_window');
  expect(decision.chargeId).toBe('charge-1');
});

test('shadow_settled row with settled_at exactly at cutoff → NOT deleted', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-2',
    status: 'shadow_settled',
    settledAt: new Date(cutoff.getTime()), // exactly at cutoff
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('within_window');
});

test('shadow_settled row with settled_at after cutoff → NOT deleted', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-3',
    status: 'shadow_settled',
    settledAt: new Date(cutoff.getTime() + 1000), // 1s after cutoff
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('within_window');
});

test('shadow_settled row with null settled_at → NOT deleted', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-4',
    status: 'shadow_settled',
    settledAt: null,
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('no_settled_at');
});

// ---------------------------------------------------------------------------
// decideShadowRetention — non-shadow_settled rows are never deleted
// ---------------------------------------------------------------------------

test('proposed row is not deleted by retention job', () => {
  const cutoff = new Date('2026-02-01T00:00:00.000Z');
  const row: ShadowSettledRow = {
    id: 'charge-5',
    status: 'proposed',
    settledAt: new Date('2026-01-01T00:00:00.000Z'), // well before cutoff
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('not_shadow_settled');
});

test('succeeded row is not deleted by retention job', () => {
  const cutoff = new Date('2026-02-01T00:00:00.000Z');
  const row: ShadowSettledRow = {
    id: 'charge-6',
    status: 'succeeded',
    settledAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('not_shadow_settled');
});

test('blocked row is not deleted by retention job', () => {
  const cutoff = new Date('2026-02-01T00:00:00.000Z');
  const row: ShadowSettledRow = {
    id: 'charge-7',
    status: 'blocked',
    settledAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('not_shadow_settled');
});

test('failed row is not deleted by retention job', () => {
  const cutoff = new Date('2026-02-01T00:00:00.000Z');
  const row: ShadowSettledRow = {
    id: 'charge-8',
    status: 'failed',
    settledAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const decision = decideShadowRetention(row, cutoff);
  expect(decision.shouldDelete).toBe(false);
  expect(decision.reason).toBe('not_shadow_settled');
});

// ---------------------------------------------------------------------------
// Multi-org cutoff math — different retention windows produce different cutoffs
// ---------------------------------------------------------------------------

test('org with 30-day window has a more recent cutoff than org with 90-day window', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff30 = computeShadowRetentionCutoff(now, 30);
  const cutoff90 = computeShadowRetentionCutoff(now, 90);
  expect(cutoff30.getTime()).toBeGreaterThan(cutoff90.getTime());
});

test('settled 60 days ago is past 30-day window but within 90-day window', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');
  const settledAt = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const cutoff30 = computeShadowRetentionCutoff(now, 30);
  const cutoff90 = computeShadowRetentionCutoff(now, 90);

  const row: ShadowSettledRow = { id: 'charge-x', status: 'shadow_settled', settledAt };

  const decision30 = decideShadowRetention(row, cutoff30);
  const decision90 = decideShadowRetention(row, cutoff90);

  expect(decision30.shouldDelete).toBe(true);
  expect(decision90.shouldDelete).toBe(false);
});

// ---------------------------------------------------------------------------
// Boundary: 1ms before / after cutoff
// ---------------------------------------------------------------------------

test('settled 1ms before cutoff → shouldDelete=true', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-bnd-1',
    status: 'shadow_settled',
    settledAt: new Date(cutoff.getTime() - 1),
  };
  expect(decideShadowRetention(row, cutoff).shouldDelete).toBe(true);
});

test('settled 1ms after cutoff → shouldDelete=false', () => {
  const now = new Date('2026-05-03T03:30:00.000Z');
  const cutoff = computeShadowRetentionCutoff(now, 90);
  const row: ShadowSettledRow = {
    id: 'charge-bnd-2',
    status: 'shadow_settled',
    settledAt: new Date(cutoff.getTime() + 1),
  };
  expect(decideShadowRetention(row, cutoff).shouldDelete).toBe(false);
});
