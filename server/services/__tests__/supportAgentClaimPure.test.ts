/**
 * supportAgentClaimPure.test.ts — Tests for atomic-claim predicate construction,
 * TTL math, and terminal-verdict enum coverage.
 *
 * Chunk 8 (phase-1-showcase-mvps): focuses on the claim predicate and TTL.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  buildClaimPredicateSql,
  isTerminalVerdict,
  TERMINAL_VERDICTS,
  DEFAULT_CLAIM_TTL_MINUTES,
  isHumanActivityTooRecent,
  minutesSinceHumanActivity,
} from '../supportAgentExecutionServicePure.js';

// ---------------------------------------------------------------------------
// Claim-predicate SQL construction
// ---------------------------------------------------------------------------

describe('buildClaimPredicateSql — optimistic claim predicate', () => {
  it('produces the correct IS NULL branch', () => {
    const sql = buildClaimPredicateSql(15);
    expect(sql).toContain('bot_claimed_at IS NULL');
  });

  it('produces the correct TTL expiry branch', () => {
    const sql = buildClaimPredicateSql(15);
    expect(sql).toContain('bot_claimed_at < now() - interval');
    expect(sql).toContain('15 minutes');
  });

  it('uses OR to combine both branches', () => {
    const sql = buildClaimPredicateSql(15);
    expect(sql).toContain('OR');
  });

  it('handles a TTL of 1 minute', () => {
    const sql = buildClaimPredicateSql(1);
    expect(sql).toContain('1 minutes');
  });

  it('handles a large TTL', () => {
    const sql = buildClaimPredicateSql(120);
    expect(sql).toContain('120 minutes');
  });
});

// ---------------------------------------------------------------------------
// TTL default
// ---------------------------------------------------------------------------

describe('DEFAULT_CLAIM_TTL_MINUTES', () => {
  it('is 15', () => {
    expect(DEFAULT_CLAIM_TTL_MINUTES).toBe(15);
  });

  it('produces a valid predicate', () => {
    const sql = buildClaimPredicateSql(DEFAULT_CLAIM_TTL_MINUTES);
    expect(sql).toContain('15 minutes');
  });
});

// ---------------------------------------------------------------------------
// Terminal-verdict enum — coverage
// ---------------------------------------------------------------------------

describe('terminal-verdict enum coverage', () => {
  const EXPECTED_VERDICTS = [
    'drafted_for_review',
    'drafted_and_dispatched',
    'skipped_collision',
    'escalated_to_human',
    'skipped_low_confidence',
    'skipped_no_action_needed',
  ] as const;

  it('TERMINAL_VERDICTS contains all expected values', () => {
    for (const v of EXPECTED_VERDICTS) {
      expect(TERMINAL_VERDICTS).toContain(v);
    }
  });

  it('isTerminalVerdict returns true for each expected verdict', () => {
    for (const v of EXPECTED_VERDICTS) {
      expect(isTerminalVerdict(v)).toBe(true);
    }
  });

  it('isTerminalVerdict rejects unknown values', () => {
    expect(isTerminalVerdict('drafted_but_not_listed')).toBe(false);
    expect(isTerminalVerdict('')).toBe(false);
    expect(isTerminalVerdict(0)).toBe(false);
    expect(isTerminalVerdict(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Human-activity TTL math
// ---------------------------------------------------------------------------

describe('human-activity TTL math', () => {
  it('collision window: activity within window → skip', () => {
    const nowMs = 1_000_000_000_000;
    const recentActivity = new Date(nowMs - 10 * 60_000); // 10 minutes ago
    expect(isHumanActivityTooRecent(recentActivity, 30, nowMs)).toBe(true);
  });

  it('collision window: activity outside window → proceed', () => {
    const nowMs = 1_000_000_000_000;
    const oldActivity = new Date(nowMs - 60 * 60_000); // 60 minutes ago
    expect(isHumanActivityTooRecent(oldActivity, 30, nowMs)).toBe(false);
  });

  it('null activity → never skip (no human present)', () => {
    expect(isHumanActivityTooRecent(null, 30, Date.now())).toBe(false);
  });

  it('minutesSinceHumanActivity returns correct elapsed time', () => {
    const nowMs = 2_000_000_000_000;
    const twentyMinutesAgo = new Date(nowMs - 20 * 60_000);
    const elapsed = minutesSinceHumanActivity(twentyMinutesAgo, nowMs);
    expect(elapsed).toBeCloseTo(20, 0);
  });

  it('minutesSinceHumanActivity returns null for null input', () => {
    expect(minutesSinceHumanActivity(null, Date.now())).toBeNull();
  });
});
