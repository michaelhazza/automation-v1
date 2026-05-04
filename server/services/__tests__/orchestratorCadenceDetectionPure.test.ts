/**
 * orchestratorCadenceDetectionPure.test.ts
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/orchestratorCadenceDetectionPure.test.ts
 */

import { expect, test } from 'vitest';
import { detectCadenceSignals } from '../orchestratorCadenceDetectionPure.js';

test('detects day_of_week signal for every Monday phrasing', () => {
  const result = detectCadenceSignals('Can you do this every Monday?');
  expect(result.score).toBeGreaterThanOrEqual(0.35);
  expect(result.signals.some((s) => s.name === 'day_of_week')).toBe(true);
});

test('detects weekly signal for weekly report', () => {
  const result = detectCadenceSignals('Send me a weekly report');
  expect(result.score).toBeGreaterThanOrEqual(0.4);
  expect(result.signals.some((s) => s.name === 'weekly')).toBe(true);
});

test('returns zero score for non-recurring prompt', () => {
  const result = detectCadenceSignals('What is the weather today?');
  expect(result.score).toBe(0);
  expect(result.signals).toHaveLength(0);
});

test('detects daily signal for set a daily reminder', () => {
  const result = detectCadenceSignals('Set a daily reminder');
  expect(result.score).toBeGreaterThanOrEqual(0.4);
  expect(result.signals.some((s) => s.name === 'daily')).toBe(true);
});

test('score is capped at 1 for multiple matching signals', () => {
  const result = detectCadenceSignals('Send me a weekly summary every Monday and remind me daily');
  expect(result.score).toBeLessThanOrEqual(1);
});
