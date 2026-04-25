/**
 * Pure-function tests for ruleTeachabilityClassifierPure.
 * Run via: npx tsx server/services/__tests__/ruleTeachabilityClassifierPure.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  classifyTeachabilityPure,
  DEFAULT_TEACHABILITY_CONFIG,
} from '../ruleTeachabilityClassifierPure.js';
import type { TeachabilityInput } from '../ruleTeachabilityClassifierPure.js';
import type { BriefApprovalCard } from '../../../shared/types/briefResultContract.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_CARD: BriefApprovalCard = {
  kind: 'approval',
  artefactId: 'test-artefact-id',
  summary: 'Send follow-up email to 14 contacts',
  actionSlug: 'send_email',
  actionArgs: {},
  affectedRecordIds: [],
  riskLevel: 'medium',
};

function makeInput(overrides: Partial<TeachabilityInput['userContext']> = {}): TeachabilityInput {
  return {
    approvalCard: BASE_CARD,
    wasApproved: true,
    userContext: {
      priorSimilarApprovals: 0,
      daysSinceLastCapture: null,
      skipStreakCount: 0,
      suggestionFrequency: 'occasional',
      suggestionBackoffUntil: null,
      ...overrides,
    },
    config: DEFAULT_TEACHABILITY_CONFIG,
  };
}

// ---------------------------------------------------------------------------
// user_disabled branch
// ---------------------------------------------------------------------------

test('returns user_disabled when suggestionFrequency is off', () => {
  const result = classifyTeachabilityPure(makeInput({ suggestionFrequency: 'off' }));
  assert.equal(result.shouldSuggest, false);
  assert.equal(result.reason, 'user_disabled');
  assert.equal(result.noveltyScore, 0);
});

// ---------------------------------------------------------------------------
// on_backoff branch — active date backoff
// ---------------------------------------------------------------------------

test('returns on_backoff when suggestionBackoffUntil is in the future', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24); // +1 day
  const result = classifyTeachabilityPure(makeInput({ suggestionBackoffUntil: future }));
  assert.equal(result.shouldSuggest, false);
  assert.equal(result.reason, 'on_backoff');
});

test('does not backoff when suggestionBackoffUntil is in the past', () => {
  const past = new Date(Date.now() - 1000);
  const result = classifyTeachabilityPure(makeInput({ suggestionBackoffUntil: past }));
  // Should not be blocked by backoff (may be novel or routine depending on score)
  assert.notEqual(result.reason, 'on_backoff');
});

// ---------------------------------------------------------------------------
// on_backoff branch — skip streak
// ---------------------------------------------------------------------------

test('returns on_backoff when skipStreakCount hits threshold', () => {
  const result = classifyTeachabilityPure(
    makeInput({ skipStreakCount: DEFAULT_TEACHABILITY_CONFIG.skipBackoffThreshold }),
  );
  assert.equal(result.shouldSuggest, false);
  assert.equal(result.reason, 'on_backoff');
});

test('does not backoff when skipStreakCount is below threshold', () => {
  const result = classifyTeachabilityPure(
    makeInput({ skipStreakCount: DEFAULT_TEACHABILITY_CONFIG.skipBackoffThreshold - 1 }),
  );
  assert.notEqual(result.reason, 'on_backoff');
});

// ---------------------------------------------------------------------------
// novel branch
// ---------------------------------------------------------------------------

test('suggests novel when first-time approval with high-risk card', () => {
  const input: TeachabilityInput = {
    ...makeInput({ priorSimilarApprovals: 0 }),
    approvalCard: { ...BASE_CARD, riskLevel: 'high' },
  };
  const result = classifyTeachabilityPure(input);
  assert.equal(result.shouldSuggest, true);
  assert.equal(result.reason, 'novel');
  assert.ok(result.noveltyScore >= DEFAULT_TEACHABILITY_CONFIG.minNoveltyScore);
});

test('suggests novel on rejection signal', () => {
  const input: TeachabilityInput = {
    ...makeInput({ priorSimilarApprovals: 0 }),
    wasApproved: false,
  };
  const result = classifyTeachabilityPure(input);
  assert.equal(result.shouldSuggest, true);
  assert.equal(result.reason, 'novel');
});

// ---------------------------------------------------------------------------
// routine branch
// ---------------------------------------------------------------------------

test('returns routine when action is very familiar', () => {
  const result = classifyTeachabilityPure(makeInput({ priorSimilarApprovals: 20 }));
  assert.equal(result.shouldSuggest, false);
  assert.equal(result.reason, 'routine');
});

// ---------------------------------------------------------------------------
// frequent mode lowers threshold
// ---------------------------------------------------------------------------

test('frequent frequency lowers effective threshold and may suggest where occasional would not', () => {
  // Construct a borderline input that sits between occasional and frequent thresholds
  const borderlineInput: TeachabilityInput = {
    approvalCard: { ...BASE_CARD, riskLevel: 'low' },
    wasApproved: true,
    userContext: {
      priorSimilarApprovals: 3, // familiar — reduces novelty
      daysSinceLastCapture: null,
      skipStreakCount: 0,
      suggestionFrequency: 'frequent',
      suggestionBackoffUntil: null,
    },
    config: DEFAULT_TEACHABILITY_CONFIG,
  };

  const occasionalInput: TeachabilityInput = {
    ...borderlineInput,
    userContext: { ...borderlineInput.userContext, suggestionFrequency: 'occasional' },
  };

  const frequentResult = classifyTeachabilityPure(borderlineInput);
  const occasionalResult = classifyTeachabilityPure(occasionalInput);

  // frequent should have a lower effective min score; verify it's at least as permissive
  if (!frequentResult.shouldSuggest) {
    assert.equal(occasionalResult.shouldSuggest, false, 'occasional must also not suggest if frequent does not');
  }
  // If occasional also suggests, both are consistent — that's fine too
});

// ---------------------------------------------------------------------------
// noveltyScore range invariant
// ---------------------------------------------------------------------------

test('noveltyScore is always in [0, 1]', () => {
  const inputs: TeachabilityInput[] = [
    makeInput({ priorSimilarApprovals: 0 }),
    makeInput({ priorSimilarApprovals: 100 }),
    { ...makeInput(), wasApproved: false, approvalCard: { ...BASE_CARD, riskLevel: 'high' } },
    { ...makeInput(), wasApproved: true, approvalCard: { ...BASE_CARD, riskLevel: 'low' } },
  ];
  for (const input of inputs) {
    const { noveltyScore } = classifyTeachabilityPure(input);
    assert.ok(noveltyScore >= 0 && noveltyScore <= 1, `noveltyScore ${noveltyScore} out of range`);
  }
});
