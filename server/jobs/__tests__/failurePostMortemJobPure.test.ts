// server/jobs/__tests__/failurePostMortemJobPure.test.ts
// Pure unit tests for failurePostMortemJobPure helpers.
// Closed-Loop Skill Improvement spec §9.1 (Chunk 3).

import { describe, it, expect } from 'vitest';
import { checkAmendmentCaps, deriveAmendmentStackFromSnapshot } from '../failurePostMortemJobPure.js';

// ── checkAmendmentCaps ────────────────────────────────────────────────────────

describe('checkAmendmentCaps', () => {
  const now = new Date('2026-05-18T12:00:00Z');

  it('returns all zeros for empty input', () => {
    const result = checkAmendmentCaps([], now);
    expect(result.weeklyCount).toBe(0);
    expect(result.lifetimeCount).toBe(0);
    expect(result.weeklyCapExceeded).toBe(false);
    expect(result.lifetimeCapExceeded).toBe(false);
  });

  it('counts accepted amendments toward lifetime cap', () => {
    const rows = [
      { createdAt: new Date('2025-01-01T00:00:00Z'), status: 'accepted' },
      { createdAt: new Date('2025-02-01T00:00:00Z'), status: 'accepted' },
      { createdAt: new Date('2025-03-01T00:00:00Z'), status: 'rejected' },
    ];
    const result = checkAmendmentCaps(rows, now);
    expect(result.lifetimeCount).toBe(2);
    expect(result.lifetimeCapExceeded).toBe(false);
  });

  it('weekly cap: 4 recent rows does not exceed', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      status: 'draft',
    }));
    const result = checkAmendmentCaps(rows, now);
    expect(result.weeklyCount).toBe(4);
    expect(result.weeklyCapExceeded).toBe(false);
  });

  it('weekly cap: 5 recent rows exactly hits the cap', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      createdAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      status: 'draft',
    }));
    const result = checkAmendmentCaps(rows, now);
    expect(result.weeklyCount).toBe(5);
    expect(result.weeklyCapExceeded).toBe(true);
  });

  it('lifetime cap: 19 accepted rows does not exceed', () => {
    const rows = Array.from({ length: 19 }, () => ({
      createdAt: new Date('2024-01-01T00:00:00Z'),
      status: 'accepted',
    }));
    const result = checkAmendmentCaps(rows, now);
    expect(result.lifetimeCount).toBe(19);
    expect(result.lifetimeCapExceeded).toBe(false);
  });

  it('lifetime cap: 20 accepted rows exactly hits the cap', () => {
    const rows = Array.from({ length: 20 }, () => ({
      createdAt: new Date('2024-01-01T00:00:00Z'),
      status: 'accepted',
    }));
    const result = checkAmendmentCaps(rows, now);
    expect(result.lifetimeCount).toBe(20);
    expect(result.lifetimeCapExceeded).toBe(true);
  });

  it('old amendments outside 7-day window do not count toward weeklyCount', () => {
    const rows = [
      { createdAt: new Date('2025-01-01T00:00:00Z'), status: 'draft' },
    ];
    const result = checkAmendmentCaps(rows, now);
    expect(result.weeklyCount).toBe(0);
  });
});

// ── deriveAmendmentStackFromSnapshot ─────────────────────────────────────────

describe('deriveAmendmentStackFromSnapshot', () => {
  it('forwards all fields verbatim', () => {
    const snapshotRow = {
      includedAmendmentIds: ['id-1', 'id-2'],
      excludedAmendmentIds: ['id-3'],
      resolverVersion: '1.0.0',
      amendmentVersionSetHash: 'abc123',
    };
    const result = deriveAmendmentStackFromSnapshot(snapshotRow);
    expect(result.included).toEqual(['id-1', 'id-2']);
    expect(result.excluded).toEqual(['id-3']);
    expect(result.resolverVersion).toBe('1.0.0');
    expect(result.amendmentVersionSetHash).toBe('abc123');
  });

  it('handles empty ID arrays', () => {
    const snapshotRow = {
      includedAmendmentIds: [],
      excludedAmendmentIds: [],
      resolverVersion: '1.0.0',
      amendmentVersionSetHash: 'xyz',
    };
    const result = deriveAmendmentStackFromSnapshot(snapshotRow);
    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });
});
