/**
 * memoryBlockService.tier.test.ts — Logic tests for Tier-2 block candidate
 * composition in memoryBlockService (F1 §4).
 *
 * Tests use the pure ranking helpers directly to avoid importing DB-touching
 * code. They exercise the candidate-merge and ranking logic that tier-2
 * fetching plugs into.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockService.tier.test.ts
 */

import { expect, test } from 'vitest';
import {
  rankBlocksForInjection,
  dedupeCandidates,
  type CandidateBlock,
} from '../memoryBlockServicePure.js';
import { BLOCK_RELEVANCE_THRESHOLD } from '../../config/limits.js';
import { MEMORY_BLOCK_TIER2_BOOST } from '../../config/limits.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTier2Candidate(id: string, name: string): CandidateBlock {
  return {
    id,
    name,
    content: `Tier-2 content for ${name}`,
    score: BLOCK_RELEVANCE_THRESHOLD + MEMORY_BLOCK_TIER2_BOOST,
    source: 'relevance',
    protected: false,
  };
}

function makeRelevanceCandidateBelowThreshold(id: string, name: string): CandidateBlock {
  return {
    id,
    name,
    content: `Low-score content for ${name}`,
    score: BLOCK_RELEVANCE_THRESHOLD - 0.1,
    source: 'relevance',
    protected: false,
  };
}

const DEFAULT_RANKING_PARAMS = {
  threshold: BLOCK_RELEVANCE_THRESHOLD,
  topK: 10,
  tokenBudget: 10_000,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test('Tier-2 candidates with score above threshold are included by rankBlocksForInjection', () => {
  const tier2 = makeTier2Candidate('block-t2-1', 'offer-positioning');
  const result = rankBlocksForInjection([tier2], DEFAULT_RANKING_PARAMS);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('block-t2-1');
});

test('Candidates below threshold are excluded by rankBlocksForInjection', () => {
  const lowScore = makeRelevanceCandidateBelowThreshold('block-low', 'low-score-block');
  const result = rankBlocksForInjection([lowScore], DEFAULT_RANKING_PARAMS);
  expect(result).toHaveLength(0);
});

test('Tier-2 score constant is strictly above threshold so tier-2 blocks always pass', () => {
  expect(MEMORY_BLOCK_TIER2_BOOST).toBeGreaterThan(0);
  const tier2Score = BLOCK_RELEVANCE_THRESHOLD + MEMORY_BLOCK_TIER2_BOOST;
  expect(tier2Score).toBeGreaterThan(BLOCK_RELEVANCE_THRESHOLD);
});

test('No tier-2 candidates when agentDomain is not set — composedBlocks has no duplicates', () => {
  // Simulate no agentDomain: tier2Candidates = []
  const tier1 = {
    id: 'block-tier1',
    name: 'brand-voice',
    content: 'Brand voice content',
    score: 1.0,
    source: 'relevance' as const,
    protected: false,
  };
  const relevance = {
    id: 'block-rel',
    name: 'some-fact',
    content: 'Fact content',
    score: BLOCK_RELEVANCE_THRESHOLD + 0.05,
    source: 'relevance' as const,
    protected: false,
  };
  const result = rankBlocksForInjection([tier1, relevance], DEFAULT_RANKING_PARAMS);
  // Both above threshold, both included
  expect(result).toHaveLength(2);
  const ids = result.map((r) => r.id);
  // No duplicates
  expect(new Set(ids).size).toBe(ids.length);
});

test('dedupeCandidates: when a tier-2 block appears also as explicit, explicit wins', () => {
  const asRelevance: CandidateBlock = {
    id: 'shared-block',
    name: 'offer-positioning',
    content: 'content',
    score: BLOCK_RELEVANCE_THRESHOLD + MEMORY_BLOCK_TIER2_BOOST,
    source: 'relevance',
    protected: false,
  };
  const asExplicit: CandidateBlock = {
    id: 'shared-block',
    name: 'offer-positioning',
    content: 'content',
    score: 1.0,
    source: 'explicit',
    protected: false,
  };
  // explicit first then relevance
  const deduped = dedupeCandidates([asExplicit, asRelevance]);
  expect(deduped).toHaveLength(1);
  expect(deduped[0].source).toBe('explicit');
  // relevance first then explicit
  const deduped2 = dedupeCandidates([asRelevance, asExplicit]);
  expect(deduped2).toHaveLength(1);
  expect(deduped2[0].source).toBe('explicit');
});
