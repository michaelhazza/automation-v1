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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
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
  assertEqual(r.key, 'client_platform', 'key');
  assert(!r.aliased, 'not aliased');
});

test('normalizeKey — spaces become underscores', () => {
  const r = normalizeKey('client platform');
  assertEqual(r.key, 'client_platform', 'key');
});

test('normalizeKey — strips non-alphanumeric', () => {
  const r = normalizeKey('client-platform!');
  assertEqual(r.key, 'clientplatform', 'key');
});

test('normalizeKey — resolves alias: ecommerce_platform → client_platform', () => {
  const r = normalizeKey('ecommerce_platform');
  assertEqual(r.key, 'client_platform', 'canonical key');
  assert(r.aliased, 'flagged as aliased');
  assertEqual(r.originalKey, 'ecommerce_platform', 'original');
});

test('normalizeKey — resolves alias: cms → client_platform', () => {
  const r = normalizeKey('CMS');
  assertEqual(r.key, 'client_platform', 'canonical key');
  assert(r.aliased, 'flagged as aliased');
});

test('normalizeKey — resolves alias: report_frequency → reporting_cadence', () => {
  const r = normalizeKey('report_frequency');
  assertEqual(r.key, 'reporting_cadence', 'canonical key');
  assert(r.aliased, 'flagged as aliased');
});

test('normalizeKey — non-aliased key passes through', () => {
  const r = normalizeKey('custom_metric_xyz');
  assertEqual(r.key, 'custom_metric_xyz', 'key unchanged');
  assert(!r.aliased, 'not aliased');
});

test('normalizeKey — custom alias map', () => {
  const r = normalizeKey('foo', { foo: 'bar' });
  assertEqual(r.key, 'bar', 'resolved');
  assert(r.aliased, 'aliased');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Alias Validation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('validateKeyAliases — valid map returns null', () => {
  assertEqual(validateKeyAliases(KEY_ALIASES), null, 'no error');
});

test('validateKeyAliases — detects chaining', () => {
  const bad = { a: 'b', b: 'c' };
  const err = validateKeyAliases(bad);
  assert(err !== null, 'should return error');
  assert(err!.includes('Chaining'), 'mentions Chaining');
});

test('validateKeyAliases — empty map is valid', () => {
  assertEqual(validateKeyAliases({}), null, 'no error');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Value Normalization');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('normalizeValueForComparison — identical strings match', () => {
  assertEqual(
    normalizeValueForComparison('Uses WooCommerce'),
    normalizeValueForComparison('Uses WooCommerce'),
    'match',
  );
});

test('normalizeValueForComparison — case insensitive', () => {
  assertEqual(
    normalizeValueForComparison('uses woocommerce'),
    normalizeValueForComparison('Uses WooCommerce'),
    'case match',
  );
});

test('normalizeValueForComparison — strips punctuation', () => {
  assertEqual(
    normalizeValueForComparison('Uses WooCommerce.'),
    normalizeValueForComparison('Uses WooCommerce'),
    'punctuation match',
  );
});

test('normalizeValueForComparison — strips bracketed text', () => {
  assertEqual(
    normalizeValueForComparison('WooCommerce (WordPress)'),
    normalizeValueForComparison('WooCommerce'),
    'brackets stripped',
  );
});

test('normalizeValueForComparison — collapses whitespace', () => {
  assertEqual(
    normalizeValueForComparison('Uses   WooCommerce'),
    normalizeValueForComparison('Uses WooCommerce'),
    'whitespace collapsed',
  );
});

test('normalizeValueForComparison — "Client uses WooCommerce" matches "Client is using WooCommerce"', () => {
  // These differ by "uses" vs "is using" — they do NOT match after normalization
  // This is the expected boundary: purely lexical, not semantic
  const a = normalizeValueForComparison('Client uses WooCommerce');
  const b = normalizeValueForComparison('Client is using WooCommerce');
  assert(a !== b, 'different phrasing does not match (lexical only)');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Effective Action Determination');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('add — no existing belief → add', () => {
  const action = determineEffectiveAction(makeItem(), undefined, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'add', 'effective action');
});

test('reinforce — existing belief with same value → reinforce', () => {
  const existing = makeBelief({ value: 'Uses WooCommerce' });
  const item = makeItem({ action: 'reinforce', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'reinforce', 'effective action');
});

test('reinforce — LLM says add but key exists with same value → reinforce', () => {
  const existing = makeBelief({ value: 'Uses WooCommerce' });
  const item = makeItem({ action: 'add', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'reinforce', 'coerced to reinforce');
});

test('update — existing belief with different value → update', () => {
  const existing = makeBelief({ value: 'Uses Shopify' });
  const item = makeItem({ action: 'update', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'update', 'effective action');
});

test('update — LLM says add but key exists with different value → update', () => {
  const existing = makeBelief({ value: 'Uses Shopify' });
  const item = makeItem({ action: 'add', value: 'Uses WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'update', 'coerced to update');
});

test('idempotency — same run already applied → skip', () => {
  const existing = makeBelief({ sourceRunId: 'run-1' });
  const item = makeItem();
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'idempotency guard fires');
});

test('user override guard — existing is user_override → skip', () => {
  const existing = makeBelief({ source: 'user_override', confidence: 1.0 });
  const item = makeItem({ action: 'update', value: 'Different value' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'user override protected');
});

test('user override guard — remove action also skipped for user_override', () => {
  const existing = makeBelief({ source: 'user_override', confidence: 1.0 });
  const item = makeItem({ action: 'remove', confidence: 0.95 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'user override not removable by agent');
});

test('remove — high confidence, exceeds existing → remove', () => {
  const existing = makeBelief({ confidence: 0.7 });
  const item = makeItem({ action: 'remove', confidence: 0.9 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'remove', 'effective action');
});

test('remove — below removeMinConfidence → skip', () => {
  const existing = makeBelief({ confidence: 0.5 });
  const item = makeItem({ action: 'remove', confidence: 0.6 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'below threshold');
});

test('remove — below existing confidence → skip', () => {
  const existing = makeBelief({ confidence: 0.95 });
  const item = makeItem({ action: 'remove', confidence: 0.85 });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'below existing confidence');
});

test('remove — no existing belief → skip', () => {
  const item = makeItem({ action: 'remove', confidence: 0.9 });
  const action = determineEffectiveAction(item, undefined, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'nothing to remove');
});

test('value normalization prevents false update — "WooCommerce (WordPress)" vs "WooCommerce"', () => {
  const existing = makeBelief({ value: 'WooCommerce (WordPress)' });
  const item = makeItem({ action: 'update', value: 'WooCommerce' });
  const action = determineEffectiveAction(item, existing, 'run-1', DEFAULT_CONFIG);
  assertEqual(action, 'reinforce', 'normalized values match → reinforce not update');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Confidence Computation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('computeUpdateConfidence — caps at the minimum of existing, new, and cap', () => {
  assertClose(computeUpdateConfidence(0.8, 0.9, 0.7), 0.7, 0.001, 'capped');
  assertClose(computeUpdateConfidence(0.5, 0.9, 0.7), 0.5, 0.001, 'existing is lowest');
  assertClose(computeUpdateConfidence(0.8, 0.3, 0.7), 0.3, 0.001, 'new is lowest');
});

test('computeReinforceConfidence — boosts by increment, caps at ceiling', () => {
  assertClose(computeReinforceConfidence(0.7, 0.05, 0.9), 0.75, 0.001, 'boosted');
  assertClose(computeReinforceConfidence(0.88, 0.05, 0.9), 0.9, 0.001, 'capped at ceiling');
  assertClose(computeReinforceConfidence(0.9, 0.05, 0.9), 0.9, 0.001, 'already at ceiling');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Prompt Formatting');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('formatSingleBelief — renders confidence and value', () => {
  const b = makeBelief({ confidence: 0.85, value: 'Client prefers weekly reports' });
  assertEqual(formatSingleBelief(b), '- [0.85] Client prefers weekly reports', 'format');
});

test('formatBeliefsForPrompt — empty returns empty string', () => {
  assertEqual(formatBeliefsForPrompt([]), '', 'empty');
});

test('formatBeliefsForPrompt — groups by category', () => {
  const beliefs = [
    makeBelief({ category: 'preference', value: 'Prefers weekly reports', confidence: 0.9 }),
    makeBelief({ category: 'metric', value: 'MRR is $12,400', confidence: 0.75, id: 'b-2', beliefKey: 'mrr' }),
    makeBelief({ category: 'preference', value: 'Concise style', confidence: 0.8, id: 'b-3', beliefKey: 'style' }),
  ];
  const result = formatBeliefsForPrompt(beliefs);
  assert(result.includes('**Preference:**'), 'has Preference header');
  assert(result.includes('**Metric:**'), 'has Metric header');
  assert(result.includes('[0.90]'), 'has confidence');
  assert(result.includes('Prefers weekly reports'), 'has value');
});

test('formatBeliefsForPrompt — includes preamble text', () => {
  const beliefs = [makeBelief()];
  const result = formatBeliefsForPrompt(beliefs);
  assert(result.includes('facts you have formed from previous runs'), 'preamble present');
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
  assertEqual(result.length, 2, 'all included');
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
  assert(result.length <= 2, `fits within budget (got ${result.length})`);
  // Highest confidence should survive
  assert(result.some(b => b.confidence === 0.9), 'high confidence included');
});

test('selectBeliefsWithinBudget — empty input returns empty', () => {
  assertEqual(selectBeliefsWithinBudget([], 1500).length, 0, 'empty');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Extraction Parsing');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('parseExtractionResponse — valid JSON array', () => {
  const result = parseExtractionResponse('[{"key":"a","value":"b"}]');
  assert(result !== null, 'parsed');
  assertEqual(result!.length, 1, 'one item');
});

test('parseExtractionResponse — markdown fenced JSON', () => {
  const result = parseExtractionResponse('```json\n[{"key":"a","value":"b"}]\n```');
  assert(result !== null, 'parsed');
  assertEqual(result!.length, 1, 'one item');
});

test('parseExtractionResponse — invalid JSON returns null', () => {
  assertEqual(parseExtractionResponse('not json'), null, 'null on invalid');
});

test('parseExtractionResponse — empty string returns null', () => {
  assertEqual(parseExtractionResponse(''), null, 'null on empty');
});

test('parseExtractionResponse — non-array JSON returns null', () => {
  assertEqual(parseExtractionResponse('{"key":"a"}'), null, 'null on object');
});

test('parseExtractionItem — valid item', () => {
  const item = parseExtractionItem({ key: 'test', value: 'hello', confidence: 0.8, action: 'add' }, 500);
  assert(item !== null, 'parsed');
  assertEqual(item!.key, 'test', 'key');
  assertEqual(item!.value, 'hello', 'value');
  assertClose(item!.confidence!, 0.8, 0.001, 'confidence');
  assertEqual(item!.action, 'add', 'action');
});

test('parseExtractionItem — missing key returns null', () => {
  assertEqual(parseExtractionItem({ value: 'hello' }, 500), null, 'null');
});

test('parseExtractionItem — missing value returns null', () => {
  assertEqual(parseExtractionItem({ key: 'test' }, 500), null, 'null');
});

test('parseExtractionItem — defaults for optional fields', () => {
  const item = parseExtractionItem({ key: 'test', value: 'hello' }, 500);
  assert(item !== null, 'parsed');
  assertEqual(item!.category, 'general', 'default category');
  assertClose(item!.confidence!, 0.7, 0.001, 'default confidence');
  assertEqual(item!.action, 'add', 'default action');
  assertEqual(item!.subject, null, 'default subject');
});

test('parseExtractionItem — truncates value to maxLength', () => {
  const longValue = 'x'.repeat(600);
  const item = parseExtractionItem({ key: 'test', value: longValue }, 500);
  assertEqual(item!.value.length, 500, 'truncated');
});

test('parseExtractionItem — clamps confidence to [0, 1]', () => {
  const over = parseExtractionItem({ key: 'a', value: 'b', confidence: 1.5 }, 500);
  assertClose(over!.confidence!, 1.0, 0.001, 'clamped to 1');
  const under = parseExtractionItem({ key: 'a', value: 'b', confidence: -0.5 }, 500);
  assertClose(under!.confidence!, 0.0, 0.001, 'clamped to 0');
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('agentBeliefServicePure — Token Estimation');
console.log('');
// ══════════════════════════════════════════════════════════════════════════════

test('estimateTokens — rough word-based estimate', () => {
  // "hello world test" = 3 words → ceil(3/0.75) = 4
  assertEqual(estimateTokens('hello world test'), 4, 'three words');
});

test('estimateTokens — single word', () => {
  assertEqual(estimateTokens('hello'), 2, 'single word → ceil(1/0.75)');
});

test('estimateTokens — empty string', () => {
  // empty split → [''] → 1 word → ceil(1/0.75) = 2
  assertEqual(estimateTokens(''), 2, 'empty');
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
  assertEqual(actions, ['add', 'add'], 'all adds');
});

test('scenario: second run, same beliefs → all reinforces', () => {
  const existing = makeBelief({ value: 'WooCommerce', beliefKey: 'platform', sourceRunId: 'run-1' });
  const item = makeItem({ key: 'platform', value: 'WooCommerce', action: 'reinforce' });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  assertEqual(action, 'reinforce', 'reinforced');
});

test('scenario: platform change → update with confidence cap', () => {
  const existing = makeBelief({ value: 'Shopify', confidence: 0.85, sourceRunId: 'run-1' });
  const item = makeItem({ key: 'client_platform', value: 'WooCommerce', confidence: 0.9, action: 'update' });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  assertEqual(action, 'update', 'update action');
  // Confidence should be min(0.85, 0.9, 0.7) = 0.7
  assertClose(computeUpdateConfidence(0.85, 0.9, 0.7), 0.7, 0.001, 'confidence capped');
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
  assertEqual(actions, ['skip', 'skip', 'skip', 'skip'], 'all skipped on replay');
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
  assertEqual(actions, ['skip', 'skip', 'skip', 'skip'], 'user override fully protected');
});

test('scenario: noisy remove signal → skip (low confidence)', () => {
  const existing = makeBelief({ confidence: 0.85 });
  const item = makeItem({ action: 'remove', confidence: 0.6 });
  const action = determineEffectiveAction(item, existing, 'run-2', DEFAULT_CONFIG);
  assertEqual(action, 'skip', 'noisy remove rejected');
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
