/**
 * Tests for workflowConfidenceServicePure — pure heuristic computation.
 * Run: npx tsx server/services/__tests__/workflowConfidenceServicePure.test.ts
 */

import { computeConfidence, type ConfidenceInputs } from '../workflowConfidenceServicePure.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function base(): ConfidenceInputs {
  return {
    templateVersionId: 'tv-1',
    stepId: 'step-1',
    isCritical: false,
    sideEffectClass: null,
    pastReviewsCount: { approved: 0, rejected: 0 },
    subaccountFirstUseFlag: false,
    upstreamConfidence: null,
  };
}

// --- mapping rows ---

{
  const r = computeConfidence({ ...base(), upstreamConfidence: 'low' });
  assert('upstream_low fires: value=low', r.value === 'low');
  assert('upstream_low fires: signal name', r.signals[0].name === 'upstream_low_confidence');
}

{
  const r = computeConfidence({ ...base(), subaccountFirstUseFlag: true });
  assert('first_use fires: value=low', r.value === 'low');
  assert('first_use fires: signal name', r.signals[0].name === 'first_use_in_subaccount');
}

{
  const r = computeConfidence({ ...base(), isCritical: true });
  assert('next_step_critical fires: value=medium', r.value === 'medium');
  assert('next_step_critical fires: signal name', r.signals[0].name === 'next_step_critical');
}

{
  const r = computeConfidence({ ...base(), sideEffectClass: 'irreversible' });
  assert('irreversible fires: value=medium', r.value === 'medium');
  assert('irreversible fires: signal name', r.signals[0].name === 'irreversible_side_effect');
}

{
  const r = computeConfidence({ ...base(), pastReviewsCount: { approved: 9, rejected: 1 } });
  assert('many_runs fires at 10 total, 90% approval: value=high', r.value === 'high');
  assert('many_runs fires: signal name', r.signals[0].name === 'many_past_runs_no_clamps');
}

{
  const r = computeConfidence({ ...base(), pastReviewsCount: { approved: 4, rejected: 1 } });
  assert('many_runs fires at exactly 5 total, 80% approval: value=high', r.value === 'high');
  assert('many_runs fires at boundary: signal name', r.signals[0].name === 'many_past_runs_no_clamps');
}

{
  const r = computeConfidence(base());
  assert('few_past_runs default: value=medium', r.value === 'medium');
  assert('few_past_runs default: signal name', r.signals[0].name === 'few_past_runs_mixed');
}

{
  const r = computeConfidence({ ...base(), pastReviewsCount: { approved: 4, rejected: 0 } });
  assert('few_past_runs when < 5 total: value=medium', r.value === 'medium');
  assert('few_past_runs when < 5 total: signal', r.signals[0].name === 'few_past_runs_mixed');
}

{
  const r = computeConfidence({ ...base(), pastReviewsCount: { approved: 3, rejected: 2 } });
  assert('few_past_runs when ratio < 0.8: value=medium', r.value === 'medium');
}

// --- priority order ---

{
  const r = computeConfidence({ ...base(), upstreamConfidence: 'low', isCritical: true });
  assert('upstream_low overrides next_step_critical', r.signals[0].name === 'upstream_low_confidence');
}

{
  const r = computeConfidence({ ...base(), upstreamConfidence: 'low', subaccountFirstUseFlag: true });
  assert('upstream_low overrides first_use', r.signals[0].name === 'upstream_low_confidence');
}

{
  const r = computeConfidence({ ...base(), subaccountFirstUseFlag: true, isCritical: true });
  assert('first_use overrides isCritical', r.signals[0].name === 'first_use_in_subaccount');
}

{
  const r = computeConfidence({ ...base(), isCritical: true, sideEffectClass: 'irreversible' });
  assert('isCritical overrides irreversible', r.signals[0].name === 'next_step_critical');
}

// --- failsafe: high confidence does NOT return approved boolean ---

{
  const r = computeConfidence({ ...base(), pastReviewsCount: { approved: 9, rejected: 1 } });
  assert('high confidence: no auto-approval flag', (r as Record<string, unknown>)['approved'] === undefined);
  assert('high confidence: exactly 4 keys', Object.keys(r).length === 4);
  assert('high confidence: has value key', 'value' in r);
  assert('high confidence: has reason key', 'reason' in r);
  assert('high confidence: has computed_at key', 'computed_at' in r);
  assert('high confidence: has signals key', 'signals' in r);
}

// --- output shape ---

{
  const r = computeConfidence(base());
  assert('computed_at is ISO string', /^\d{4}-\d{2}-\d{2}T/.test(r.computed_at));
  assert('signals has 1 entry', r.signals.length === 1);
  assert('signal has name string', typeof r.signals[0].name === 'string');
  assert('signal has weight=1', r.signals[0].weight === 1);
  assert('reason is non-empty string', typeof r.reason === 'string' && r.reason.length > 0);
}

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
