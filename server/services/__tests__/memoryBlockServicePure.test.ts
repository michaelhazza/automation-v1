/**
 * memoryBlockServicePure.test.ts — pure ranking + token-budget logic
 *
 * Spec: docs/memory-and-briefings-spec.md §5.2 (S6)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  rankBlocksForInjection,
  dedupeCandidates,
  approxTokenCount,
  cosineSimilarity,
  type CandidateBlock,
} from '../memoryBlockServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function mkBlock(id: string, score: number, source: 'explicit' | 'relevance', contentChars = 400, protectedBlock = false): CandidateBlock {
  return {
    id,
    name: `block-${id}`,
    content: 'x'.repeat(contentChars),
    score,
    source,
    protected: protectedBlock,
  };
}

console.log('');
console.log('memoryBlockServicePure — ranking & token-budget (§5.2 S6)');
console.log('');

// ---------------------------------------------------------------------------
// approxTokenCount
// ---------------------------------------------------------------------------

console.log('approxTokenCount:');

test('empty → 0', () => expect(approxTokenCount(''), 'empty').toBe(0));
test('400 chars → 100 tokens', () => expect(approxTokenCount('x'.repeat(400)), '400 chars').toBe(100));
test('1 char → 1 token (ceil)', () => expect(approxTokenCount('a'), '1 char').toBe(1));

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

console.log('cosineSimilarity:');

test('identical vectors → 1', () => {
  const v = [1, 0, 0];
  expect(cosineSimilarity(v, v), 'identical').toBe(1);
});

test('orthogonal vectors → 0', () => {
  expect(cosineSimilarity([1, 0], [0, 1]), 'orthogonal').toBe(0);
});

test('opposite vectors → -1', () => {
  expect(cosineSimilarity([1, 0], [-1, 0]), 'opposite').toBe(-1);
});

test('mismatched lengths → 0', () => {
  expect(cosineSimilarity([1, 2], [1]), 'mismatched').toBe(0);
});

test('zero vector → 0', () => {
  expect(cosineSimilarity([0, 0], [1, 0]), 'zero magnitude').toBe(0);
});

// ---------------------------------------------------------------------------
// dedupeCandidates — explicit wins over relevance
// ---------------------------------------------------------------------------

console.log('dedupeCandidates:');

test('explicit wins over relevance for same id', () => {
  const result = dedupeCandidates([
    mkBlock('a', 0.9, 'relevance'),
    mkBlock('a', 1.0, 'explicit'),
  ]);
  expect(result.length, 'one block').toBe(1);
  expect(result[0].source, 'explicit kept').toBe('explicit');
});

test('different ids preserved', () => {
  const result = dedupeCandidates([
    mkBlock('a', 0.9, 'relevance'),
    mkBlock('b', 0.85, 'relevance'),
  ]);
  expect(result.length, 'two blocks').toBe(2);
});

// ---------------------------------------------------------------------------
// rankBlocksForInjection — threshold, top-K, token budget
// ---------------------------------------------------------------------------

console.log('rankBlocksForInjection:');

test('threshold floor drops below-threshold relevance blocks', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.9, 'relevance'),
      mkBlock('b', 0.4, 'relevance'), // below threshold 0.65
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 10000 },
  );
  expect(result.length, 'only one above threshold').toBe(1);
  expect(result[0].id, 'high-score kept').toBe('a');
});

test('top-K caps relevance results', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.95, 'relevance'),
      mkBlock('b', 0.90, 'relevance'),
      mkBlock('c', 0.85, 'relevance'),
      mkBlock('d', 0.80, 'relevance'),
      mkBlock('e', 0.75, 'relevance'),
    ],
    { threshold: 0.65, topK: 3, tokenBudget: 100000 },
  );
  expect(result.length, 'top-K = 3').toBe(3);
  expect(result.map((b) => b.id), 'sorted desc by score').toEqual(['a', 'b', 'c']);
});

test('relevance blocks sorted by score descending', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.7, 'relevance'),
      mkBlock('b', 0.9, 'relevance'),
      mkBlock('c', 0.8, 'relevance'),
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100000 },
  );
  expect(result.map((b) => b.id), 'descending order').toEqual(['b', 'c', 'a']);
});

test('token budget evicts relevance blocks in reverse order', () => {
  // Each block ~100 tokens; budget = 250 tokens; only 2 should fit.
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.95, 'relevance', 400),
      mkBlock('b', 0.90, 'relevance', 400),
      mkBlock('c', 0.85, 'relevance', 400),
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 250 },
  );
  expect(result.length, '2 blocks fit in 250 token budget').toBe(2);
  expect(result[0].id, 'highest score kept first').toBe('a');
  expect(result[1].id, 'second highest kept').toBe('b');
});

test('explicit blocks always pass through (bypass threshold + budget)', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.0, 'explicit', 10000), // enormous content, score=0
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100 },
  );
  expect(result.length, 'explicit bypasses').toBe(1);
  expect(result[0].source, 'explicit preserved').toBe('explicit');
});

test('protected blocks always pass through regardless of score', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.0, 'relevance', 10000, true), // protected + huge content
    ],
    { threshold: 0.65, topK: 0, tokenBudget: 1 }, // topK=0, tiny budget
  );
  expect(result.length, 'protected bypasses').toBe(1);
  expect(result[0].protected === true, 'protected flag preserved').toBe(true);
});

test('order: protected → explicit → relevance', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('c', 0.95, 'relevance'),
      mkBlock('a', 0.0, 'relevance', 200, true), // protected
      mkBlock('b', 1.0, 'explicit'),
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100000 },
  );
  expect(result.map((b) => b.id), 'protected first, explicit next, relevance last').toEqual(['a', 'b', 'c']);
});

test('smaller block fits after larger is skipped (non-greedy fill)', () => {
  // Budget 50 tokens; block-a = 100 tokens, block-b = 25 tokens.
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.95, 'relevance', 400), // 100 tokens → doesn't fit
      mkBlock('b', 0.90, 'relevance', 100), // 25 tokens → fits
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 50 },
  );
  expect(result.length, 'smaller block fits').toBe(1);
  expect(result[0].id, 'smaller block kept').toBe('b');
});

test('dedup applied before ranking (explicit + relevance same id)', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.95, 'relevance'),
      mkBlock('a', 0.0, 'explicit'),    // same id, lower score but explicit
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100000 },
  );
  expect(result.length, 'deduplicated').toBe(1);
  expect(result[0].source, 'explicit survives dedup').toBe('explicit');
});

test('empty candidate list → empty result', () => {
  const result = rankBlocksForInjection([], { threshold: 0.65, topK: 5, tokenBudget: 100 });
  expect(result.length, 'empty').toBe(0);
});

console.log('');
console.log('');
