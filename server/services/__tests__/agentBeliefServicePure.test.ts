/**
 * agentBeliefServicePure.test.ts — Pure function tests for the Agent Belief system.
 *
 * Covers: key normalization, value normalization, merge logic (effective action
 * determination), confidence computation, prompt formatting, budget selection,
 * LLM output parsing, and alias validation.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentBeliefServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  normalizeKey,
  normalizeValueForComparison,
  estimateTokens,
  parseExtractionItem,
  parseExtractionResponse,
  determineEffectiveAction,
  computeUpdateConfidence,
  computeReinforceConfidence,
  formatSingleBelief,
  formatBeliefsForPrompt,
  selectBeliefsWithinBudget,
  validateKeyAliases,
  KEY_ALIASES,
  type BeliefRecord,
  type ExtractionItem,
  type MergeConfig,
} from '../agentBeliefServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBelief(overrides: Partial<BeliefRecord> = {}): BeliefRecord {
  return {
    id: 'b-1',
    beliefKey: 'client_platform',
    category: 'general',
    subject: null,
    value: 'Uses WooCommerce',
    confidence: 0.7,
    evidenceCount: 1,
    source: 'agent',
    sourceRunId: 'run-old',
    updatedAt: new Date('2026-04-10'),
    ...overrides,
  };
}

function makeItem(overrides: Partial<ExtractionItem> = {}): ExtractionItem {
  return {
    key: 'client_platform',
    value: 'Uses WooCommerce',
    confidence: 0.7,
    action: 'add',
    ...overrides,
  };
}

const DEFAULT_CONFIG: MergeConfig = {
  removeMinConfidence: 0.8,
  confidenceCeiling: 0.9,
  updateConfidenceCap: 0.7,
  confidenceBoost: 0.05,
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Key Normalization');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('normalizeKey — lowercase and trim', () => {
  const r = normalizeKey('  Client_Platform  ');
  expect(r.key, 'key').toBe('client_platform');
  expect(!r.aliased, 'not aliased').toBeTruthy();
});

test('normalizeKey — spaces become underscores', () => {
  const r = normalizeKey('client platform');
  expect(r.key, 'key').toBe('client_platform');
});

test('normalizeKey — strips non-alphanumeric', () => {
  const r = normalizeKey('client-platform!');
  expect(r.key, 'key').toBe('clientplatform');
});

test('normalizeKey — resolves alias: ecommerce_platform → client_platform', () => {
  const r = normalizeKey('ecommerce_platform');
  expect(r.key, 'canonical key').toBe('client_platform');
  expect(r.aliased, 'flagged as aliased').toBeTruthy();
  expect(r.originalKey, 'original').toBe('ecommerce_platform');
});

test('normalizeKey — resolves alias: cms → client_platform', () => {
  const r = normalizeKey('CMS');
  expect(r.key, 'canonical key').toBe('client_platform');
  expect(r.aliased, 'flagged as aliased').toBeTruthy();
});

test('normalizeKey — resolves alias: report_frequency → reporting_cadence', () => {
  const r = normalizeKey('report_frequency');
  expect(r.key, 'canonical key').toBe('reporting_cadence');
  expect(r.aliased, 'flagged as aliased').toBeTruthy();
});

test('normalizeKey — non-aliased key passes through', () => {
  const r = normalizeKey('custom_metric_xyz');
  expect(r.key, 'key unchanged').toBe('custom_metric_xyz');
  expect(!r.aliased, 'not aliased').toBeTruthy();
});

test('normalizeKey — custom alias map', () => {
  const r = normalizeKey('foo', { foo: 'bar' });
  expect(r.key, 'resolved').toBe('bar');
  expect(r.aliased, 'aliased').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Alias Validation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('validateKeyAliases — valid map returns null', () => {
  expect(validateKeyAliases(KEY_ALIASES), 'no error').toBe(null);
});

test('validateKeyAliases — detects chaining', () => {
  const bad = { a: 'b', b: 'c' };
  const err = validateKeyAliases(bad);
  expect(err !== null, 'should return error').toBeTruthy();
  expect(err!.includes('Chaining'), 'mentions Chaining').toBeTruthy();
});

test('validateKeyAliases — empty map is valid', () => {
  expect(validateKeyAliases({}), 'no error').toBe(null);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Value Normalization');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('normalizeValueForComparison — identical strings match', () => {
  expect(normalizeValueForComparison('Uses WooCommerce'), 'match').toEqual(normalizeValueForComparison('Uses WooCommerce'));
});

test('normalizeValueForComparison — case insensitive', () => {
  expect(normalizeValueForComparison('uses woocommerce'), 'case match').toEqual(normalizeValueForComparison('Uses WooCommerce'));
});

test('normalizeValueForComparison — strips punctuation', () => {
  expect(normalizeValueForComparison('Uses WooCommerce.'), 'punctuation match').toEqual(normalizeValueForComparison('Uses WooCommerce'));
});

test('normalizeValueForComparison — strips bracketed text', () => {
  expect(normalizeValueForComparison('WooCommerce (WordPress)'), 'brackets stripped').toEqual(normalizeValueForComparison('WooCommerce'));
});

test('normalizeValueForComparison — collapses whitespace', () => {
  expect(normalizeValueForComparison('Uses   WooCommerce'), 'whitespace collapsed').toEqual(normalizeValueForComparison('Uses WooCommerce'));
});

test('normalizeValueForComparison — "Client uses WooCommerce" matches "Client is using WooCommerce"', () => {
  // These differ by "uses" vs "is using" — they do NOT match after normalization
  // This is the expected boundary: purely lexical, not semantic
  const a = normalizeValueForComparison('Client uses WooCommerce');
  const b = normalizeValueForComparison('Client is using WooCommerce');
  expect(a !== b, 'different phrasing does not match (lexical only)').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Effective Action Determination');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('add — no existing belief → add', () => {
  const action = determineEffectiveAction(makeItem(), undefined, 'run-1', DEFAULT_CONFIG);
  expect(action, 'effective action').toBe('add');
});

test('reinforce — existing belief with same value → reinforce', () => {
  const existing = makeBelief({ value: 'Uses WooCommerce' });
  const item = makeItem({ action: 'reinforce', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'effective action').toBe('reinforce');
});

test('reinforce — LLM says add but key exists with same value → reinforce', () => {
  const existing = makeBelief({ value: 'Uses WooCommerce' });
  const item = makeItem({ action: 'add', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'coerced to reinforce').toBe('reinforce');
});

test('update — existing belief with different value → update', () => {
  const existing = makeBelief({ value: 'Uses Shopify' });
  const item = makeItem({ action: 'update', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'effective action').toBe('update');
});

test('update — LLM says add but key exists with different value → update', () => {
  const existing = makeBelief({ value: 'Uses Shopify' });
  const item = makeItem({ action: 'add', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'coerced to update').toBe('update');
});

test('idempotency — same run already applied → skip', () => {
  const existing = makeBelief({ sourceRunId: 'run-1' });
  const item = makeItem();
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'idempotency guard fires').toBe('skip');
});

test('user override guard — existing is user_override → skip', () => {
  const existing = makeBelief({ source: 'user_override', confidence: 1.0 });
  const item = makeItem({ action: 'update', value: 'Different value' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'user override protected').toBe('skip');
});

test('user override guard — remove action also skipped for user_override', () => {
  const existing = makeBelief({ source: 'user_override', confidence: 1.0 });
  const item = makeItem({ action: 'remove', confidence: 0.95 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'user override not removable by agent').toBe('skip');
});

test('remove — high confidence, exceeds existing → remove', () => {
  const existing = makeBelief({ confidence: 0.7 });
  const item = makeItem({ action: 'remove', confidence: 0.9 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'effective action').toBe('remove');
});

test('remove — below removeMinConfidence → skip', () => {
  const existing = makeBelief({ confidence: 0.5 });
  const item = makeItem({ action: 'remove', confidence: 0.6 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'below threshold').toBe('skip');
});

test('remove — below existing confidence → skip', () => {
  const existing = makeBelief({ confidence: 0.95 });
  const item = makeItem({ action: 'remove', confidence: 0.85 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'below existing confidence').toBe('skip');
});

test('remove — no existing belief → skip', () => {
  const item = makeItem({ action: 'remove', confidence: 0.9 });
  const action = determineEffectiveAction(item, undefined, 'run-1', DEFAULT_CONFIG);
  expect(action, 'nothing to remove').toBe('skip');
});

test('value normalization prevents false update — "WooCommerce (WordPress)" vs "WooCommerce"', () => {
  const existing = makeBelief({ value: 'WooCommerce (WordPress)' });
  const item = makeItem({ action: 'update', value: 'WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  expect(action, 'normalized values match → reinforce not update').toBe('reinforce');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Confidence Computation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('computeUpdateConfidence — caps at the minimum of existing, new, and cap', () => {
  expect(computeUpdateConfidence(0.8, 0.9, 0.7)).toBeCloseTo(0.7, 4);
  expect(computeUpdateConfidence(0.5, 0.9, 0.7)).toBeCloseTo(0.5, 4);
  expect(computeUpdateConfidence(0.8, 0.3, 0.7)).toBeCloseTo(0.3, 4);
});

test('computeReinforceConfidence — boosts by increment, caps at ceiling', () => {
  expect(computeReinforceConfidence(0.7, 0.05, 0.9)).toBeCloseTo(0.75, 4);
  expect(computeReinforceConfidence(0.88, 0.05, 0.9)).toBeCloseTo(0.9, 4);
  expect(computeReinforceConfidence(0.9, 0.05, 0.9)).toBeCloseTo(0.9, 4);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Prompt Formatting');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('formatSingleBelief — renders confidence and value', () => {
  const b = makeBelief({ confidence: 0.85, value: 'Client prefers weekly reports' });
  expect(formatSingleBelief(b), 'format').toBe('- [0.85] Client prefers weekly reports');
});

test('formatBeliefsForPrompt — empty returns empty string', () => {
  expect(formatBeliefsForPrompt([]), 'empty').toBe('');
});

test('formatBeliefsForPrompt — groups by category', () => {
  const beliefs = [
    makeBelief({ category: 'preference', value: 'Prefers weekly reports', confidence: 0.9 }),
    makeBelief({ category: 'metric', value: 'MRR is $12,400', confidence: 0.75, id: 'b-2', beliefKey: 'mrr' }),
    makeBelief({ category: 'preference', value: 'Concise style', confidence: 0.8, id: 'b-3', beliefKey: 'style' }),
  ];
  const result = formatBeliefsForPrompt(beliefs);
  expect(result.includes('**Preference:**'), 'has Preference header').toBeTruthy();
  expect(result.includes('**Metric:**'), 'has Metric header').toBeTruthy();
  expect(result.includes('[0.90]'), 'has confidence').toBeTruthy();
  expect(result.includes('Prefers weekly reports'), 'has value').toBeTruthy();
});

test('formatBeliefsForPrompt — includes preamble text', () => {
  const beliefs = [makeBelief()];
  const result = formatBeliefsForPrompt(beliefs);
  expect(result.includes('facts you have formed from previous runs'), 'preamble present').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Budget Selection');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('selectBeliefsWithinBudget — returns all beliefs when within budget', () => {
  const beliefs = [
    makeBelief({ confidence: 0.9 }),
    makeBelief({ confidence: 0.7, id: 'b-2', beliefKey: 'other' }),
  ];
  const result = selectBeliefsWithinBudget(beliefs, 1500);
  expect(result.length, 'all included').toBe(2);
});

test('selectBeliefsWithinBudget — drops lowest confidence first', () => {
  // Create beliefs that exceed a tiny budget
  const beliefs = [
    makeBelief({ confidence: 0.5, value: 'Low confidence belief', id: 'b-lo', beliefKey: 'lo' }),
    makeBelief({ confidence: 0.9, value: 'High confidence belief', id: 'b-hi', beliefKey: 'hi' }),
    makeBelief({ confidence: 0.7, value: 'Medium confidence belief', id: 'b-mid', beliefKey: 'mid' }),
  ];
  // Budget that fits ~2 beliefs (each is ~5 tokens)
  const result = selectBeliefsWithinBudget(beliefs, 12);
  expect(result.length <= 2, `fits within budget (got ${result.length})`).toBeTruthy();
  // Highest confidence should survive
  expect(result.some(b => b.confidence === 0.9), 'high confidence included').toBeTruthy();
});

test('selectBeliefsWithinBudget — empty input returns empty', () => {
  expect(selectBeliefsWithinBudget([], 1500).length, 'empty').toBe(0);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Extraction Parsing');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('parseExtractionResponse — valid JSON array', () => {
  const result = parseExtractionResponse('[{"key":"a","value":"b"}]');
  expect(result !== null, 'parsed').toBeTruthy();
  expect(result!.length, 'one item').toBe(1);
});

test('parseExtractionResponse — markdown fenced JSON', () => {
  const result = parseExtractionResponse('```json\n[{"key":"a","value":"b"}]\n```');
  expect(result !== null, 'parsed').toBeTruthy();
  expect(result!.length, 'one item').toBe(1);
});

test('parseExtractionResponse — invalid JSON returns null', () => {
  expect(parseExtractionResponse('not json'), 'null on invalid').toBe(null);
});

test('parseExtractionResponse — empty string returns null', () => {
  expect(parseExtractionResponse(''), 'null on empty').toBe(null);
});

test('parseExtractionResponse — non-array JSON returns null', () => {
  expect(parseExtractionResponse('{"key":"a"}'), 'null on object').toBe(null);
});

test('parseExtractionItem — valid item', () => {
  const item = parseExtractionItem({ key: 'test', value: 'hello', confidence: 0.8, action: 'add' }, 500);
  expect(item !== null, 'parsed').toBeTruthy();
  expect(item!.key, 'key').toBe('test');
  expect(item!.value, 'value').toBe('hello');
  expect(item!.confidence!).toBeCloseTo(0.8, 4);
  expect(item!.action, 'action').toBe('add');
});

test('parseExtractionItem — missing key returns null', () => {
  expect(parseExtractionItem({ value: 'hello' }, 500), 'null').toBe(null);
});

test('parseExtractionItem — missing value returns null', () => {
  expect(parseExtractionItem({ key: 'test' }, 500), 'null').toBe(null);
});

test('parseExtractionItem — defaults for optional fields', () => {
  const item = parseExtractionItem({ key: 'test', value: 'hello' }, 500);
  expect(item !== null, 'parsed').toBeTruthy();
  expect(item!.category, 'default category').toBe('general');
  expect(item!.confidence!).toBeCloseTo(0.7, 4);
  expect(item!.action, 'default action').toBe('add');
  expect(item!.subject, 'default subject').toBe(null);
});

test('parseExtractionItem — truncates value to maxLength', () => {
  const longValue = 'x'.repeat(600);
  const item = parseExtractionItem({ key: 'test', value: longValue }, 500);
  expect(item!.value.length, 'truncated').toBe(500);
});

test('parseExtractionItem — clamps confidence to [0, 1]', () => {
  const over = parseExtractionItem({ key: 'a', value: 'b', confidence: 1.5 }, 500);
  expect(over!.confidence!).toBeCloseTo(1.0, 4);
  const under = parseExtractionItem({ key: 'a', value: 'b', confidence: -0.5 }, 500);
  expect(under!.confidence!).toBeCloseTo(0.0, 4);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Token Estimation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('estimateTokens — rough word-based estimate', () => {
  // "hello world test" = 3 words → ceil(3/0.75) = 4
  expect(estimateTokens('hello world test'), 'three words').toBe(4);
});

test('estimateTokens — single word', () => {
  expect(estimateTokens('hello'), 'single word → ceil(1/0.75)').toBe(2);
});

test('estimateTokens — empty string', () => {
  // empty split → [''] → 1 word → ceil(1/0.75) = 2
  expect(estimateTokens(''), 'empty').toBe(2);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — End-to-End Merge Scenarios');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('scenario: first run on fresh workspace → all adds', () => {
  const items = [
    makeItem({ key: 'platform', value: 'WooCommerce', action: 'add' }),
    makeItem({ key: 'cadence', value: 'Weekly reports', action: 'add' }),
  ];
  const actions = items.map(i => determineEffectiveAction(i, undefined, 'run-1', DEFAULT_CONFIG));
  expect(actions, 'all adds').toEqual(['add', 'add']);
});

test('scenario: second run, same beliefs → all reinforces', () => {
  const existing = makeBelief({ value: 'WooCommerce', beliefKey: 'platform', sourceRunId: 'run-1' });
  const item = makeItem({ key: 'platform', value: 'WooCommerce', action: 'reinforce' });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  expect(action, 'reinforced').toBe('reinforce');
});

test('scenario: platform change → update with confidence cap', () => {
  const existing = makeBelief({ value: 'Shopify', confidence: 0.85, sourceRunId: 'run-1' });
  const item = makeItem({ key: 'client_platform', value: 'WooCommerce', confidence: 0.9, action: 'update' });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  expect(action, 'update action').toBe('update');
  // Confidence should be min(0.85, 0.9, 0.7) = 0.7
  expect(computeUpdateConfidence(0.85, 0.9, 0.7)).toBeCloseTo(0.7, 4);
});

test('scenario: replay of same run (idempotency) → all skips', () => {
  const existing = makeBelief({ sourceRunId: 'run-1' });
  const items = [
    makeItem({ action: 'add' }),
    makeItem({ action: 'update', value: 'Different' }),
    makeItem({ action: 'reinforce' }),
    makeItem({ action: 'remove', confidence: 0.9 }),
  ];
  const actions = items.map(i => determineEffectiveAction(i, existing, 'run-1', DEFAULT_CONFIG));
  expect(actions, 'all skipped on replay').toEqual(['skip', 'skip', 'skip', 'skip']);
});

test('scenario: agent tries to override user correction → skip', () => {
  const existing = makeBelief({ source: 'user_override', confidence: 1.0, value: 'Correct value' });
  const items = [
    makeItem({ action: 'add', value: 'Wrong value' }),
    makeItem({ action: 'update', value: 'Wrong value' }),
    makeItem({ action: 'reinforce' }),
    makeItem({ action: 'remove', confidence: 0.99 }),
  ];
  const actions = items.map(i => determineEffectiveAction(i, existing, 'run-2', DEFAULT_CONFIG));
  expect(actions, 'user override fully protected').toEqual(['skip', 'skip', 'skip', 'skip']);
});

test('scenario: noisy remove signal → skip (low confidence)', () => {
  const existing = makeBelief({ confidence: 0.85 });
  const item = makeItem({ action: 'remove', confidence: 0.6 });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  expect(action, 'noisy remove rejected').toBe('skip');
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
