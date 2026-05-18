// server/jobs/__tests__/amendmentDedupPure.test.ts
// Pure unit tests for amendment deduplication helpers.
// Closed-Loop Skill Improvement spec §9.1 step 9 (Chunk 4).

import { describe, it, expect } from 'vitest';
import {
  normaliseAmendmentBody,
  computeAmendmentDedupKey,
  classifyDedup,
  type DedupCohort,
} from '../amendmentDedupPure.js';

// ── normaliseAmendmentBody ────────────────────────────────────────────────────

describe('normaliseAmendmentBody', () => {
  it('lowercases the body', () => {
    expect(normaliseAmendmentBody('Always Use Proper GRAMMAR')).toBe('always use proper grammar');
  });

  it('collapses multiple whitespace characters into a single space', () => {
    expect(normaliseAmendmentBody('hello   world\t\nnext')).toBe('hello world next');
  });

  it('strips trailing punctuation', () => {
    expect(normaliseAmendmentBody('Do not do this.')).toBe('do not do this');
    expect(normaliseAmendmentBody('Stop!')).toBe('stop');
    expect(normaliseAmendmentBody('Why?')).toBe('why');
    expect(normaliseAmendmentBody('Hello,')).toBe('hello');
    expect(normaliseAmendmentBody('Wait;')).toBe('wait');
  });

  it('strips trailing punctuation sequence', () => {
    expect(normaliseAmendmentBody('Done!.')).toBe('done');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseAmendmentBody('  hello world  ')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseAmendmentBody('')).toBe('');
  });

  it('handles already-normalised input without mutation', () => {
    const input = 'this is already normal';
    expect(normaliseAmendmentBody(input)).toBe(input);
  });
});

// ── computeAmendmentDedupKey ──────────────────────────────────────────────────

describe('computeAmendmentDedupKey', () => {
  const SKILL_A = 'skill-uuid-a';
  const SKILL_B = 'skill-uuid-b';

  it('returns a 64-character hex string (SHA-256)', () => {
    const key = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'some body');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const key1 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'some body');
    const key2 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'some body');
    expect(key1).toBe(key2);
  });

  it('differs across different skillIds', () => {
    const key1 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'body');
    const key2 = computeAmendmentDedupKey(SKILL_B, 'guardrail', 'body');
    expect(key1).not.toBe(key2);
  });

  it('differs across different kinds', () => {
    const key1 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'body');
    const key2 = computeAmendmentDedupKey(SKILL_A, 'example', 'body');
    expect(key1).not.toBe(key2);
  });

  it('differs across different normalised bodies', () => {
    const key1 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'first body');
    const key2 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'second body');
    expect(key1).not.toBe(key2);
  });

  it('treats case and whitespace variants as the same key (normalisation)', () => {
    const key1 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'Do Not Skip Steps');
    const key2 = computeAmendmentDedupKey(SKILL_A, 'guardrail', 'do not skip steps');
    const key3 = computeAmendmentDedupKey(SKILL_A, 'guardrail', '  do  not  skip  steps  ');
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });
});

// ── classifyDedup ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-18T12:00:00Z');
const FIVE_DAYS_AGO = new Date('2026-05-13T12:00:00Z');

function makeCohort(overrides: Partial<DedupCohort> = {}): DedupCohort {
  return {
    activeAccepted: [],
    pendingReview: [],
    recentlyRejectedWithin14Days: [],
    failingRunsInLast7Days: 0,
    ...overrides,
  };
}

describe('classifyDedup', () => {
  const CANDIDATE_KEY = 'abc123key';

  it('returns insert when cohort is empty', () => {
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort: makeCohort(), now: NOW });
    expect(result.decision).toBe('insert');
  });

  it('suppresses and increments active when key matches activeAccepted', () => {
    const cohort = makeCohort({
      activeAccepted: [{ id: 'id-active', dedupKey: CANDIDATE_KEY }],
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result).toEqual({ decision: 'suppress_increment_active', targetId: 'id-active' });
  });

  it('suppresses and increments pending when key matches pendingReview', () => {
    const cohort = makeCohort({
      pendingReview: [{ id: 'id-pending', dedupKey: CANDIDATE_KEY }],
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result).toEqual({ decision: 'suppress_increment_pending', targetId: 'id-pending' });
  });

  it('prioritises active over pending when both match', () => {
    const cohort = makeCohort({
      activeAccepted: [{ id: 'id-active', dedupKey: CANDIDATE_KEY }],
      pendingReview: [{ id: 'id-pending', dedupKey: CANDIDATE_KEY }],
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result).toEqual({ decision: 'suppress_increment_active', targetId: 'id-active' });
  });

  it('suppresses recently rejected when failing runs < 3', () => {
    const cohort = makeCohort({
      recentlyRejectedWithin14Days: [
        { id: 'id-rejected', dedupKey: CANDIDATE_KEY, rejectedAt: FIVE_DAYS_AGO },
      ],
      failingRunsInLast7Days: 2,
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result).toEqual({ decision: 'suppress_recently_rejected', targetId: 'id-rejected' });
  });

  it('overrides freshness suppression when failing runs >= 3 (high recurrence)', () => {
    const cohort = makeCohort({
      recentlyRejectedWithin14Days: [
        { id: 'id-rejected', dedupKey: CANDIDATE_KEY, rejectedAt: FIVE_DAYS_AGO },
      ],
      failingRunsInLast7Days: 3,
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result).toEqual({ decision: 'insert_override_freshness', reason: 'high_recurrence' });
  });

  it('inserts when rejected matches but failing runs exactly at threshold', () => {
    const cohort = makeCohort({
      recentlyRejectedWithin14Days: [
        { id: 'id-rejected', dedupKey: CANDIDATE_KEY, rejectedAt: FIVE_DAYS_AGO },
      ],
      failingRunsInLast7Days: 3,
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result.decision).toBe('insert_override_freshness');
  });

  it('inserts when cohort has non-matching keys only', () => {
    const cohort = makeCohort({
      activeAccepted: [{ id: 'other-id', dedupKey: 'different-key' }],
      pendingReview: [{ id: 'other-pending', dedupKey: 'another-key' }],
    });
    const result = classifyDedup({ candidateKey: CANDIDATE_KEY, cohort, now: NOW });
    expect(result.decision).toBe('insert');
  });
});
