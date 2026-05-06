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

import { expect, test } from 'vitest';
import { formatDuration } from '../formatDuration.js';

// ── null ──────────────────────────────────────────────────────────────────────

test('null → em-dash', () => expect(formatDuration(null)).toBe('—'));

// ── sub-second (0–999 ms) ─────────────────────────────────────────────────────

test('0 ms → "0s"',   () => expect(formatDuration(0)).toBe('0s'));
test('999 ms → "0s"', () => expect(formatDuration(999)).toBe('0s'));

// ── seconds (1 000–59 999 ms) ─────────────────────────────────────────────────

test('1000 ms → "1s"',  () => expect(formatDuration(1000)).toBe('1s'));
test('1999 ms → "1s"',  () => expect(formatDuration(1999)).toBe('1s'));
test('59999 ms → "59s"', () => expect(formatDuration(59999)).toBe('59s'));

// ── minutes (60 000–3 599 999 ms) ────────────────────────────────────────────

test('60000 ms → "1m 0s"',    () => expect(formatDuration(60000)).toBe('1m 0s'));
test('119000 ms → "1m 59s"',  () => expect(formatDuration(119000)).toBe('1m 59s'));
test('3599999 ms → "59m 59s"', () => expect(formatDuration(3599999)).toBe('59m 59s'));

// ── hours (>=3 600 000 ms) ────────────────────────────────────────────────────

test('3600000 ms → "1h 0m"',  () => expect(formatDuration(3600000)).toBe('1h 0m'));
test('7800000 ms → "2h 10m"', () => expect(formatDuration(7800000)).toBe('2h 10m'));

// ──────────────────────────────────────────────────────────────────────────────

console.log('');