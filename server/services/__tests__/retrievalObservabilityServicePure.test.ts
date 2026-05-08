// retrievalObservabilityServicePure.test.ts — Pure observability helper tests for Chunk 4A.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §11.4, §11.5, §1.5 #3, #8

import { describe, it, expect } from 'vitest';
import {
  shouldShowAlwaysAvailableWarning,
  truncateForEmission,
  buildDegradedResult,
  ALWAYS_AVAILABLE_DOC_COUNT_WARN,
  ALWAYS_AVAILABLE_TOKEN_COST_WARN,
} from '../retrievalObservabilityServicePure.js';
import type { RetrievalResult } from '../../../shared/types/retrieval.js';

// ---------------------------------------------------------------------------
// Helper factory
// ---------------------------------------------------------------------------

function makeEmptyResult(): RetrievalResult {
  return {
    loaded: [],
    alwaysAvailable: [],
    referenceOnlyManifest: [],
    rejected: {
      aboveThreshold: { total: 0, retained: 0, items: [] },
      belowThreshold: { count: 0, sample: [] },
      modeExcluded: { total: 0, retained: 0, items: [] },
    },
    totalTokensLoaded: 0,
    degraded: false,
    degradedReason: null,
  };
}

// ---------------------------------------------------------------------------
// shouldShowAlwaysAvailableWarning
// ---------------------------------------------------------------------------

describe('shouldShowAlwaysAvailableWarning', () => {
  it('returns false when both are below thresholds', () => {
    expect(shouldShowAlwaysAvailableWarning({ docCount: 29, tokenCost: 29999 })).toBe(false);
  });

  it('returns true when docCount meets threshold', () => {
    expect(shouldShowAlwaysAvailableWarning({ docCount: 30, tokenCost: 0 })).toBe(true);
  });

  it('returns true when tokenCost meets threshold', () => {
    expect(shouldShowAlwaysAvailableWarning({ docCount: 0, tokenCost: 30000 })).toBe(true);
  });

  it('returns true when both meet thresholds', () => {
    expect(shouldShowAlwaysAvailableWarning({ docCount: 30, tokenCost: 30000 })).toBe(true);
  });

  it('uses the exported constants as thresholds', () => {
    expect(ALWAYS_AVAILABLE_DOC_COUNT_WARN).toBe(30);
    expect(ALWAYS_AVAILABLE_TOKEN_COST_WARN).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// truncateForEmission
// ---------------------------------------------------------------------------

describe('truncateForEmission', () => {
  it('truncates aboveThreshold.items to 50 and updates retained', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${String(i).padStart(4, '0')}`,
      reason: 'budget_exhausted' as const,
      finalScore: i / 100,
    }));

    const result = makeEmptyResult();
    result.rejected.aboveThreshold = { total: 100, retained: 100, items };

    const truncated = truncateForEmission(result);

    expect(truncated.rejected.aboveThreshold.retained).toBe(50);
    expect(truncated.rejected.aboveThreshold.items).toHaveLength(50);
    // total should be unchanged
    expect(truncated.rejected.aboveThreshold.total).toBe(100);
  });

  it('produces identical output on two calls with the same input (idempotent)', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({
      id: `id-${String(i).padStart(4, '0')}`,
      reason: 'budget_exhausted' as const,
      finalScore: Math.random(),
    }));

    const result = makeEmptyResult();
    result.rejected.aboveThreshold = { total: 80, retained: 80, items };

    const run1 = truncateForEmission(result);
    const run2 = truncateForEmission(result);

    expect(run1.rejected.aboveThreshold.items.map(x => x.id))
      .toEqual(run2.rejected.aboveThreshold.items.map(x => x.id));
  });

  it('passes through results with fewer than max items unchanged', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      reason: 'budget_exhausted' as const,
      finalScore: 0.5,
    }));

    const result = makeEmptyResult();
    result.rejected.aboveThreshold = { total: 5, retained: 5, items };

    const truncated = truncateForEmission(result);

    expect(truncated.rejected.aboveThreshold.retained).toBe(5);
    expect(truncated.rejected.aboveThreshold.items).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// buildDegradedResult
// ---------------------------------------------------------------------------

describe('buildDegradedResult', () => {
  const reasons = [
    'pool_query_failed',
    'embedding_provider_failed',
    'rank_failed',
    'unknown',
  ] as const;

  for (const reason of reasons) {
    it(`builds a fully-empty degraded result for reason '${reason}'`, () => {
      const result = buildDegradedResult(reason);

      expect(result.degraded).toBe(true);
      expect(result.degradedReason).toBe(reason);
      expect(result.loaded).toEqual([]);
      expect(result.alwaysAvailable).toEqual([]);
      expect(result.referenceOnlyManifest).toEqual([]);
      expect(result.totalTokensLoaded).toBe(0);
    });
  }
});
