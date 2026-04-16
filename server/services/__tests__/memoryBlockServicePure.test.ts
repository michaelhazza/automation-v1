/**
 * memoryBlockServicePure.test.ts — pure ranking + token-budget logic
 *
 * Spec: docs/memory-and-briefings-spec.md §5.2 (S6)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockServicePure.test.ts
 */

import {
  rankBlocksForInjection,
  dedupeCandidates,
  approxTokenCount,
  cosineSimilarity,
  type CandidateBlock,
} from '../memoryBlockServicePure.js';

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

test('empty → 0', () => assertEqual(approxTokenCount(''), 0, 'empty'));
test('400 chars → 100 tokens', () => assertEqual(approxTokenCount('x'.repeat(400)), 100, '400 chars'));
test('1 char → 1 token (ceil)', () => assertEqual(approxTokenCount('a'), 1, '1 char'));

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

console.log('cosineSimilarity:');

test('identical vectors → 1', () => {
  const v = [1, 0, 0];
  assertEqual(cosineSimilarity(v, v), 1, 'identical');
});

test('orthogonal vectors → 0', () => {
  assertEqual(cosineSimilarity([1, 0], [0, 1]), 0, 'orthogonal');
});

test('opposite vectors → -1', () => {
  assertEqual(cosineSimilarity([1, 0], [-1, 0]), -1, 'opposite');
});

test('mismatched lengths → 0', () => {
  assertEqual(cosineSimilarity([1, 2], [1]), 0, 'mismatched');
});

test('zero vector → 0', () => {
  assertEqual(cosineSimilarity([0, 0], [1, 0]), 0, 'zero magnitude');
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
  assertEqual(result.length, 1, 'one block');
  assertEqual(result[0].source, 'explicit', 'explicit kept');
});

test('different ids preserved', () => {
  const result = dedupeCandidates([
    mkBlock('a', 0.9, 'relevance'),
    mkBlock('b', 0.85, 'relevance'),
  ]);
  assertEqual(result.length, 2, 'two blocks');
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
  assertEqual(result.length, 1, 'only one above threshold');
  assertEqual(result[0].id, 'a', 'high-score kept');
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
  assertEqual(result.length, 3, 'top-K = 3');
  assertEqual(
    result.map((b) => b.id),
    ['a', 'b', 'c'],
    'sorted desc by score',
  );
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
  assertEqual(
    result.map((b) => b.id),
    ['b', 'c', 'a'],
    'descending order',
  );
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
  assertEqual(result.length, 2, '2 blocks fit in 250 token budget');
  assertEqual(result[0].id, 'a', 'highest score kept first');
  assertEqual(result[1].id, 'b', 'second highest kept');
});

test('explicit blocks always pass through (bypass threshold + budget)', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.0, 'explicit', 10000), // enormous content, score=0
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100 },
  );
  assertEqual(result.length, 1, 'explicit bypasses');
  assertEqual(result[0].source, 'explicit', 'explicit preserved');
});

test('protected blocks always pass through regardless of score', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.0, 'relevance', 10000, true), // protected + huge content
    ],
    { threshold: 0.65, topK: 0, tokenBudget: 1 }, // topK=0, tiny budget
  );
  assertEqual(result.length, 1, 'protected bypasses');
  assertTrue(result[0].protected === true, 'protected flag preserved');
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
  assertEqual(
    result.map((b) => b.id),
    ['a', 'b', 'c'],
    'protected first, explicit next, relevance last',
  );
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
  assertEqual(result.length, 1, 'smaller block fits');
  assertEqual(result[0].id, 'b', 'smaller block kept');
});

test('dedup applied before ranking (explicit + relevance same id)', () => {
  const result = rankBlocksForInjection(
    [
      mkBlock('a', 0.95, 'relevance'),
      mkBlock('a', 0.0, 'explicit'),    // same id, lower score but explicit
    ],
    { threshold: 0.65, topK: 5, tokenBudget: 100000 },
  );
  assertEqual(result.length, 1, 'deduplicated');
  assertEqual(result[0].source, 'explicit', 'explicit survives dedup');
});

test('empty candidate list → empty result', () => {
  const result = rankBlocksForInjection([], { threshold: 0.65, topK: 5, tokenBudget: 100 });
  assertEqual(result.length, 0, 'empty');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
