/**
 * Pure-function tests for challenge_assumptions output validation.
 * Run via: npx tsx server/tools/capabilities/__tests__/challengeAssumptionsHandlerPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateChallengeAssumptionsOutput,
  parseChallengeAssumptionsOutput,
  assembleChallengeAssumptionsPrompt,
  computeOverallRisk,
} from '../challengeAssumptionsHandlerPure.js';

const LOW_ITEM = {
  concern: 'Data may be stale by up to 24 hours.',
  severity: 'low' as const,
  dimension: 'evidence' as const,
};

const HIGH_ITEM = {
  concern: 'Bulk update is irreversible without a manual restore.',
  severity: 'high' as const,
  dimension: 'irreversibility' as const,
};

const VALID_PAYLOAD = {
  items: [HIGH_ITEM],
  overallRisk: 'high',
};

test('valid payload passes validation', () => {
  const r = validateChallengeAssumptionsOutput(VALID_PAYLOAD);
  expect(r.valid).toBe(true);
  expect(r.errors).toEqual([]);
});

test('rejects payload with more than 5 items', () => {
  const payload = {
    items: Array(6).fill(LOW_ITEM),
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('≤ 5'))).toBeTruthy();
});

test('rejects concern longer than 140 chars', () => {
  const payload = {
    items: [{ ...LOW_ITEM, concern: 'x'.repeat(141) }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('≤ 140'))).toBeTruthy();
});

test('rejects invalid severity', () => {
  const payload = {
    items: [{ ...LOW_ITEM, severity: 'critical' }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  expect(r.valid).toBe(false);
});

test('rejects invalid dimension', () => {
  const payload = {
    items: [{ ...LOW_ITEM, dimension: 'unknown_dim' }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  expect(r.valid).toBe(false);
});

test('rejects overallRisk mismatch — items say high but risk says low', () => {
  const payload = {
    items: [HIGH_ITEM],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  expect(r.valid).toBe(false);
  expect(r.errors.some((e) => e.includes('overallRisk mismatch'))).toBeTruthy();
});

test('rejects non-object payload', () => {
  const r = validateChallengeAssumptionsOutput('not an object');
  expect(r.valid).toBe(false);
});

test('parseChallengeAssumptionsOutput parses valid JSON', () => {
  const payload = parseChallengeAssumptionsOutput(JSON.stringify(VALID_PAYLOAD));
  expect(payload.items.length).toBe(1);
  expect(payload.overallRisk).toBe('high');
});

test('parseChallengeAssumptionsOutput throws on invalid JSON', () => {
  expect(() => parseChallengeAssumptionsOutput('not json')).toThrow();
});

test('computeOverallRisk returns high if any item is high', () => {
  const risk = computeOverallRisk([LOW_ITEM, HIGH_ITEM]);
  expect(risk).toBe('high');
});

test('computeOverallRisk returns medium if any item is medium but none high', () => {
  const medItem = { ...LOW_ITEM, severity: 'medium' as const };
  const risk = computeOverallRisk([LOW_ITEM, medItem]);
  expect(risk).toBe('medium');
});

test('computeOverallRisk returns low if all items are low', () => {
  const risk = computeOverallRisk([LOW_ITEM, LOW_ITEM]);
  expect(risk).toBe('low');
});

test('assembleChallengeAssumptionsPrompt includes briefText and confidence', () => {
  const prompt = assembleChallengeAssumptionsPrompt({
    briefText: 'Bulk update VIP contacts',
    actionSummary: 'Action: update_contacts. Affects 200 records.',
    runtimeConfidence: 0.75,
    stakesDimensions: ['irreversibility', 'cost'],
  });
  expect(prompt.includes('Bulk update VIP contacts')).toBeTruthy();
  expect(prompt.includes('75%')).toBeTruthy();
  expect(prompt.includes('irreversibility')).toBeTruthy();
  expect(prompt.includes('cost')).toBeTruthy();
});
