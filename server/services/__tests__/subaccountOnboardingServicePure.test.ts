/**
 * subaccountOnboardingServicePure.test.ts — markReady guard truth table
 *
 * Spec: docs/memory-and-briefings-spec.md §8.2 (S5)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/subaccountOnboardingServicePure.test.ts
 */

import {
  canMarkReady,
  nextStep,
  recordStepAnswer,
  computeSmartSkips,
  emptyOnboardingState,
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from '../subaccountOnboardingServicePure.js';

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

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false`);
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
  assertFalse(r.allowed, 'empty state blocked');
  assertEqual(
    r.missing.sort(),
    ['identity', 'intelligence_briefing_config', 'weekly_digest_config'].sort(),
    '3 required missing',
  );
});

test('only Step 1 completed → still blocked on 6 + 7', () => {
  const s = recordStepAnswer({
    state: emptyOnboardingState(),
    stepId: 'identity',
    answers: { name: 'Acme' },
  });
  const r = canMarkReady(s);
  assertFalse(r.allowed, 'still blocked');
  assertEqual(r.missing.sort(), ['intelligence_briefing_config', 'weekly_digest_config'].sort(), '2 missing');
});

test('Steps 1 + 6 + 7 all completed → allowed', () => {
  let s = emptyOnboardingState();
  for (const stepId of ['identity', 'intelligence_briefing_config', 'weekly_digest_config'] as const) {
    s = recordStepAnswer({ state: s, stepId, answers: {} });
  }
  const r = canMarkReady(s);
  assertTrue(r.allowed, 'minimum set satisfied');
  assertEqual(r.missing.length, 0, 'no missing');
});

test('all 9 steps completed → allowed', () => {
  let s = emptyOnboardingState();
  for (const step of ONBOARDING_STEPS) {
    s = recordStepAnswer({ state: s, stepId: step.id, answers: {} });
  }
  const r = canMarkReady(s);
  assertTrue(r.allowed, 'all satisfied');
});

test('skip fulfilment satisfies optional steps but not required', () => {
  let s = emptyOnboardingState();
  s.skipFulfilled = { audience: true, voice: true };
  // Still missing identity + briefing + digest
  const r = canMarkReady(s);
  assertFalse(r.allowed, 'skips cannot satisfy required steps');
  assertEqual(r.missing.sort(), ['identity', 'intelligence_briefing_config', 'weekly_digest_config'].sort(), '3 missing');
});

test('skip fulfilment of a required step counts as completion', () => {
  let s = emptyOnboardingState();
  s = recordStepAnswer({ state: s, stepId: 'identity', answers: {} });
  s = recordStepAnswer({ state: s, stepId: 'weekly_digest_config', answers: {} });
  // Smart-skip the briefing step (unusual, but the logic should still allow it)
  s.skipFulfilled = { intelligence_briefing_config: true };
  const r = canMarkReady(s);
  assertTrue(r.allowed, 'skipFulfilled covers required');
});

// ---------------------------------------------------------------------------
// nextStep ordering
// ---------------------------------------------------------------------------

console.log('nextStep:');

test('empty state → returns identity (step 1)', () => {
  const next = nextStep(emptyOnboardingState());
  assertEqual(next?.id, 'identity', 'first step');
});

test('after Step 1 → next is audience (step 2)', () => {
  const s = recordStepAnswer({ state: emptyOnboardingState(), stepId: 'identity', answers: {} });
  assertEqual(nextStep(s)?.id, 'audience', 'step 2');
});

test('skip-fulfilled steps are skipped', () => {
  let s = recordStepAnswer({ state: emptyOnboardingState(), stepId: 'identity', answers: {} });
  s.skipFulfilled = { audience: true, voice: true };
  assertEqual(nextStep(s)?.id, 'integrations', 'jumps to 4');
});

test('all completed → nextStep returns null', () => {
  let s = emptyOnboardingState();
  for (const step of ONBOARDING_STEPS) {
    s = recordStepAnswer({ state: s, stepId: step.id, answers: {} });
  }
  assertEqual(nextStep(s), null, 'null after all');
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
  assertFalse(initial.completedStepIds.has('identity'), 'input not mutated');
  assertTrue(s1.completedStepIds.has('identity'), 'next state has step');
  assertEqual(s1.answers.name, 'Acme', 'answer recorded');
});

// ---------------------------------------------------------------------------
// computeSmartSkips
// ---------------------------------------------------------------------------

console.log('computeSmartSkips:');

test('null scrape → no skips', () => {
  assertEqual(computeSmartSkips(null), {}, 'null');
});

test('rich scrape → audience + voice skipped', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'Small-to-medium B2B SaaS companies, 50-500 employees',
    voiceSignal: 'Professional but warm, short-sentence, action-focused',
  });
  assertTrue(skips.audience === true, 'audience skipped');
  assertTrue(skips.voice === true, 'voice skipped');
});

test('short signals do not trigger smart-skip (conservative)', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'SMB',  // too short
    voiceSignal: 'Warm',
  });
  assertFalse(Boolean(skips.audience), 'short audience → no skip');
  assertFalse(Boolean(skips.voice), 'short voice → no skip');
});

test('only audience signal → only audience skipped', () => {
  const skips = computeSmartSkips({
    audienceSignal: 'Enterprise IT decision makers at Fortune 500 companies',
    voiceSignal: null,
  });
  assertTrue(skips.audience === true, 'audience');
  assertFalse(Boolean(skips.voice), 'voice not skipped');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
