// server/services/__tests__/correctionPatternDetectorPure.test.ts
// Pure tests for the correction-pattern detector.
// Trust & Verification Layer spec §13.3 — test considerations.

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  centroid,
  cluster,
  parseSkillSlugFromBlockName,
  type CorrectionInput,
} from '../correctionPatternDetectorPure.js';

// ── cosineSimilarity ──────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical non-zero vectors', () => {
    const v = [0.5, 0.5, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns -1 for anti-parallel vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

// ── centroid ──────────────────────────────────────────────────────────────────

describe('centroid', () => {
  it('returns the mean of two vectors', () => {
    const c = centroid([[1, 0], [0, 1]]);
    expect(c).toHaveLength(2);
    expect(c[0]).toBeCloseTo(0.5);
    expect(c[1]).toBeCloseTo(0.5);
  });

  it('returns empty array for empty input', () => {
    expect(centroid([])).toEqual([]);
  });

  it('returns the vector itself for single input', () => {
    const v = [0.3, 0.7];
    const c = centroid([v]);
    expect(c[0]).toBeCloseTo(0.3);
    expect(c[1]).toBeCloseTo(0.7);
  });
});

// ── parseSkillSlugFromBlockName ────────────────────────────────────────────────

describe('parseSkillSlugFromBlockName', () => {
  it('extracts skill slug from a valid block name', () => {
    expect(parseSkillSlugFromBlockName('correction:agent-uuid:send_email:run-uuid')).toBe('send_email');
  });

  it('returns null for a non-correction block name', () => {
    expect(parseSkillSlugFromBlockName('manual:something')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSkillSlugFromBlockName('')).toBeNull();
  });
});

// ── cluster ───────────────────────────────────────────────────────────────────

function makeCorrection(
  overrides: Partial<CorrectionInput> & Pick<CorrectionInput, 'memoryBlockId' | 'editedOutputEmbedding'>,
): CorrectionInput {
  return {
    agentId: 'agent-1',
    skillSlug: 'send_email',
    capturedAt: '2026-01-01T00:00:00Z',
    content: `Corrected output: default content`,
    ...overrides,
  };
}

const THRESHOLD = 0.82;
const MIN_SIZE = 3;

describe('cluster', () => {
  it('groups corrections by (agentId, skillSlug)', () => {
    const corrections: CorrectionInput[] = [
      makeCorrection({ memoryBlockId: 'a', agentId: 'agent-1', skillSlug: 'skill-A', editedOutputEmbedding: [1, 0] }),
      makeCorrection({ memoryBlockId: 'b', agentId: 'agent-1', skillSlug: 'skill-B', editedOutputEmbedding: [1, 0] }),
      makeCorrection({ memoryBlockId: 'c', agentId: 'agent-2', skillSlug: 'skill-A', editedOutputEmbedding: [1, 0] }),
    ];
    // No group reaches minClusterSize=3
    const results = cluster({ corrections, similarityThreshold: THRESHOLD, minClusterSize: MIN_SIZE, windowDays: 30 });
    expect(results).toHaveLength(0);
  });

  it('drops clusters below minClusterSize', () => {
    const v = [1, 0];
    const corrections = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: v }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: v }),
    ];
    // Size 2 < minClusterSize 3 → dropped
    const results = cluster({ corrections, similarityThreshold: THRESHOLD, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(0);
  });

  it('includes clusters of exactly minClusterSize', () => {
    const v = [1, 0];
    const corrections = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: v, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: v, capturedAt: '2026-01-02T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: v, capturedAt: '2026-01-03T00:00:00Z' }),
    ];
    const results = cluster({ corrections, similarityThreshold: THRESHOLD, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(1);
    expect(results[0].memberMemoryBlockIds).toHaveLength(3);
  });

  it('drops dissimilar corrections (below threshold 0.82)', () => {
    // Two near-orthogonal vectors: cosine ≈ 0 < 0.82
    const similar = [1, 0, 0, 0];
    const dissimilar = [0, 1, 0, 0];
    const corrections = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: similar, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: similar, capturedAt: '2026-01-02T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: similar, capturedAt: '2026-01-03T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'd', editedOutputEmbedding: dissimilar, capturedAt: '2026-01-04T00:00:00Z' }),
    ];
    const results = cluster({ corrections, similarityThreshold: 0.82, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(1);
    expect(results[0].memberMemoryBlockIds).not.toContain('d');
    expect(results[0].memberMemoryBlockIds).toContain('a');
    expect(results[0].memberMemoryBlockIds).toContain('b');
    expect(results[0].memberMemoryBlockIds).toContain('c');
  });

  it('produces a cluster of 4 when four are similar and one is dissimilar', () => {
    // Acceptance criteria from plan §13 (Chunk 14).
    const similar = [1, 0, 0];
    // Slightly perturbed but still very similar (cosine > 0.99)
    const slightlyOff = [0.99, 0.141, 0];
    const dissimilar = [0, 1, 0];

    const corrections = [
      makeCorrection({ memoryBlockId: 'm1', editedOutputEmbedding: similar, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'm2', editedOutputEmbedding: slightlyOff, capturedAt: '2026-01-02T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'm3', editedOutputEmbedding: similar, capturedAt: '2026-01-03T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'm4', editedOutputEmbedding: slightlyOff, capturedAt: '2026-01-04T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'm5', editedOutputEmbedding: dissimilar, capturedAt: '2026-01-05T00:00:00Z' }),
    ];

    const results = cluster({ corrections, similarityThreshold: 0.82, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(1);
    expect(results[0].memberMemoryBlockIds).toHaveLength(4);
    expect(results[0].memberMemoryBlockIds).not.toContain('m5');
  });

  it('memberMemoryBlockIds sorted by (capturedAt ASC, memoryBlockId ASC)', () => {
    const v = [1, 0];
    const corrections = [
      makeCorrection({ memoryBlockId: 'z', editedOutputEmbedding: v, capturedAt: '2026-01-03T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: v, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'm', editedOutputEmbedding: v, capturedAt: '2026-01-02T00:00:00Z' }),
    ];
    const results = cluster({ corrections, similarityThreshold: 0.0, minClusterSize: 3, windowDays: 30 });
    expect(results[0].memberMemoryBlockIds).toEqual(['a', 'm', 'z']);
  });

  it('is deterministic under input permutation (spec §8.21)', () => {
    const v = [1, 0];
    const corrections = [
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: v, capturedAt: '2026-01-03T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: v, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: v, capturedAt: '2026-01-02T00:00:00Z' }),
    ];

    const shuffled = [corrections[2], corrections[0], corrections[1]];
    const r1 = cluster({ corrections, similarityThreshold: 0.0, minClusterSize: 3, windowDays: 30 });
    const r2 = cluster({ corrections: shuffled, similarityThreshold: 0.0, minClusterSize: 3, windowDays: 30 });
    expect(r1[0].memberMemoryBlockIds).toEqual(r2[0].memberMemoryBlockIds);
  });

  it('computes correct centroid embedding', () => {
    const a = [1, 0];
    const b = [0, 1];
    const c = [1, 1];
    const corrections = [
      makeCorrection({ memoryBlockId: 'x', editedOutputEmbedding: a }),
      makeCorrection({ memoryBlockId: 'y', editedOutputEmbedding: b }),
      makeCorrection({ memoryBlockId: 'z', editedOutputEmbedding: c }),
    ];
    const results = cluster({ corrections, similarityThreshold: 0.0, minClusterSize: 3, windowDays: 30 });
    expect(results[0].centroidEmbedding[0]).toBeCloseTo(2 / 3);
    expect(results[0].centroidEmbedding[1]).toBeCloseTo(2 / 3);
  });

  it('returns clusters sorted by (agentId ASC, skillSlug ASC)', () => {
    const v = [1, 0];
    const corrections: CorrectionInput[] = [
      { memoryBlockId: 'a1', agentId: 'z-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-01Z', content: '' },
      { memoryBlockId: 'a2', agentId: 'z-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-02Z', content: '' },
      { memoryBlockId: 'a3', agentId: 'z-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-03Z', content: '' },
      { memoryBlockId: 'b1', agentId: 'a-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-01Z', content: '' },
      { memoryBlockId: 'b2', agentId: 'a-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-02Z', content: '' },
      { memoryBlockId: 'b3', agentId: 'a-agent', skillSlug: 'skill', editedOutputEmbedding: v, capturedAt: '2026-01-03Z', content: '' },
    ];
    const results = cluster({ corrections, similarityThreshold: 0.0, minClusterSize: 3, windowDays: 30 });
    expect(results[0].agentId).toBe('a-agent');
    expect(results[1].agentId).toBe('z-agent');
  });
});
