import { describe, test, expect } from 'vitest';
import {
  cosineSimilarity,
  scoreCandidates,
  recallFallbackPredicate,
} from '../retrievalQueryEmbedderPure.js';

describe('cosineSimilarity', () => {
  test('identical vectors return 1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  test('orthogonal vectors return 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  test('anti-parallel vectors return -1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0);
  });

  test('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });

  test('throws on empty vector', () => {
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  test('throws on NaN element', () => {
    expect(() => cosineSimilarity([NaN, 0], [1, 0])).toThrow();
  });
});

describe('scoreCandidates', () => {
  const query = [1, 0, 0];

  test('candidate with similarity above threshold is included with finalScore', () => {
    const result = scoreCandidates({
      candidates: [{ embedding: [1, 0, 0] }],
      queryEmbedding: query,
      threshold: 0.5,
    });
    expect(result).toHaveLength(1);
    expect(result[0].finalScore).toBeCloseTo(1.0);
  });

  test('candidate exactly at threshold passes', () => {
    // [1, 0] vs [1, 0] = 1.0 >= 1.0
    const result = scoreCandidates({
      candidates: [{ embedding: [1, 0, 0] }],
      queryEmbedding: query,
      threshold: 1.0,
    });
    expect(result).toHaveLength(1);
  });

  test('candidate just below threshold is excluded', () => {
    const result = scoreCandidates({
      candidates: [{ embedding: [0, 1, 0] }], // cosine = 0
      queryEmbedding: query,
      threshold: 0.5,
    });
    expect(result).toHaveLength(0);
  });

  test('malformed candidate (length mismatch) is excluded, rest continue', () => {
    const result = scoreCandidates({
      candidates: [
        { embedding: [1] },       // length mismatch — excluded
        { embedding: [1, 0, 0] }, // ok
      ],
      queryEmbedding: query,
      threshold: 0,
    });
    expect(result).toHaveLength(1);
    expect(result[0].finalScore).toBeCloseTo(1.0);
  });

  test('NaN element in candidate is excluded silently', () => {
    const result = scoreCandidates({
      candidates: [{ embedding: [NaN, 0, 0] }],
      queryEmbedding: query,
      threshold: 0,
    });
    expect(result).toHaveLength(0);
  });

  test('determinism — shuffled candidate order produces same finalScores per candidate', () => {
    const candidates = [
      { id: 'a', embedding: [1, 0, 0] },
      { id: 'b', embedding: [0.9, 0.1, 0] },
      { id: 'c', embedding: [0, 1, 0] },
    ];
    const opts = { queryEmbedding: query, threshold: 0 };
    const r1 = scoreCandidates({ candidates: [...candidates], ...opts });
    const r2 = scoreCandidates({ candidates: [candidates[2], candidates[0], candidates[1]], ...opts });
    const scoreById = (arr: typeof r1) => Object.fromEntries(arr.map((c) => [(c as any).id, c.finalScore]));
    expect(scoreById(r1)).toEqual(scoreById(r2));
  });
});

describe('recallFallbackPredicate', () => {
  test('non-empty pool filtered to zero → true', () => {
    expect(recallFallbackPredicate({ filteredCount: 0, originalCount: 5 })).toBe(true);
  });

  test('empty pool → false (no recall loss)', () => {
    expect(recallFallbackPredicate({ filteredCount: 0, originalCount: 0 })).toBe(false);
  });

  test('non-zero filtered count → false', () => {
    expect(recallFallbackPredicate({ filteredCount: 2, originalCount: 5 })).toBe(false);
  });
});
