/**
 * Retrieval pipeline regression tests — pure-function validation of scoring,
 * intent routing, and confidence gating. Runnable via:
 *   npx tsx server/services/__tests__/retrievalPipelinePure.test.ts
 *
 * These tests validate the building blocks of _hybridRetrieve without a DB
 * connection: weight profiles, dominance gating, query sanitization routing,
 * and intent classification integration.
 */

import { expect, test } from 'vitest';
import { classifyQueryIntent } from '../../lib/queryIntentClassifier.js';
import { RETRIEVAL_PROFILES, type RetrievalProfile } from '../../lib/queryIntent.js';
import { sanitizeSearchQuery } from '../../lib/sanitizeSearchQuery.js';
import { DOMINANCE_THRESHOLD, EXPANSION_MIN_SCORE } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// Simulate the combined_score calculation from _hybridRetrieve
// ---------------------------------------------------------------------------
function computeCombinedScore(
  rrfScore: number,
  qualityScore: number,
  recencyScore: number,
  profile: RetrievalProfile,
): number {
  const w = RETRIEVAL_PROFILES[profile];
  return rrfScore * w.rrf + qualityScore * w.quality + recencyScore * w.recency;
}

function isDominanceGated(topScore: number, secondScore: number): boolean {
  if (secondScore === 0) return false; // single result
  return topScore / secondScore < DOMINANCE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nRetrieval pipeline — weight profiles');

test('all profiles have weights summing to 1.0', () => {
  for (const [name, w] of Object.entries(RETRIEVAL_PROFILES)) {
    const sum = w.rrf + w.quality + w.recency;
    expect(sum).toBeCloseTo(1.0, 4)${name} weights sum to ${sum}`);
  }
});

test('temporal profile prioritises recency over rrf', () => {
  const w = RETRIEVAL_PROFILES.temporal;
  expect(w.recency > w.rrf, 'expected recency > rrf for temporal').toBeTruthy();
});

test('factual profile prioritises rrf over recency', () => {
  const w = RETRIEVAL_PROFILES.factual;
  expect(w.rrf > w.recency, 'expected rrf > recency for factual').toBeTruthy();
});

test('general profile is balanced — rrf >= quality >= recency', () => {
  const w = RETRIEVAL_PROFILES.general;
  expect(w.rrf >= w.quality, 'expected rrf >= quality').toBeTruthy();
  expect(w.quality >= w.recency, 'expected quality >= recency').toBeTruthy();
});

console.log('\nRetrieval pipeline — combined scoring');

test('temporal query ranks recent high-quality result above stale high-rrf result', () => {
  const recentScore = computeCombinedScore(0.3, 0.8, 1.0, 'temporal');
  const staleScore = computeCombinedScore(0.9, 0.8, 0.1, 'temporal');
  expect(recentScore > staleScore, `recent ${recentScore} should beat stale ${staleScore}`).toBeTruthy();
});

test('factual query ranks high-rrf result above recent low-rrf result', () => {
  const highRrf = computeCombinedScore(0.9, 0.5, 0.2, 'factual');
  const lowRrf = computeCombinedScore(0.2, 0.5, 0.9, 'factual');
  expect(highRrf > lowRrf, `highRrf ${highRrf} should beat lowRrf ${lowRrf}`).toBeTruthy();
});

test('same raw scores produce different rankings under temporal vs factual', () => {
  const temporalScore = computeCombinedScore(0.5, 0.5, 0.9, 'temporal');
  const factualScore = computeCombinedScore(0.5, 0.5, 0.9, 'factual');
  expect(temporalScore > factualScore, 'temporal should weight recency higher').toBeTruthy();
});

console.log('\nRetrieval pipeline — dominance gating');

test('DOMINANCE_THRESHOLD is exported from config', () => {
  expect(typeof DOMINANCE_THRESHOLD === 'number', 'expected number').toBeTruthy();
  expect(DOMINANCE_THRESHOLD > 1.0, 'threshold must be > 1.0').toBeTruthy();
});

test('clear winner is not gated', () => {
  expect(!isDominanceGated(0.9, 0.5), 'ratio 1.8 should not be gated').toBeTruthy();
});

test('close scores are gated', () => {
  expect(isDominanceGated(0.51, 0.50), 'ratio 1.02 should be gated').toBeTruthy();
});

test('exactly at threshold is not gated', () => {
  // ratio = 1.2 exactly → not less than 1.2 → not gated
  expect(!isDominanceGated(0.6, 0.5), 'ratio 1.2 should not be gated').toBeTruthy();
});

test('single result (secondScore=0) is not gated', () => {
  expect(!isDominanceGated(0.9, 0), 'single result should not be gated').toBeTruthy();
});

console.log('\nRetrieval pipeline — sanitisation → classification integration');

// Golden test cases: query → expected intent → expected sanitised output
const goldenCases: Array<{
  name: string;
  query: string;
  expectedIntent: RetrievalProfile;
  sanitisedContains?: string;
}> = [
  {
    name: 'temporal question routes correctly',
    query: 'What happened with the client last week?',
    expectedIntent: 'temporal',
  },
  {
    name: 'factual question routes correctly',
    query: "What is the client's email address?",
    expectedIntent: 'factual',
  },
  {
    name: 'general query routes correctly',
    query: 'client preferences',
    expectedIntent: 'general',
  },
  {
    name: 'agent-contaminated query gets cleaned before classification',
    query: 'Let me search the workspace memory for relevant information about the client. I should look at previous run data to find insights about their historical engagement. ' + 'What are the client retention metrics?',
    expectedIntent: 'general', // "What are" doesn't match "what is" factual pattern
    sanitisedContains: 'client retention metrics',
  },
  {
    name: 'clean multi-clause query preserves structure',
    query: 'Compare client A vs client B performance over last 3 months including revenue growth, churn rates, and customer acquisition costs across all product lines and geographic segments. Also include NPS trends and support ticket resolution rates for both accounts.',
    expectedIntent: 'temporal', // "last" triggers temporal pattern
    sanitisedContains: 'Compare client A vs client B',
  },
];

for (const tc of goldenCases) {
  test(tc.name, () => {
    const sanitised = sanitizeSearchQuery(tc.query);
    const intent = classifyQueryIntent(sanitised);
    expect(intent === tc.expectedIntent, `expected ${tc.expectedIntent}, got ${intent}`).toBeTruthy();
    if (tc.sanitisedContains) {
      expect(sanitised.includes(tc.sanitisedContains), `sanitised "${sanitised}" should contain "${tc.sanitisedContains}"`).toBeTruthy();
    }
  });
}

console.log('\nRetrieval pipeline — expansion gating invariant');

test('dominance-gated results should NOT trigger graph expansion', () => {
  // This validates the invariant: when dominanceGated=true, expansion is skipped.
  // The actual gating is in _hybridRetrieve; here we verify the decision function.
  const ambiguousTop = 0.51;
  const ambiguousSecond = 0.50;
  expect(isDominanceGated(ambiguousTop, ambiguousSecond), 'ambiguous results should be gated').toBeTruthy();
  // Confident results allow expansion
  const confidentTop = 0.8;
  const confidentSecond = 0.4;
  expect(!isDominanceGated(confidentTop, confidentSecond), 'confident results should not be gated').toBeTruthy();
});

console.log('\nRetrieval pipeline — absolute score floor for expansion');

test('EXPANSION_MIN_SCORE is exported from config', () => {
  expect(typeof EXPANSION_MIN_SCORE === 'number', 'expected number').toBeTruthy();
  expect(EXPANSION_MIN_SCORE > 0, 'floor must be > 0').toBeTruthy();
});

test('strong result above floor allows expansion', () => {
  expect(0.2 >= EXPANSION_MIN_SCORE, 'score 0.2 should clear the floor').toBeTruthy();
});

test('weak result below floor blocks expansion', () => {
  expect(0.01 < EXPANSION_MIN_SCORE, 'score 0.01 should NOT clear the floor').toBeTruthy();
});

test('dominant but weak results should still block expansion', () => {
  // Top=0.02 is dominant over second=0.01 (ratio 2.0 > 1.2) but both are weak
  expect(!isDominanceGated(0.02, 0.01), 'dominant ratio — not dominance-gated').toBeTruthy();
  expect(0.02 < EXPANSION_MIN_SCORE, 'but top score is below absolute floor — expansion blocked').toBeTruthy();
});
