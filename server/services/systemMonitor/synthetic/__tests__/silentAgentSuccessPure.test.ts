/**
 * silentAgentSuccessPure — unit tests for isSilentAgentRatioElevated and env parsers.
 *
 * Runnable via:
 *   npx tsx server/services/systemMonitor/synthetic/__tests__/silentAgentSuccessPure.test.ts
 */
import { expect, test } from 'vitest';
import {
  isSilentAgentRatioElevated,
  parseMinSamplesEnv,
  parseRatioThresholdEnv,
} from '../silentAgentSuccessPure.js';

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

const THRESHOLD = 0.30;
const MIN_SAMPLES = 5;

test('0/5 → false (no silent runs)', () => {
  check(!isSilentAgentRatioElevated(5, 0, THRESHOLD, MIN_SAMPLES), 'expected false: 0/5 = 0%');
});

test('2/5 (40%) → true at threshold 0.30', () => {
  check(isSilentAgentRatioElevated(5, 2, THRESHOLD, MIN_SAMPLES), 'expected true: 2/5 = 40% >= 30%');
});

test('1/5 (20%) → false at threshold 0.30', () => {
  check(!isSilentAgentRatioElevated(5, 1, THRESHOLD, MIN_SAMPLES), 'expected false: 1/5 = 20% < 30%');
});

test('3/4 → false because below minSamples (4 < 5)', () => {
  check(!isSilentAgentRatioElevated(4, 3, THRESHOLD, MIN_SAMPLES), 'expected false: 4 total < minSamples 5');
});

test('0/0 → false (zero total)', () => {
  check(!isSilentAgentRatioElevated(0, 0, THRESHOLD, MIN_SAMPLES), 'expected false: total = 0');
});

// Env-parser hardening (mirrors parseStaleAfterMinutesEnv guards).

test('parseRatioThresholdEnv: undefined → default 0.30', () => {
  check(parseRatioThresholdEnv(undefined) === 0.30, 'expected 0.30 for undefined');
});

test('parseRatioThresholdEnv: empty string → default 0.30', () => {
  check(parseRatioThresholdEnv('') === 0.30, 'expected 0.30 for empty string');
});

test('parseRatioThresholdEnv: non-numeric → default 0.30', () => {
  check(parseRatioThresholdEnv('abc') === 0.30, 'expected 0.30 for non-numeric');
});

test('parseRatioThresholdEnv: zero → default 0.30 (non-positive)', () => {
  check(parseRatioThresholdEnv('0') === 0.30, 'expected 0.30 for zero');
});

test('parseRatioThresholdEnv: negative → default 0.30 (non-positive)', () => {
  check(parseRatioThresholdEnv('-0.1') === 0.30, 'expected 0.30 for negative');
});

test('parseRatioThresholdEnv: valid 0.5 → 0.5', () => {
  check(parseRatioThresholdEnv('0.5') === 0.5, 'expected 0.5 for valid string "0.5"');
});

test('parseMinSamplesEnv: undefined → default 5', () => {
  check(parseMinSamplesEnv(undefined) === 5, 'expected 5 for undefined');
});

test('parseMinSamplesEnv: non-numeric → default 5', () => {
  check(parseMinSamplesEnv('abc') === 5, 'expected 5 for non-numeric');
});

test('parseMinSamplesEnv: zero → default 5 (non-positive)', () => {
  check(parseMinSamplesEnv('0') === 5, 'expected 5 for zero');
});

test('parseMinSamplesEnv: valid 10 → 10', () => {
  check(parseMinSamplesEnv('10') === 10, 'expected 10 for valid string "10"');
});
