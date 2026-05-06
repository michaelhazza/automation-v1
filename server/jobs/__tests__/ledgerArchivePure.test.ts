/**
 * ledgerArchivePure.test.ts — pure-function tests for
 * computeArchiveCutoff(retentionMonths, now). Month-boundary arithmetic
 * and injected clock for determinism.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/ledgerArchivePure.test.ts
 */

import { expect, test } from 'vitest';
import { computeArchiveCutoff } from '../llmLedgerArchiveJobPure.js';

test('12-month retention from mid-year', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  const cutoff = computeArchiveCutoff(12, now);
  expect(cutoff.toISOString() === '2025-07-15T00:00:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('3-month retention crossing year boundary', () => {
  const now = new Date('2026-02-10T00:00:00Z');
  const cutoff = computeArchiveCutoff(3, now);
  expect(cutoff.toISOString() === '2025-11-10T00:00:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('1-month retention preserves day-of-month', () => {
  const now = new Date('2026-04-20T03:00:00Z');
  const cutoff = computeArchiveCutoff(1, now);
  expect(cutoff.toISOString() === '2026-03-20T03:00:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('0-month retention → same instant (archive job becomes archive-everything)', () => {
  const now = new Date('2026-04-20T12:00:00Z');
  const cutoff = computeArchiveCutoff(0, now);
  expect(cutoff.toISOString() === '2026-04-20T12:00:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('injected clock is not mutated', () => {
  const now = new Date('2026-04-20T00:00:00Z');
  const nowIso = now.toISOString();
  computeArchiveCutoff(6, now);
  expect(now.toISOString() === nowIso, 'now was mutated').toBeTruthy();
});

test('day 31 into a short month: Jan 31 - 1 month', () => {
  // JS Date.setMonth quirk: Jan 31 - 1 month becomes Dec 31 of prior year,
  // not Dec 31 with a day overflow. Verify behaviour is predictable.
  const now = new Date('2026-01-31T00:00:00Z');
  const cutoff = computeArchiveCutoff(1, now);
  // The stdlib happens to preserve day 31; we're asserting whatever the
  // consistent answer is so a future JS engine change would flag.
  expect(cutoff.getUTCFullYear() === 2025, 'year - 1').toBeTruthy();
  expect(cutoff.getUTCMonth() === 11, 'December (0-indexed 11)').toBeTruthy();
  expect(cutoff.getUTCDate() === 31, 'day preserved (V8 month-overflow stable at 31)').toBeTruthy();
});

console.log('');