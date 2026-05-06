/**
 * scopeResolutionPure.test.ts — pure-unit tests for shouldSearchEntityHint.
 *
 * Spec §6.5, §12.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scopeResolutionPure.test.ts
 */
import { expect, test } from 'vitest';
import { shouldSearchEntityHint } from '../scopeResolutionPure.js';

test('empty string returns false', () => {
  expect(shouldSearchEntityHint('')).toBe(false);
});

test('whitespace-only returns false', () => {
  expect(shouldSearchEntityHint('   ')).toBe(false);
});

test('single character returns false', () => {
  expect(shouldSearchEntityHint('a')).toBe(false);
});

test('single character padded with whitespace returns false', () => {
  expect(shouldSearchEntityHint(' a ')).toBe(false);
});

test('two characters returns true', () => {
  expect(shouldSearchEntityHint('ab')).toBe(true);
});

test('longer hint returns true', () => {
  expect(shouldSearchEntityHint('Acme')).toBe(true);
});

test('two characters with surrounding whitespace returns true', () => {
  expect(shouldSearchEntityHint('  ab  ')).toBe(true);
});
