/**
 * manualBaselineFormPure.test.ts
 *
 * Pure-function tests for the cents↔dollars conversion in ManualBaselineForm.
 * Guards the B4 fix from regression — see pr-review-log-baseline-capture-*.
 *
 * Run via:
 *   npx vitest run client/src/components/baseline/__tests__/manualBaselineFormPure.test.ts
 */

import { test, expect } from 'vitest';
import {
  parseInputToServerNumeric,
  formatServerNumericForInput,
} from '../manualBaselineFormPure';

// ── parseInputToServerNumeric ────────────────────────────────────────────────

test('parse cents-unit "47.55" → 4755 (integer cents, Math.round)', () => {
  expect(parseInputToServerNumeric('47.55', 'cents')).toBe(4755);
});

test('parse cents-unit "47000" → 4700000 (operator typing whole-dollar amount)', () => {
  expect(parseInputToServerNumeric('47000', 'cents')).toBe(4700000);
});

test('parse cents-unit "0" → 0', () => {
  expect(parseInputToServerNumeric('0', 'cents')).toBe(0);
});

test('parse cents-unit defends against float artifact at 47.55', () => {
  // Native: 47.55 * 100 === 4754.9999999999995. Math.round must convert to 4755.
  expect(parseInputToServerNumeric('47.55', 'cents')).toBe(4755);
});

test('parse cents-unit defends against float artifact at 0.1+0.2 surrogate', () => {
  // 0.30 entered explicitly — round-trips cleanly.
  expect(parseInputToServerNumeric('0.30', 'cents')).toBe(30);
});

test('parse count-unit "42" → 42 (no scaling)', () => {
  expect(parseInputToServerNumeric('42', 'count')).toBe(42);
});

test('parse count-unit "0" → 0', () => {
  expect(parseInputToServerNumeric('0', 'count')).toBe(0);
});

test('parse percent-unit "0.05" → 0.05 (no scaling, decimals preserved)', () => {
  expect(parseInputToServerNumeric('0.05', 'percent')).toBe(0.05);
});

test('parse empty string → null (skip metric)', () => {
  expect(parseInputToServerNumeric('', 'cents')).toBe(null);
  expect(parseInputToServerNumeric('', 'count')).toBe(null);
  expect(parseInputToServerNumeric('', 'percent')).toBe(null);
});

test('parse negative → null (form-side defensive filter; server enforces nonnegative too)', () => {
  expect(parseInputToServerNumeric('-1', 'cents')).toBe(null);
  expect(parseInputToServerNumeric('-0.5', 'cents')).toBe(null);
  expect(parseInputToServerNumeric('-42', 'count')).toBe(null);
});

test('parse non-numeric → null', () => {
  expect(parseInputToServerNumeric('abc', 'count')).toBe(null);
  expect(parseInputToServerNumeric('NaN', 'cents')).toBe(null);
});

// ── formatServerNumericForInput ──────────────────────────────────────────────

test('format cents-unit 4755 → "47.55" (dollars-and-cents display)', () => {
  expect(formatServerNumericForInput(4755, 'cents')).toBe('47.55');
});

test('format cents-unit 4700000 → "47000"', () => {
  expect(formatServerNumericForInput(4700000, 'cents')).toBe('47000');
});

test('format cents-unit 0 → "0"', () => {
  expect(formatServerNumericForInput(0, 'cents')).toBe('0');
});

test('format count-unit 42 → "42" (no scaling)', () => {
  expect(formatServerNumericForInput(42, 'count')).toBe('42');
});

test('format percent-unit 0.05 → "0.05" (no scaling, decimals preserved)', () => {
  expect(formatServerNumericForInput(0.05, 'percent')).toBe('0.05');
});

test('format null → empty string', () => {
  expect(formatServerNumericForInput(null, 'cents')).toBe('');
  expect(formatServerNumericForInput(null, 'count')).toBe('');
  expect(formatServerNumericForInput(null, 'percent')).toBe('');
});

test('format undefined → empty string', () => {
  expect(formatServerNumericForInput(undefined, 'cents')).toBe('');
});

// ── round-trip ────────────────────────────────────────────────────────────────

test('round-trip cents: format(parse("47.55")) === "47.55"', () => {
  const parsed = parseInputToServerNumeric('47.55', 'cents');
  expect(parsed).not.toBeNull();
  expect(formatServerNumericForInput(parsed, 'cents')).toBe('47.55');
});

test('round-trip cents: parse(format(4755)) === 4755', () => {
  const formatted = formatServerNumericForInput(4755, 'cents');
  expect(parseInputToServerNumeric(formatted, 'cents')).toBe(4755);
});

test('round-trip count: format(parse("42")) === "42"', () => {
  const parsed = parseInputToServerNumeric('42', 'count');
  expect(parsed).not.toBeNull();
  expect(formatServerNumericForInput(parsed, 'count')).toBe('42');
});
