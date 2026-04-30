/**
 * skillAnalyzerServicePureAgentRanking.test.ts — Phase 2 of skill-analyzer-v2.
 *
 * Pure unit tests for rankAgentsForCandidate. Covers: threshold boundary,
 * top-K truncation, tie-breaking, empty agent list, K > agent count, all
 * scores below threshold.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillAnalyzerServicePureAgentRanking.test.ts
 */

import { expect, test } from 'vitest';
import {
  rankAgentsForCandidate,
  AGENT_PROPOSAL_THRESHOLD,
  AGENT_PROPOSAL_TOPK,
  type RankableAgent,
} from '../skillAnalyzerServicePure.js';

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a RankableAgent with a controlled embedding. The embedding is
 *  expressed as a unit vector pointing in a specific direction so cosine
 *  similarity is predictable. */
function agent(id: string, embedding: number[]): RankableAgent {
  return {
    systemAgentId: id,
    slug: id,
    name: `Agent ${id}`,
    embedding,
  };
}

/** Unit-vector candidate embedding aligned with the X axis. Cosine
 *  similarity against another unit vector equals the X component. */
const X_AXIS = [1, 0, 0];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('constants are exported with expected defaults', () => {
  assertEq(AGENT_PROPOSAL_TOPK, 3, 'AGENT_PROPOSAL_TOPK');
  assertEq(AGENT_PROPOSAL_THRESHOLD, 0.5, 'AGENT_PROPOSAL_THRESHOLD');
});

test('empty agent list returns empty proposals', () => {
  const result = rankAgentsForCandidate(X_AXIS, []);
  assertEq(result.length, 0, 'length');
});

test('top-K truncation: more agents than K → returns exactly K', () => {
  const agents = [
    agent('a', [1.0, 0, 0]),  // 1.0
    agent('b', [0.9, 0.436, 0]), // ~0.9
    agent('c', [0.8, 0.6, 0]),   // 0.8
    agent('d', [0.7, 0.714, 0]), // 0.7
    agent('e', [0.6, 0.8, 0]),   // 0.6
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  assertEq(result.length, 3, 'top-K = 3');
  // Should be the three highest-scoring agents in order
  assertEq(result[0].systemAgentId, 'a', 'first');
  assertEq(result[1].systemAgentId, 'b', 'second');
  assertEq(result[2].systemAgentId, 'c', 'third');
});

test('K > agent count → returns all agents', () => {
  const agents = [
    agent('a', [1.0, 0, 0]),
    agent('b', [0.9, 0.436, 0]),
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents, { topK: 5 });
  assertEq(result.length, 2, 'returns all agents');
});

test('threshold boundary: scores >= threshold are pre-selected', () => {
  // a, b above 0.5; c below
  const agents = [
    agent('a', [1.0, 0, 0]),  // 1.0
    agent('b', [0.5, 0.866, 0]), // 0.5 (exactly at threshold)
    agent('c', [0.3, 0.954, 0]),  // 0.3 (below)
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  assertEq(result.length, 3, 'top-3 returned');
  assertEq(result[0].selected, true, 'a selected');
  assertEq(result[1].selected, true, 'b selected (>= threshold)');
  assertEq(result[2].selected, false, 'c NOT selected (< threshold)');
});

test('all scores below threshold → still returns top-K, all unselected', () => {
  const agents = [
    agent('a', [0.4, 0.917, 0]),  // 0.4
    agent('b', [0.3, 0.954, 0]),  // 0.3
    agent('c', [0.2, 0.980, 0]),  // 0.2
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  assertEq(result.length, 3, 'top-3 returned');
  for (const proposal of result) {
    assertEq(proposal.selected, false, `${proposal.systemAgentId} unselected`);
  }
  // Order should still be highest first
  assertEq(result[0].systemAgentId, 'a', 'a first');
});

test('preserves slug and name as snapshots', () => {
  const agents: RankableAgent[] = [
    { systemAgentId: 'agent-uuid-1', slug: 'marketing-agent', name: 'Marketing Agent', embedding: [1, 0, 0] },
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  assertEq(result.length, 1, 'length');
  assertEq(result[0].slugSnapshot, 'marketing-agent', 'slugSnapshot');
  assertEq(result[0].nameSnapshot, 'Marketing Agent', 'nameSnapshot');
});

test('score is the cosine similarity value', () => {
  const agents = [agent('a', [0.6, 0.8, 0])];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  expect(result[0].score).toBeCloseTo(0.6, 4);
});

test('custom threshold respected', () => {
  const agents = [
    agent('a', [1.0, 0, 0]),    // 1.0
    agent('b', [0.85, 0.527, 0]), // 0.85
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents, { threshold: 0.9 });
  assertEq(result[0].selected, true, 'a selected (>= 0.9)');
  assertEq(result[1].selected, false, 'b NOT selected (< 0.9)');
});

test('custom topK respected', () => {
  const agents = [
    agent('a', [1.0, 0, 0]),
    agent('b', [0.9, 0.436, 0]),
    agent('c', [0.8, 0.6, 0]),
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents, { topK: 2 });
  assertEq(result.length, 2, 'top-K = 2');
});

test('tie scores: V8 sort is stable, original order preserved', () => {
  // a and b have identical embeddings → identical scores. The Node V8
  // sort is stable, so the input order is preserved.
  const agents = [
    agent('a', [0.7, 0.714, 0]),
    agent('b', [0.7, 0.714, 0]),
    agent('c', [0.5, 0.866, 0]),
  ];
  const result = rankAgentsForCandidate(X_AXIS, agents);
  // After sort by score desc: [a, b, c] OR [b, a, c]. With stable sort
  // and equal scores, a comes before b.
  assertEq(result[0].systemAgentId, 'a', 'a first (stable sort tie)');
  assertEq(result[1].systemAgentId, 'b', 'b second (stable sort tie)');
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
