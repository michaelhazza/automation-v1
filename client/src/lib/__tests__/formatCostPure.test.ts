/**
 * formatCostPure.test.ts
 *
 * Pure unit tests for formatCostCents and formatTokenCount.
 * Run via: npx tsx client/src/lib/__tests__/formatCostPure.test.ts
 */

import { expect, test } from 'vitest';
import { formatCostCents, formatTokenCount } from '../formatCost.js';

// ── formatCostCents ───────────────────────────────────────────────────────────

test('0 cents → "$0.00"',     () => expect(formatCostCents(0)).toBe('$0.00'));
test('1 cent  → "$0.01"',     () => expect(formatCostCents(1)).toBe('$0.01'));
test('150 cents → "$1.50"',   () => expect(formatCostCents(150)).toBe('$1.50'));
test('1234 cents → "$12.34"', () => expect(formatCostCents(1234)).toBe('$12.34'));
test('100 cents → "$1.00"',   () => expect(formatCostCents(100)).toBe('$1.00'));

// micro flag — sub-dollar-cent values
test('0 cents micro → "$0.00"',       () => expect(formatCostCents(0, true)).toBe('$0.00'));
test('1 cent micro → "$0.01" (≥ 1ct)',() => expect(formatCostCents(1, true)).toBe('$0.01'));

// NaN / negative guard
test('NaN cents → "$0.00"',           () => expect(formatCostCents(NaN)).toBe('$0.00'));
test('Infinity cents → "$0.00"',      () => expect(formatCostCents(Infinity)).toBe('$0.00'));
test('-1 cents → "$0.00"',            () => expect(formatCostCents(-1)).toBe('$0.00'));
test('-100 cents → "$0.00"',          () => expect(formatCostCents(-100)).toBe('$0.00'));

// ── formatTokenCount ─────────────────────────────────────────────────────────

test('0 tokens → "0"',           () => expect(formatTokenCount(0)).toBe('0'));
test('999 tokens → "999"',       () => expect(formatTokenCount(999)).toBe('999'));
test('1000 tokens → "1.0k"',     () => expect(formatTokenCount(1000)).toBe('1.0k'));
test('1500 tokens → "1.5k"',     () => expect(formatTokenCount(1500)).toBe('1.5k'));
test('9999 tokens → "9.9k"',     () => expect(formatTokenCount(9999)).toBe('9.9k'));
test('10000 tokens → "10k"',     () => expect(formatTokenCount(10000)).toBe('10k'));
test('50000 tokens → "50k"',     () => expect(formatTokenCount(50000)).toBe('50k'));
test('1000000 tokens → "1.0M"',  () => expect(formatTokenCount(1000000)).toBe('1.0M'));
test('1500000 tokens → "1.5M"',  () => expect(formatTokenCount(1500000)).toBe('1.5M'));
test('10000000 tokens → "10M"',  () => expect(formatTokenCount(10000000)).toBe('10M'));

console.log('');
