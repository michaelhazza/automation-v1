// retrievalServicePure.test.ts — Pure ranker tests for Chunk 2A.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §2A contracts

import { describe, it, expect } from 'vitest';
import {
  rankCandidates,
  MAX_REJECTED_ABOVE_THRESHOLD,
  MAX_REJECTED_BELOW_THRESHOLD_SAMPLE,
  type RankCandidatesInput,
} from '../retrievalServicePure.js';
import type { RetrievalCandidate } from '../../../shared/types/retrieval.js';

// ---------------------------------------------------------------------------
// Helper factory
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<RetrievalCandidate> & { id: string }): RetrievalCandidate {
  return {
    organisationId: 'org-1',
    kind: 'memory_block',
    mode: 'auto',
    scopeTier: 1,
    finalScore: 0.8,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    tokenCount: 10,
    content: 'test content',
    ...overrides,
  };
}

function makeInput(overrides: Partial<RankCandidatesInput> & { candidates: RetrievalCandidate[] }): RankCandidatesInput {
  return {
    threshold: 0.5,
    budgetTokens: 10000,
    nowMs: 1000000,
    orgId: 'org-1',
    runContext: {
      runId: 'run-1',
      agentId: 'agent-1',
      subaccountId: null,
      scheduledTaskId: null,
      taskInstanceId: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Comparator determinism — identical score/scopeTier/updatedAt → id ASC
// ---------------------------------------------------------------------------

describe('comparator determinism', () => {
  it('produces stable order by id ASC when all other fields are equal', () => {
    const ts = new Date('2026-01-01T00:00:00Z');
    const candidates = [
      makeCandidate({ id: 'c', finalScore: 0.9, scopeTier: 2, updatedAt: ts }),
      makeCandidate({ id: 'a', finalScore: 0.9, scopeTier: 2, updatedAt: ts }),
      makeCandidate({ id: 'b', finalScore: 0.9, scopeTier: 2, updatedAt: ts }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.loaded.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is stable across two identical invocations', () => {
    const ts = new Date('2026-01-01T00:00:00Z');
    const candidates = [
      makeCandidate({ id: 'z', finalScore: 0.9, scopeTier: 1, updatedAt: ts }),
      makeCandidate({ id: 'm', finalScore: 0.9, scopeTier: 1, updatedAt: ts }),
      makeCandidate({ id: 'a', finalScore: 0.9, scopeTier: 1, updatedAt: ts }),
    ];
    const r1 = rankCandidates(makeInput({ candidates }));
    const r2 = rankCandidates(makeInput({ candidates }));
    expect(r1.loaded.map(r => r.id)).toEqual(r2.loaded.map(r => r.id));
  });
});

// ---------------------------------------------------------------------------
// 2. Budget cap — above-threshold items past budget land in rejected
// ---------------------------------------------------------------------------

describe('budget cap', () => {
  it('items above threshold that exceed budget land in rejected.aboveThreshold with reason budget_exhausted', () => {
    const candidates = [
      makeCandidate({ id: 'a', finalScore: 0.9, tokenCount: 60 }),
      makeCandidate({ id: 'b', finalScore: 0.85, tokenCount: 60 }),
    ];
    const result = rankCandidates(makeInput({ candidates, budgetTokens: 100 }));

    // 'a' fits (60 <= 100), 'b' does not (60 + 60 = 120 > 100)
    expect(result.loaded.map(r => r.id)).toEqual(['a']);
    expect(result.rejected.aboveThreshold.items).toHaveLength(1);
    expect(result.rejected.aboveThreshold.items[0].id).toBe('b');
    expect(result.rejected.aboveThreshold.items[0].reason).toBe('budget_exhausted');
  });

  it('totalTokensLoaded reflects only loaded candidates', () => {
    const candidates = [
      makeCandidate({ id: 'a', finalScore: 0.9, tokenCount: 50 }),
      makeCandidate({ id: 'b', finalScore: 0.85, tokenCount: 200 }),
    ];
    const result = rankCandidates(makeInput({ candidates, budgetTokens: 100 }));
    expect(result.totalTokensLoaded).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 3. Below-threshold filtering
// ---------------------------------------------------------------------------

describe('below-threshold filtering', () => {
  it('candidates below threshold are counted in rejected.belowThreshold.count', () => {
    const candidates = [
      makeCandidate({ id: 'a', finalScore: 0.8 }),
      makeCandidate({ id: 'b', finalScore: 0.3 }), // below 0.5
      makeCandidate({ id: 'c', finalScore: 0.1 }), // below 0.5
    ];
    const result = rankCandidates(makeInput({ candidates, threshold: 0.5 }));
    expect(result.loaded.map(r => r.id)).toEqual(['a']);
    expect(result.rejected.belowThreshold.count).toBe(2);
  });

  it('top items by score appear in rejected.belowThreshold.sample up to MAX_REJECTED_BELOW_THRESHOLD_SAMPLE', () => {
    // Generate 30 candidates below threshold — only 20 should appear in sample
    const candidates = Array.from({ length: 30 }, (_, i) =>
      makeCandidate({ id: `below-${i}`, finalScore: 0.1 + i * 0.001 }),
    );
    const result = rankCandidates(makeInput({ candidates, threshold: 0.5 }));
    expect(result.rejected.belowThreshold.count).toBe(30);
    expect(result.rejected.belowThreshold.sample.length).toBe(MAX_REJECTED_BELOW_THRESHOLD_SAMPLE);
  });
});

// ---------------------------------------------------------------------------
// 4. Truncation determinism — 100 above-threshold candidates
// ---------------------------------------------------------------------------

describe('truncation determinism', () => {
  it('100 candidates past budget produce a 50-item aboveThreshold.items array with total > retained', () => {
    // 1 candidate fits (tokenCount=1, budget=1), remaining 99 are budget-exhausted
    const candidates = [
      makeCandidate({ id: 'first', finalScore: 0.99, tokenCount: 1 }),
      ...Array.from({ length: 100 }, (_, i) =>
        makeCandidate({ id: `extra-${String(i).padStart(3, '0')}`, finalScore: 0.9, tokenCount: 10 }),
      ),
    ];
    const result = rankCandidates(makeInput({ candidates, budgetTokens: 1 }));

    expect(result.rejected.aboveThreshold.items).toHaveLength(MAX_REJECTED_ABOVE_THRESHOLD);
    expect(result.rejected.aboveThreshold.total).toBeGreaterThan(result.rejected.aboveThreshold.retained);
  });

  it('two replays of identical input produce identical aboveThreshold.items arrays', () => {
    const candidates = [
      makeCandidate({ id: 'seed', finalScore: 0.99, tokenCount: 1 }),
      ...Array.from({ length: 100 }, (_, i) =>
        makeCandidate({ id: `dup-${String(i).padStart(3, '0')}`, finalScore: 0.9, tokenCount: 10 }),
      ),
    ];
    const input = makeInput({ candidates, budgetTokens: 1 });
    const r1 = rankCandidates(input);
    const r2 = rankCandidates(input);
    expect(r1.rejected.aboveThreshold.items.map(x => x.id)).toEqual(
      r2.rejected.aboveThreshold.items.map(x => x.id),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Defence-in-depth — mismatched org candidate is silently filtered
// ---------------------------------------------------------------------------

describe('defence-in-depth org filtering', () => {
  it('a candidate with organisationId !== orgId is not in loaded', () => {
    const candidates = [
      makeCandidate({ id: 'own', organisationId: 'org-1', finalScore: 0.9 }),
      makeCandidate({ id: 'foreign', organisationId: 'org-EVIL', finalScore: 0.95 }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.loaded.map(r => r.id)).toEqual(['own']);
    expect(result.loaded.some(r => r.id === 'foreign')).toBe(false);
  });

  it('a candidate with organisationId !== orgId does not appear in rejected.aboveThreshold.items', () => {
    const candidates = [
      makeCandidate({ id: 'foreign', organisationId: 'org-EVIL', finalScore: 0.95, tokenCount: 99999 }),
    ];
    const result = rankCandidates(makeInput({ candidates, budgetTokens: 1 }));
    expect(result.rejected.aboveThreshold.items.some(x => x.id === 'foreign')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. mode_excluded — reference_only candidates never in loaded
// ---------------------------------------------------------------------------

describe('mode_excluded (reference_only)', () => {
  it('reference_only candidates do not appear in loaded', () => {
    const candidates = [
      makeCandidate({ id: 'ref', mode: 'reference_only', finalScore: 0.9 }),
      makeCandidate({ id: 'auto', mode: 'auto', finalScore: 0.8 }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.loaded.map(r => r.id)).toEqual(['auto']);
  });

  it('reference_only candidates appear in referenceOnlyManifest', () => {
    const candidates = [
      makeCandidate({ id: 'ref-a', mode: 'reference_only', documentId: 'doc-1' }),
      makeCandidate({ id: 'ref-b', mode: 'reference_only' }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.referenceOnlyManifest).toHaveLength(2);
    expect(result.referenceOnlyManifest.map(m => m.id).sort()).toEqual(['ref-a', 'ref-b']);
    const refA = result.referenceOnlyManifest.find(m => m.id === 'ref-a');
    expect(refA?.documentId).toBe('doc-1');
  });

  it('modeExcluded totals match referenceOnly count', () => {
    const candidates = [
      makeCandidate({ id: 'ref-1', mode: 'reference_only' }),
      makeCandidate({ id: 'ref-2', mode: 'reference_only' }),
      makeCandidate({ id: 'ref-3', mode: 'reference_only' }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.rejected.modeExcluded.total).toBe(3);
    expect(result.rejected.modeExcluded.retained).toBe(3);
    expect(result.rejected.modeExcluded.items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 7. alwaysAvailable subset
// ---------------------------------------------------------------------------

describe('alwaysAvailable subset', () => {
  it('always_available candidates that are loaded appear in both loaded and alwaysAvailable', () => {
    const candidates = [
      makeCandidate({ id: 'always', mode: 'always_available', finalScore: 0.9 }),
      makeCandidate({ id: 'auto', mode: 'auto', finalScore: 0.8 }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    expect(result.loaded.some(r => r.id === 'always')).toBe(true);
    expect(result.alwaysAvailable.some(r => r.id === 'always')).toBe(true);
    // auto-mode item should NOT be in alwaysAvailable
    expect(result.alwaysAvailable.some(r => r.id === 'auto')).toBe(false);
  });

  it('alwaysAvailable is a strict subset of loaded', () => {
    const candidates = [
      makeCandidate({ id: 'aa-1', mode: 'always_available', finalScore: 0.9 }),
      makeCandidate({ id: 'aa-2', mode: 'always_available', finalScore: 0.85 }),
      makeCandidate({ id: 'auto-1', mode: 'auto', finalScore: 0.7 }),
    ];
    const result = rankCandidates(makeInput({ candidates }));
    for (const aa of result.alwaysAvailable) {
      expect(result.loaded.some(l => l.id === aa.id)).toBe(true);
    }
  });

  it('always_available candidate past budget does not appear in alwaysAvailable', () => {
    const candidates = [
      makeCandidate({ id: 'aa', mode: 'always_available', finalScore: 0.9, tokenCount: 500 }),
    ];
    const result = rankCandidates(makeInput({ candidates, budgetTokens: 10 }));
    expect(result.alwaysAvailable).toHaveLength(0);
    expect(result.loaded).toHaveLength(0);
    expect(result.rejected.aboveThreshold.items[0].id).toBe('aa');
  });
});
