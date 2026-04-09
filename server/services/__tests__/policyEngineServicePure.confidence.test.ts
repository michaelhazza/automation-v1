/**
 * policyEngineServicePure.confidence.test.ts — Sprint 3 P2.3 pure tests
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/policyEngineServicePure.confidence.test.ts
 *
 * Exercises the two pure helpers that drive the confidence gate and
 * decision-time guidance selection. No DB, no Drizzle, no fetch — the
 * helpers take plain data in and return plain data out.
 *
 * Pure-helper convention: imports from `../policyEngineServicePure.js`
 * (sibling of this __tests__ directory), so the
 * verify-pure-helper-convention gate is satisfied.
 */

import {
  applyConfidenceUpgrade,
  selectGuidanceTexts,
  type GuidanceRule,
} from '../policyEngineServicePure.js';

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

const DEFAULT = 0.7;

console.log('');
console.log('policyEngineServicePure — Sprint 3 P2.3 confidence + guidance');
console.log('');

// ── applyConfidenceUpgrade ─────────────────────────────────────────

test('auto with confidence above threshold stays auto', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.9 }, DEFAULT);
  assert(out.decision === 'auto', `expected auto, got ${out.decision}`);
  assert(!out.upgradedByConfidence, 'should not flag upgrade');
  assert(out.effectiveThreshold === DEFAULT, 'threshold mismatch');
});

test('auto at exactly threshold stays auto', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: DEFAULT }, DEFAULT);
  assert(out.decision === 'auto', 'equal to threshold must stay auto');
});

test('auto with confidence below threshold upgrades to review', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.6 }, DEFAULT);
  assert(out.decision === 'review', `expected review, got ${out.decision}`);
  assert(out.upgradedByConfidence === true, 'should flag upgrade');
});

test('auto with missing confidence upgrades (fail closed)', () => {
  const out = applyConfidenceUpgrade('auto', {}, DEFAULT);
  assert(out.decision === 'review', 'missing confidence must upgrade');
  assert(out.upgradedByConfidence === true, 'should flag upgrade');
});

test('auto with null confidence upgrades (fail closed)', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: null }, DEFAULT);
  assert(out.decision === 'review', 'null confidence must upgrade');
});

test('auto with NaN confidence upgrades (fail closed)', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: Number.NaN }, DEFAULT);
  assert(out.decision === 'review', 'NaN must be treated as missing');
});

test('auto with Infinity is not finite → upgrade', () => {
  const out = applyConfidenceUpgrade(
    'auto',
    { toolIntentConfidence: Number.POSITIVE_INFINITY },
    DEFAULT,
  );
  assert(out.decision === 'review', 'infinite confidence must upgrade');
});

test('review is never downgraded even with high confidence', () => {
  const out = applyConfidenceUpgrade('review', { toolIntentConfidence: 0.99 }, DEFAULT);
  assert(out.decision === 'review', 'review must be sticky');
  assert(out.upgradedByConfidence === false, 'review is not an upgrade');
});

test('block is never downgraded even with high confidence', () => {
  const out = applyConfidenceUpgrade('block', { toolIntentConfidence: 0.99 }, DEFAULT);
  assert(out.decision === 'block', 'block must be sticky');
});

test('rule override with stricter threshold upgrades borderline auto', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.8 }, DEFAULT, 0.9);
  assert(out.decision === 'review', 'stricter override must upgrade');
  assert(out.effectiveThreshold === 0.9, 'override threshold must be reported');
});

test('rule override with looser threshold lets low confidence stay auto', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.4 }, DEFAULT, 0.3);
  assert(out.decision === 'auto', 'looser override must keep auto');
  assert(out.effectiveThreshold === 0.3, 'override threshold must be reported');
});

test('rule override null falls back to default', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.6 }, DEFAULT, null);
  assert(out.decision === 'review', 'null override must fall back to default');
  assert(out.effectiveThreshold === DEFAULT, 'effective threshold = default');
});

test('rule override undefined falls back to default', () => {
  const out = applyConfidenceUpgrade('auto', { toolIntentConfidence: 0.6 }, DEFAULT, undefined);
  assert(out.decision === 'review', 'undefined override must fall back');
  assert(out.effectiveThreshold === DEFAULT, 'effective threshold = default');
});

// ── selectGuidanceTexts ────────────────────────────────────────────

interface TestRule extends GuidanceRule {
  id: string;
  matches: boolean;
}

const alwaysTrue = <TCtx>(_rule: TestRule, _ctx: TCtx) => true;
const matchFlag = (rule: TestRule, _ctx: unknown) => rule.matches;

test('empty rule list returns empty array', () => {
  const out = selectGuidanceTexts<TestRule, unknown>([], {}, alwaysTrue);
  assert(Array.isArray(out) && out.length === 0, 'empty → empty');
});

test('rules without guidance text are skipped', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: null },
    { id: 'b', matches: true, guidanceText: undefined },
    { id: 'c', matches: true, guidanceText: '' },
    { id: 'd', matches: true, guidanceText: '   ' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 0, `expected 0 entries, got ${out.length}`);
});

test('matching rules with guidance are returned in order', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: 'first' },
    { id: 'b', matches: true, guidanceText: 'second' },
    { id: 'c', matches: true, guidanceText: 'third' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 3, `expected 3 entries, got ${out.length}`);
  assert(out[0] === 'first', 'order 0');
  assert(out[1] === 'second', 'order 1');
  assert(out[2] === 'third', 'order 2');
});

test('non-matching rules are filtered out', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: 'kept' },
    { id: 'b', matches: false, guidanceText: 'dropped' },
    { id: 'c', matches: true, guidanceText: 'kept2' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 2, `expected 2, got ${out.length}`);
  assert(out[0] === 'kept', 'first kept');
  assert(out[1] === 'kept2', 'second kept');
});

test('duplicate guidance text is de-duplicated', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: 'same' },
    { id: 'b', matches: true, guidanceText: 'same' },
    { id: 'c', matches: true, guidanceText: 'different' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 2, `expected 2, got ${out.length}`);
  assert(out[0] === 'same', 'first');
  assert(out[1] === 'different', 'second');
});

test('whitespace is trimmed before comparison and output', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: '  hello  ' },
    { id: 'b', matches: true, guidanceText: 'hello' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 1, `expected 1, got ${out.length}`);
  assert(out[0] === 'hello', `expected trimmed, got ${JSON.stringify(out[0])}`);
});

test('matcher is passed the rule and the caller-supplied ctx', () => {
  const rules: TestRule[] = [
    { id: 'a', matches: true, guidanceText: 'one' },
    { id: 'b', matches: true, guidanceText: 'two' },
  ];
  const seen: Array<{ id: string; ctx: unknown }> = [];
  const matcher = (rule: TestRule, ctx: unknown) => {
    seen.push({ id: rule.id, ctx });
    return true;
  };
  const ctx = { foo: 'bar' };
  selectGuidanceTexts(rules, ctx, matcher);
  assert(seen.length === 2, `expected 2 matcher calls, got ${seen.length}`);
  assert(seen[0].id === 'a' && seen[0].ctx === ctx, 'first call args');
  assert(seen[1].id === 'b' && seen[1].ctx === ctx, 'second call args');
});

test('mixed scenario: priority order preserved with filtering and dedup', () => {
  const rules: TestRule[] = [
    { id: '1', matches: true, guidanceText: 'A' },
    { id: '2', matches: false, guidanceText: 'dropped' },
    { id: '3', matches: true, guidanceText: null },
    { id: '4', matches: true, guidanceText: 'B' },
    { id: '5', matches: true, guidanceText: 'A' }, // duplicate of 1
    { id: '6', matches: true, guidanceText: 'C' },
  ];
  const out = selectGuidanceTexts(rules, {}, matchFlag);
  assert(out.length === 3, `expected 3, got ${out.length}`);
  assert(out[0] === 'A', 'order 0');
  assert(out[1] === 'B', 'order 1');
  assert(out[2] === 'C', 'order 2');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
