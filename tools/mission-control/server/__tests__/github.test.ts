/**
 * github.test.ts
 *
 * Pure-helper tests for github.ts. The actual `fetch*` functions are boundary
 * code (network) and intentionally not unit-tested per spec § 9; only the
 * pure helpers (`deriveCiStatus`, `pickLatestCompletedAt`) live here.
 *
 * Run via: npx tsx tools/mission-control/server/__tests__/github.test.ts
 */

import { deriveCiStatus, pickLatestCompletedAt } from '../lib/github.js';

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, got ${a}`);
}

// --- deriveCiStatus ---

test('deriveCiStatus empty → unknown', () => {
  eq(deriveCiStatus([]), 'unknown', 'status');
});

test('deriveCiStatus all success → passing', () => {
  eq(
    deriveCiStatus([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
    ]),
    'passing',
    'status',
  );
});

test('deriveCiStatus any in_progress → pending', () => {
  eq(
    deriveCiStatus([
      { status: 'completed', conclusion: 'success' },
      { status: 'in_progress', conclusion: null },
    ]),
    'pending',
    'status',
  );
});

test('deriveCiStatus any failure → failing', () => {
  eq(
    deriveCiStatus([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]),
    'failing',
    'status',
  );
});

test('deriveCiStatus action_required → failing (S3)', () => {
  eq(
    deriveCiStatus([{ status: 'completed', conclusion: 'action_required' }]),
    'failing',
    'status',
  );
});

test('deriveCiStatus stale → pending (S3)', () => {
  eq(
    deriveCiStatus([{ status: 'completed', conclusion: 'stale' }]),
    'pending',
    'status',
  );
});

test('deriveCiStatus unknown conclusion → unknown (defensive)', () => {
  eq(
    deriveCiStatus([{ status: 'completed', conclusion: 'totally_new_value' }]),
    'unknown',
    'status',
  );
});

// --- pickLatestCompletedAt ---

test('pickLatestCompletedAt empty → null', () => {
  eq(pickLatestCompletedAt([]), null, 'ts');
});

test('pickLatestCompletedAt single → returns it', () => {
  eq(
    pickLatestCompletedAt([{ completed_at: '2026-04-28T10:00:00Z' }]),
    '2026-04-28T10:00:00Z',
    'ts',
  );
});

test('pickLatestCompletedAt picks max across multiple', () => {
  eq(
    pickLatestCompletedAt([
      { completed_at: '2026-04-28T10:00:00Z' },
      { completed_at: '2026-04-28T12:00:00Z' },
      { completed_at: '2026-04-28T11:00:00Z' },
    ]),
    '2026-04-28T12:00:00Z',
    'ts',
  );
});

test('pickLatestCompletedAt skips null and missing', () => {
  eq(
    pickLatestCompletedAt([
      { completed_at: null },
      {},
      { completed_at: '2026-04-28T09:00:00Z' },
    ]),
    '2026-04-28T09:00:00Z',
    'ts',
  );
});

test('pickLatestCompletedAt all-null → null', () => {
  eq(pickLatestCompletedAt([{ completed_at: null }, {}]), null, 'ts');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
