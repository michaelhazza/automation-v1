/**
 * Pure-function tests for challenge_assumptions output validation.
 * Run via: npx tsx server/tools/capabilities/__tests__/challengeAssumptionsHandlerPure.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('rejects payload with more than 5 items', () => {
  const payload = {
    items: Array(6).fill(LOW_ITEM),
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('≤ 5')));
});

test('rejects concern longer than 140 chars', () => {
  const payload = {
    items: [{ ...LOW_ITEM, concern: 'x'.repeat(141) }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('≤ 140')));
});

test('rejects invalid severity', () => {
  const payload = {
    items: [{ ...LOW_ITEM, severity: 'critical' }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  assert.equal(r.valid, false);
});

test('rejects invalid dimension', () => {
  const payload = {
    items: [{ ...LOW_ITEM, dimension: 'unknown_dim' }],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  assert.equal(r.valid, false);
});

test('rejects overallRisk mismatch — items say high but risk says low', () => {
  const payload = {
    items: [HIGH_ITEM],
    overallRisk: 'low',
  };
  const r = validateChallengeAssumptionsOutput(payload);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('overallRisk mismatch')));
});

test('rejects non-object payload', () => {
  const r = validateChallengeAssumptionsOutput('not an object');
  assert.equal(r.valid, false);
});

test('parseChallengeAssumptionsOutput parses valid JSON', () => {
  const payload = parseChallengeAssumptionsOutput(JSON.stringify(VALID_PAYLOAD));
  assert.equal(payload.items.length, 1);
  assert.equal(payload.overallRisk, 'high');
});

test('parseChallengeAssumptionsOutput throws on invalid JSON', () => {
  assert.throws(() => parseChallengeAssumptionsOutput('not json'));
});

test('computeOverallRisk returns high if any item is high', () => {
  const risk = computeOverallRisk([LOW_ITEM, HIGH_ITEM]);
  assert.equal(risk, 'high');
});

test('computeOverallRisk returns medium if any item is medium but none high', () => {
  const medItem = { ...LOW_ITEM, severity: 'medium' as const };
  const risk = computeOverallRisk([LOW_ITEM, medItem]);
  assert.equal(risk, 'medium');
});

test('computeOverallRisk returns low if all items are low', () => {
  const risk = computeOverallRisk([LOW_ITEM, LOW_ITEM]);
  assert.equal(risk, 'low');
});

test('assembleChallengeAssumptionsPrompt includes briefText and confidence', () => {
  const prompt = assembleChallengeAssumptionsPrompt({
    briefText: 'Bulk update VIP contacts',
    actionSummary: 'Action: update_contacts. Affects 200 records.',
    runtimeConfidence: 0.75,
    stakesDimensions: ['irreversibility', 'cost'],
  });
  assert.ok(prompt.includes('Bulk update VIP contacts'));
  assert.ok(prompt.includes('75%'));
  assert.ok(prompt.includes('irreversibility'));
  assert.ok(prompt.includes('cost'));
});
