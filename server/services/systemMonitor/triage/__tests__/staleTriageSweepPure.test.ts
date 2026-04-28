/**
 * staleTriageSweepPure — unit tests for parseStaleAfterMinutesEnv and cutoff logic.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/triage/__tests__/staleTriageSweepPure.test.ts
 */
import { parseStaleAfterMinutesEnv, staleCutoff } from '../staleTriageSweepPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// parseStaleAfterMinutesEnv boundary cases

test('parseStaleAfterMinutesEnv: undefined → default 10', () => {
  check(parseStaleAfterMinutesEnv(undefined) === 10, 'expected 10 for undefined');
});

test('parseStaleAfterMinutesEnv: empty string → default 10', () => {
  check(parseStaleAfterMinutesEnv('') === 10, 'expected 10 for empty string');
});

test('parseStaleAfterMinutesEnv: non-numeric string → default 10', () => {
  check(parseStaleAfterMinutesEnv('abc') === 10, 'expected 10 for non-numeric string');
});

test('parseStaleAfterMinutesEnv: zero → default 10 (non-positive)', () => {
  check(parseStaleAfterMinutesEnv('0') === 10, 'expected 10 for zero (non-positive)');
});

test('parseStaleAfterMinutesEnv: negative → default 10 (non-positive)', () => {
  check(parseStaleAfterMinutesEnv('-5') === 10, 'expected 10 for negative value');
});

test('parseStaleAfterMinutesEnv: valid 10 → 10', () => {
  check(parseStaleAfterMinutesEnv('10') === 10, 'expected 10 for valid string "10"');
});

test('parseStaleAfterMinutesEnv: valid 30 → 30', () => {
  check(parseStaleAfterMinutesEnv('30') === 30, 'expected 30 for valid string "30"');
});

// Cutoff calculation correctness
test('cutoff: now - 10min is exactly 10 minutes before now', () => {
  const now = new Date('2026-04-27T14:00:00.000Z');
  const cutoff = staleCutoff(now, 10 * 60 * 1000);
  check(cutoff.getTime() === new Date('2026-04-27T13:50:00.000Z').getTime(), 'cutoff should be 13:50');
});

test('cutoff: row at cutoff-1ms is stale (< cutoff)', () => {
  const now = new Date('2026-04-27T14:00:00.000Z');
  const cutoff = staleCutoff(now, 10 * 60 * 1000);
  const rowAt = new Date(cutoff.getTime() - 1);
  check(rowAt < cutoff, 'row 1ms before cutoff should be stale');
});

test('cutoff: row exactly at cutoff is NOT stale (not < cutoff)', () => {
  const now = new Date('2026-04-27T14:00:00.000Z');
  const cutoff = staleCutoff(now, 10 * 60 * 1000);
  const rowAt = new Date(cutoff.getTime());
  check(!(rowAt < cutoff), 'row exactly at cutoff should not be stale');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
