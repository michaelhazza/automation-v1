/**
 * subaccountOnboardingServicePure.test.ts — markReady guard truth table
 *
 * Spec: docs/memory-and-briefings-spec.md §8.2 (S5)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/subaccountOnboardingServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  canMarkReady,
  nextStep,
  recordStepAnswer,
  computeSmartSkips,
  emptyOnboardingState,
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from '../subaccountOnboardingServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('subaccountOnboardingServicePure — markReady + ordering (§8.2 S5)');
console.log('');

// ---------------------------------------------------------------------------
// canMarkReady truth table
// ---------------------------------------------------------------------------

console.log('canMarkReady:');

test('empty state → disallowed, all required missing', () => {
  const s = emptyOnboardingState();
  const r = canMarkReady(s);
  expect(r.allowed, 'empty state blocked').toBe(false);
  expect(r.missing.sort(), '3 required missing').toEqual(['identity', 'intelligence_briefing_config', 'weekly_digest_config'].sort());
});

test('only Step 1 completed → still blocked on 6 + 7', () => {
  const s = recordStepAnswer({
    state: emptyOnboardingState(),
    stepId: 'identity',
    answers: { name: 'Acme' },
  });
  const r = canMarkReady(s);
  expect(r.allowed, 'still blocked').toBe(false);
  expect(r.missing.sort(), '2 missing').toEqual(['intelligence_briefing_config', 'weekly_digest_config'].sort());
});

test('Steps 1 + 6 + 7 all completed → allowed', () => {
  let s = emptyOnboardingState();
  for (const stepId of ['identity', 'intelligence_briefing_config', 'weekly_digest_config'] as const) {
    s = recordStepAnswer({ state: s, stepId, answers: {} });
  }
  const r = canMarkReady(s);
  expect(r.allowed, 'minimum set satisfied').toBe(true);
  expect(r.missing.length, 'no missing').toBe(0);
});

test('all 9 steps completed → allowed', () => {
  let s = emptyOnboardingState();
  for (const step of ONBOARDING_STEPS) {
    s = recordStepAnswer({ state: s, stepId: step.id, answers: {} });
  }
  const r = canMarkReady(s);
  expect(r.allowed, 'all satisfied').toBe(true);
});

test('skip fulfilment satisfies optional steps but not required', () => {
  let s = emptyOnboardingState();
  s.skipFulfilled = { audience: true, voice: true };
  // Still missing identity + briefing + digest
  const r = canMarkReady(s);
  expect(r.allowed, 'skips cannot satisfy required steps').toBe(false);
  expect(r.missing.sort(), '3 missing').toEqual(['identity', 'intelligence_briefing_config', 'weekly_digest_config'].sort());
});

test('skip fulfilment of a required step counts as completion', () => {
  let s = emptyOnboardingState();
  s = recordStepAnswer({ state: s, stepId: 'identity', answers: {} });
  s = recordStepAnswer({ state: s, stepId: 'weekly_digest_config', answers: {} });
  // Smart-skip the briefing step (unusual, but the logic should still allow it)
  s.skipFulfilled = { intelligence_briefing_config: true };
  const r = canMarkReady(s);
  expect(r.allowed, 'skipFulfilled covers required').toBe(true);
});

// ---------------------------------------------------------------------------
// nextStep ordering
// ---------------------------------------------------------------------------

console.log('nextStep:');

test('empty state → returns identity (step 1)', () => {
  const next = nextStep(emptyOnboardingState());
  expect(next?.id, 'first step').toBe('identity');
});

test('after Step 1 → next is audience (step 2)', () => {
  const s = recordStepAnswer({ state: emptyOnboardingState(), stepId: 'identity', answers: {} });
  expect(nextStep(s)?.id, 'step 2').toBe('audience');
});

test('skip-fulfilled steps are skipped', () => {
  let s = recordStepAnswer({ state: emptyOnboardingState(), stepId: 'identity', answers: {} });
  s.skipFulfilled = { audience: true, voice: true };
  expect(nextStep(s)?.id, 'jumps to 4').toBe('integrations');
});

test('all completed → nextStep returns null', () => {
  let s = emptyOnboardingState();
  for (const step of ONBOARDING_STEPS) {
    s = recordStepAnswer({ state: s, stepId: step.id, answers: {} });
  }
  expect(nextStep(s), 'null after all').toBe(null);
});

// ---------------------------------------------------------------------------
// recordStepAnswer
// ---------------------------------------------------------------------------

console.log('recordStepAnswer:');

test('merges answers without mutating input', () => {
  const initial = emptyOnboardingState();
  const s1 = recordStepAnswer({
    state: initial,
    stepId: 'identity',
    answers: { name: 'Acme' },
  });
  expect(initial.completedStepIds.has('identity'), 'input not mutated').toBe(false);
  expect(s1.completedStepIds.has('identity'), 'next state has step').toBe(true);
  expect(s1.answers.name, 'answer recorded').toBe('Acme');
});

// ---------------------------------------------------------------------------
// computeSmartSkips
// ---------------------------------------------------------------------------

console.log('computeSmartSkips:');

test('null scrape → no skips', () => {
  expect(computeSmartSkips(null), 'null').toEqual({});
});

test('rich scrape → audience + voice skipped', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'Small-to-medium B2B SaaS companies, 50-500 employees',
    voiceSignal: 'Professional but warm, short-sentence, action-focused',
  });
  expect(skips.audience === true, 'audience skipped').toBe(true);
  expect(skips.voice === true, 'voice skipped').toBe(true);
});

test('short signals do not trigger smart-skip (conservative)', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'SMB',  // too short
    voiceSignal: 'Warm',
  });
  expect(Boolean(skips.audience), 'short audience → no skip').toBe(false);
  expect(Boolean(skips.voice), 'short voice → no skip').toBe(false);
});

test('only audience signal → only audience skipped', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'Enterprise IT decision makers at Fortune 500 companies',
    voiceSignal: null,
  });
  expect(skips.audience === true, 'audience').toBe(true);
  expect(Boolean(skips.voice), 'voice not skipped').toBe(false);
});

console.log('');
console.log('');
