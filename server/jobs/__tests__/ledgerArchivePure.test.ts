/**
 * ledgerArchivePure.test.ts — pure-function tests for
 * computeArchiveCutoff(retentionMonths, now). Month-boundary arithmetic
 * and injected clock for determinism.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/ledgerArchivePure.test.ts
 */

import { computeArchiveCutoff } from '../llmLedgerArchiveJobPure.js';

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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

test('12-month retention from mid-year', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  const cutoff = computeArchiveCutoff(12, now);
  assert(cutoff.toISOString() === '2025-07-15T00:00:00.000Z', `got ${cutoff.toISOString()}`);
});

test('3-month retention crossing year boundary', () => {
  const now = new Date('2026-02-10T00:00:00Z');
  const cutoff = computeArchiveCutoff(3, now);
  assert(cutoff.toISOString() === '2025-11-10T00:00:00.000Z', `got ${cutoff.toISOString()}`);
});

test('1-month retention preserves day-of-month', () => {
  const now = new Date('2026-04-20T03:00:00Z');
  const cutoff = computeArchiveCutoff(1, now);
  assert(cutoff.toISOString() === '2026-03-20T03:00:00.000Z', `got ${cutoff.toISOString()}`);
});

test('0-month retention → same instant (archive job becomes archive-everything)', () => {
  const now = new Date('2026-04-20T12:00:00Z');
  const cutoff = computeArchiveCutoff(0, now);
  assert(cutoff.toISOString() === '2026-04-20T12:00:00.000Z', `got ${cutoff.toISOString()}`);
});

test('injected clock is not mutated', () => {
  const now = new Date('2026-04-20T00:00:00Z');
  const nowIso = now.toISOString();
  computeArchiveCutoff(6, now);
  assert(now.toISOString() === nowIso, 'now was mutated');
});

test('day 31 into a short month: Jan 31 - 1 month', () => {
  // JS Date.setMonth quirk: Jan 31 - 1 month becomes Dec 31 of prior year,
  // not Dec 31 with a day overflow. Verify behaviour is predictable.
  const now = new Date('2026-01-31T00:00:00Z');
  const cutoff = computeArchiveCutoff(1, now);
  // The stdlib happens to preserve day 31; we're asserting whatever the
  // consistent answer is so a future JS engine change would flag.
  assert(cutoff.getUTCFullYear() === 2025, 'year - 1');
  assert(cutoff.getUTCMonth() === 11, 'December (0-indexed 11)');
  assert(cutoff.getUTCDate() === 31, 'day preserved (V8 month-overflow stable at 31)');
});

console.log('');
console.log(`[ledgerArchivePure] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
