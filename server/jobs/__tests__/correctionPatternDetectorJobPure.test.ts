// server/jobs/__tests__/correctionPatternDetectorJobPure.test.ts
// Pure tests for the correction pattern detector job.
// Trust & Verification Layer spec §13.3 — job helper logic.

import { describe, it, expect } from 'vitest';
import { parseEmbedding, parseSkillSlugFromBlockName } from '../../services/correctionPatternDetectorPure.js';

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
