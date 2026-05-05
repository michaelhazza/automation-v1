// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * stripeAgentReconciliationPollJobPure.test.ts
 *
 * Tests pure helper functions for the Stripe agent reconciliation poll job.
 * Covers: cutoff math (30-min threshold), candidate-row selection,
 * and Stripe charge status mapping.
 *
 * Run via: npx vitest run server/jobs/__tests__/stripeAgentReconciliationPollJobPure.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  deriveReconciliationCutoff,
  decideReconciliationPoll,
  mapStripeChargeStatusToTarget,
  RECONCILIATION_POLL_THRESHOLD_MS,
  type ExecutedCandidateRow,
} from '../stripeAgentReconciliationPollJobPure.js';

// ---------------------------------------------------------------------------
// § 1. deriveReconciliationCutoff
// ---------------------------------------------------------------------------

describe('deriveReconciliationCutoff', () => {
  it('cutoff is jobRunAt minus threshold (30 minutes by default)', () => {
    const jobRunAt = new Date('2026-05-03T12:00:00.000Z');
    const cutoff = deriveReconciliationCutoff(jobRunAt);
    const expected = new Date(jobRunAt.getTime() - RECONCILIATION_POLL_THRESHOLD_MS);
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('RECONCILIATION_POLL_THRESHOLD_MS is 30 minutes', () => {
    expect(RECONCILIATION_POLL_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });

  it('uses supplied thresholdMs when provided', () => {
    const jobRunAt = new Date('2026-05-03T12:00:00.000Z');
    const customThresholdMs = 60 * 60 * 1000; // 60 minutes
    const cutoff = deriveReconciliationCutoff(jobRunAt, customThresholdMs);
    expect(cutoff.getTime()).toBe(jobRunAt.getTime() - customThresholdMs);
  });

  it('does not mutate the input date', () => {
    const jobRunAt = new Date('2026-05-03T12:00:00.000Z');
    const original = jobRunAt.getTime();
    deriveReconciliationCutoff(jobRunAt);
    expect(jobRunAt.getTime()).toBe(original);
  });

  it('cutoff is 30 minutes in the past relative to now', () => {
    const now = new Date();
    const cutoff = deriveReconciliationCutoff(now);
    const diffMs = now.getTime() - cutoff.getTime();
    expect(diffMs).toBe(RECONCILIATION_POLL_THRESHOLD_MS);
  });
});

// ---------------------------------------------------------------------------
// § 2. decideReconciliationPoll — executed rows past threshold
// ---------------------------------------------------------------------------

describe('decideReconciliationPoll — candidate selection', () => {
  const cutoff = new Date('2026-05-03T11:30:00.000Z'); // 30 min before noon

  it('executed row with executedAt 31 min ago is a poll candidate', () => {
    const row: ExecutedCandidateRow = {
      id: 'charge-1',
      status: 'executed',
      executedAt: new Date('2026-05-03T11:28:00.000Z'), // 2 min before cutoff
      providerChargeId: 'ch_abc123',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(true);
    expect(decision.reason).toBe('past_threshold');
    expect(decision.chargeId).toBe('charge-1');
  });

  it('executed row with executedAt exactly at cutoff is NOT a poll candidate', () => {
    const row: ExecutedCandidateRow = {
      id: 'charge-2',
      status: 'executed',
      executedAt: new Date(cutoff.getTime()),
      providerChargeId: 'ch_abc456',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toBe('not_old_enough');
  });

  it('executed row with executedAt 1ms after cutoff is NOT a poll candidate', () => {
    const row: ExecutedCandidateRow = {
      id: 'charge-3',
      status: 'executed',
      executedAt: new Date(cutoff.getTime() + 1),
      providerChargeId: 'ch_abc789',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toBe('not_old_enough');
  });

  it('executed row with executedAt 1ms before cutoff IS a poll candidate', () => {
    const row: ExecutedCandidateRow = {
      id: 'charge-4',
      status: 'executed',
      executedAt: new Date(cutoff.getTime() - 1),
      providerChargeId: 'ch_abcdef',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(true);
    expect(decision.reason).toBe('past_threshold');
  });
});

// ---------------------------------------------------------------------------
// § 3. decideReconciliationPoll — non-executed rows excluded
// ---------------------------------------------------------------------------

describe('decideReconciliationPoll — non-executed rows are excluded', () => {
  const cutoff = new Date('2026-05-03T11:30:00.000Z');
  const oldExecutedAt = new Date('2026-05-03T10:00:00.000Z'); // well past threshold
  const statuses = ['succeeded', 'failed', 'proposed', 'approved', 'blocked', 'denied', 'refunded', 'disputed', 'shadow_settled', 'pending_approval'];

  for (const status of statuses) {
    it(`${status} row is excluded (reason: not_executed)`, () => {
      const row: ExecutedCandidateRow = {
        id: `charge-${status}`,
        status,
        executedAt: oldExecutedAt,
        providerChargeId: 'ch_abc123',
        organisationId: 'org-1',
        subaccountId: null,
      };
      const decision = decideReconciliationPoll(row, cutoff);
      expect(decision.shouldPoll).toBe(false);
      expect(decision.reason).toBe('not_executed');
    });
  }
});

// ---------------------------------------------------------------------------
// § 4. decideReconciliationPoll — missing provider_charge_id
// ---------------------------------------------------------------------------

describe('decideReconciliationPoll — missing provider_charge_id', () => {
  it('executed row with null providerChargeId is excluded', () => {
    const cutoff = new Date('2026-05-03T11:30:00.000Z');
    const row: ExecutedCandidateRow = {
      id: 'charge-no-id',
      status: 'executed',
      executedAt: new Date('2026-05-03T10:00:00.000Z'),
      providerChargeId: null,
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toBe('missing_provider_id');
  });
});

// ---------------------------------------------------------------------------
// § 5. decideReconciliationPoll — null executedAt
// ---------------------------------------------------------------------------

describe('decideReconciliationPoll — null executedAt', () => {
  it('executed row with null executedAt is excluded (cannot determine age)', () => {
    const cutoff = new Date('2026-05-03T11:30:00.000Z');
    const row: ExecutedCandidateRow = {
      id: 'charge-no-ts',
      status: 'executed',
      executedAt: null,
      providerChargeId: 'ch_abc123',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toBe('not_old_enough');
  });
});

// ---------------------------------------------------------------------------
// § 6. mapStripeChargeStatusToTarget
// ---------------------------------------------------------------------------

describe('mapStripeChargeStatusToTarget', () => {
  it('"succeeded" maps to succeeded', () => {
    expect(mapStripeChargeStatusToTarget('succeeded')).toBe('succeeded');
  });

  it('"failed" maps to failed', () => {
    expect(mapStripeChargeStatusToTarget('failed')).toBe('failed');
  });

  it('"pending" returns null (no transition yet)', () => {
    expect(mapStripeChargeStatusToTarget('pending')).toBeNull();
  });

  it('unrecognised status returns null', () => {
    expect(mapStripeChargeStatusToTarget('unknown_status')).toBeNull();
  });

  it('"requires_action" returns null', () => {
    expect(mapStripeChargeStatusToTarget('requires_action')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// § 7. Threshold boundary math — 30 min window
// ---------------------------------------------------------------------------

describe('30-minute threshold boundary', () => {
  it('row executed exactly 30 minutes ago is NOT eligible (boundary is exclusive)', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');
    const cutoff = deriveReconciliationCutoff(now); // 11:30:00
    const row: ExecutedCandidateRow = {
      id: 'charge-boundary',
      status: 'executed',
      executedAt: new Date('2026-05-04T11:30:00.000Z'), // exactly at cutoff
      providerChargeId: 'ch_boundary',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toBe('not_old_enough');
  });

  it('row executed 30 minutes + 1ms ago IS eligible', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');
    const cutoff = deriveReconciliationCutoff(now); // 11:30:00
    const row: ExecutedCandidateRow = {
      id: 'charge-just-past',
      status: 'executed',
      executedAt: new Date(cutoff.getTime() - 1), // 1ms before cutoff
      providerChargeId: 'ch_past',
      organisationId: 'org-1',
      subaccountId: null,
    };
    const decision = decideReconciliationPoll(row, cutoff);
    expect(decision.shouldPoll).toBe(true);
    expect(decision.reason).toBe('past_threshold');
  });
});
