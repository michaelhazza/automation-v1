// server/jobs/__tests__/correctionPatternDetectorJobPure.test.ts
// Pure tests for the correction pattern detector job.
// Trust & Verification Layer spec §13.3 — job helper logic.
// Closed-Loop Skill Improvement §10.2 — extended clustering dimensions.

import { describe, it, expect } from 'vitest';
import { parseEmbedding, parseSkillSlugFromBlockName, cluster, type CorrectionInput } from '../../services/correctionPatternDetectorPure.js';

// ── parseEmbedding ────────────────────────────────────────────────────────────

describe('parseEmbedding', () => {
  it('returns null for null input', () => {
    expect(parseEmbedding(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseEmbedding(undefined)).toBeNull();
  });

  it('passes through a number array unchanged', () => {
    const arr = [0.1, 0.2, 0.3];
    expect(parseEmbedding(arr)).toBe(arr);
  });

  it('parses a bracket-enclosed comma-separated string', () => {
    const result = parseEmbedding('[0.1,0.2,0.3]');
    expect(result).toHaveLength(3);
    expect(result![0]).toBeCloseTo(0.1);
    expect(result![1]).toBeCloseTo(0.2);
    expect(result![2]).toBeCloseTo(0.3);
  });

  it('parses a string without outer brackets', () => {
    const result = parseEmbedding('0.5,0.6');
    expect(result).toHaveLength(2);
    expect(result![0]).toBeCloseTo(0.5);
    expect(result![1]).toBeCloseTo(0.6);
  });

  it('returns null for an object input', () => {
    expect(parseEmbedding({ data: [1, 2, 3] })).toBeNull();
  });

  it('handles single-element string embedding', () => {
    const result = parseEmbedding('[0.99]');
    expect(result).toHaveLength(1);
    expect(result![0]).toBeCloseTo(0.99);
  });
});

// ── parseSkillSlugFromBlockName (job usage) ───────────────────────────────────

describe('parseSkillSlugFromBlockName (job usage)', () => {
  it('extracts skillSlug from a well-formed correction block name', () => {
    const name = 'correction:550e8400-e29b-41d4-a716-446655440000:send_email:run-uuid-here';
    expect(parseSkillSlugFromBlockName(name)).toBe('send_email');
  });

  it('returns null for a block not starting with correction', () => {
    expect(parseSkillSlugFromBlockName('pattern:agent-id:send_email:run-id')).toBeNull();
  });

  it('returns null for names with fewer than 4 colon-separated parts', () => {
    expect(parseSkillSlugFromBlockName('correction:agent-id:send_email')).toBeNull();
  });
});

// ── §10.2 clustering dimensions: failedCheckId + entityType ──────────────────

function makeCorrection(
  overrides: Partial<CorrectionInput> & Pick<CorrectionInput, 'memoryBlockId' | 'editedOutputEmbedding'>,
): CorrectionInput {
  return {
    agentId: 'agent-1',
    skillSlug: 'send_email',
    capturedAt: '2026-01-01T00:00:00Z',
    content: 'default content',
    ...overrides,
  };
}

describe('cluster — new §10.2 dimensions (failedCheckId, entityType)', () => {
  const SIMILAR_VEC = [1, 0, 0];

  it('includes failedCheckId and entityType in the grouping key — different values produce separate groups', () => {
    const corrections: CorrectionInput[] = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-01T00:00:00Z', failedCheckId: 'check-alpha', entityType: 'subaccount' }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-02T00:00:00Z', failedCheckId: 'check-alpha', entityType: 'subaccount' }),
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-03T00:00:00Z', failedCheckId: 'check-alpha', entityType: 'subaccount' }),
      // Same agentId + skillSlug but different failedCheckId — goes to a different group
      makeCorrection({ memoryBlockId: 'd', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-04T00:00:00Z', failedCheckId: 'check-beta', entityType: 'subaccount' }),
      makeCorrection({ memoryBlockId: 'e', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-05T00:00:00Z', failedCheckId: 'check-beta', entityType: 'subaccount' }),
      makeCorrection({ memoryBlockId: 'f', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-06T00:00:00Z', failedCheckId: 'check-beta', entityType: 'subaccount' }),
    ];

    const results = cluster({ corrections, similarityThreshold: 0.82, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(2);
    const groupA = results.find((r) => r.memberMemoryBlockIds.includes('a'));
    const groupB = results.find((r) => r.memberMemoryBlockIds.includes('d'));
    expect(groupA).toBeDefined();
    expect(groupB).toBeDefined();
    expect(groupA?.memberMemoryBlockIds).not.toContain('d');
  });

  it('null failedCheckId and null entityType group together (absent = empty string normalisation)', () => {
    const corrections: CorrectionInput[] = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-01T00:00:00Z', failedCheckId: null, entityType: null }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-02T00:00:00Z', failedCheckId: null, entityType: null }),
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-03T00:00:00Z', failedCheckId: undefined, entityType: undefined }),
    ];

    const results = cluster({ corrections, similarityThreshold: 0.82, minClusterSize: 3, windowDays: 30 });
    // All three should be in the same group (null and undefined both normalise to '')
    expect(results).toHaveLength(1);
    expect(results[0].memberMemoryBlockIds).toHaveLength(3);
  });

  it('existing memory-write output shape is unchanged — ClusterResult has no failedCheckId or entityType', () => {
    const corrections: CorrectionInput[] = [
      makeCorrection({ memoryBlockId: 'a', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-01T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'b', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-02T00:00:00Z' }),
      makeCorrection({ memoryBlockId: 'c', editedOutputEmbedding: SIMILAR_VEC, capturedAt: '2026-01-03T00:00:00Z' }),
    ];

    const results = cluster({ corrections, similarityThreshold: 0.82, minClusterSize: 3, windowDays: 30 });
    expect(results).toHaveLength(1);
    const result = results[0];
    // Output shape must not include new dimensions
    expect(result).toHaveProperty('agentId');
    expect(result).toHaveProperty('skillSlug');
    expect(result).toHaveProperty('memberMemoryBlockIds');
    expect(result).toHaveProperty('centroidEmbedding');
    expect(result).toHaveProperty('representativeEditedOutput');
    expect(result).not.toHaveProperty('failedCheckId');
    expect(result).not.toHaveProperty('entityType');
  });
});
