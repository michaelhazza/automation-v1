/**
 * formatDuration.test.ts
 *
 * Tests for the formatDuration utility.
 * Run via: npx tsx client/src/lib/__tests__/formatDuration.test.ts
 *
 * Contract:
 *   null          → '—'
 *   0–999         → '0s'          (all sub-second values display as 0s)
 *   1000–59999    → 'Ns'          (floor seconds)
 *   60000–3599999 → 'Nm Ns'       (floor minutes + floor remaining seconds)
 *   >=3600000     → 'Nh Nm'       (floor hours + floor remaining minutes)
 */

import { formatDuration } from '../formatDuration.js';

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

function assertEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`expected "${expected}" but got "${actual}"`);
  }
}

// ── null ──────────────────────────────────────────────────────────────────────

test('null → em-dash', () => assertEqual(formatDuration(null), '—'));

// ── sub-second (0–999 ms) ─────────────────────────────────────────────────────

test('0 ms → "0s"',   () => assertEqual(formatDuration(0),   '0s'));
test('999 ms → "0s"', () => assertEqual(formatDuration(999), '0s'));

// ── seconds (1 000–59 999 ms) ─────────────────────────────────────────────────

test('1000 ms → "1s"',  () => assertEqual(formatDuration(1000),  '1s'));
test('1999 ms → "1s"',  () => assertEqual(formatDuration(1999),  '1s'));
test('59999 ms → "59s"', () => assertEqual(formatDuration(59999), '59s'));

// ── minutes (60 000–3 599 999 ms) ────────────────────────────────────────────

test('60000 ms → "1m 0s"',    () => assertEqual(formatDuration(60000),    '1m 0s'));
test('119000 ms → "1m 59s"',  () => assertEqual(formatDuration(119000),   '1m 59s'));
test('3599999 ms → "59m 59s"', () => assertEqual(formatDuration(3599999), '59m 59s'));

// ── hours (>=3 600 000 ms) ────────────────────────────────────────────────────

test('3600000 ms → "1h 0m"',  () => assertEqual(formatDuration(3600000),  '1h 0m'));
test('7800000 ms → "2h 10m"', () => assertEqual(formatDuration(7800000),  '2h 10m'));

// ──────────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
