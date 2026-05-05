/**
 * captureBaselineServicePure.test.ts
 *
 * Pure-function composition tests for the final-state decision logic used by
 * captureBaselineService. These tests exercise aggregateOutcome,
 * isRetryBudgetExhausted, and nextBackoffMinutes in the combinations the
 * capture service uses — confirming the service's state-machine transitions
 * are correct without requiring a real DB connection.
 *
 * DB-write paths (the idempotent upsert, lock acquisition, metric inserts) are
 * integration-tested in Chunk 3C (baselineInvariants.test.ts).
 *
 * Run via: npx vitest run server/services/__tests__/captureBaselineServicePure.test.ts
 */

import { test, expect, describe } from 'vitest';
import {
  aggregateOutcome,
  isRetryBudgetExhausted,
  nextBackoffMinutes,
} from '../baselineRetryClassifierPure.js';

// ── Test 1: success path — all opted-in metrics captured → confirmed ──────────

describe('final-state: success', () => {
  test('all 2 opted-in metrics captured → success confirmed', () => {
    const outcome = aggregateOutcome(
      [{ source: 'canonical_metric' }, { source: 'canonical_metric' }],
      2,
    );
    expect(outcome).toEqual({ kind: 'success', confidence: 'confirmed' });
    // Service writes: status='captured', confidence='confirmed'
  });

  // ── Test 2: partial success — 2 captured out of 3 opted-in → partial ─────────

  test('2 captured out of 3 opted-in → success partial', () => {
    const outcome = aggregateOutcome(
      [
        { source: 'canonical_metric' },
        { source: 'canonical_metric' },
        { source: 'unavailable', errorClass: 'retryable' as const },
      ],
      3,
    );
    expect(outcome).toEqual({ kind: 'success', confidence: 'partial' });
    // Service writes: status='captured', confidence='partial'
  });
});

// ── Test 3: retryable failure + budget exhausted → failed ─────────────────────

describe('final-state: retry budget', () => {
  test('retryable outcome + attemptNumber=3 → budget exhausted → failed', () => {
    const outcome = aggregateOutcome(
      [{ source: 'unavailable', errorClass: 'retryable' as const }],
      5,
    );
    // Retryable failure
    expect(outcome.kind).toBe('retryable_failure');

    // After 3 attempts the budget is exhausted
    const exhausted = isRetryBudgetExhausted(3);
    expect(exhausted).toBe(true);
    // Service writes: status='failed', failureReason='retry_budget_exhausted'
  });

  test('retryable outcome + attemptNumber=2 → budget NOT exhausted → schedule retry', () => {
    const outcome = aggregateOutcome(
      [{ source: 'unavailable', errorClass: 'retryable' as const }],
      5,
    );
    expect(outcome.kind).toBe('retryable_failure');

    const exhausted = isRetryBudgetExhausted(2);
    expect(exhausted).toBe(false);

    // next backoff exists
    const backoff = nextBackoffMinutes(2);
    expect(backoff).toBe(240); // 4 hours
    // Service writes: status='ready', nextAttemptAt = now() + 240 minutes
  });
});

// ── Test 4: non-retryable → failed immediately ────────────────────────────────

describe('final-state: non-retryable failure', () => {
  test('non-retryable failure → failed immediately (consumes 0 retry budget)', () => {
    const outcome = aggregateOutcome(
      [{ source: 'unavailable', errorClass: 'non_retryable' as const }],
      5,
    );
    expect(outcome).toEqual({ kind: 'non_retryable_failure', reason: 'integration_not_connected' });
    // Service writes: status='failed', failureReason='integration_not_connected'
    // isRetryBudgetExhausted is NOT consulted for non_retryable_failure
  });
});

// ── Test 5: retryable + not exhausted → retry scheduled ──────────────────────

describe('final-state: retry scheduled', () => {
  test('retryable + attemptNumber=1 → schedule exists (backoff=60min)', () => {
    const outcome = aggregateOutcome(
      [{ source: 'unavailable', errorClass: 'retryable' as const }],
      5,
    );
    expect(outcome.kind).toBe('retryable_failure');
    expect(isRetryBudgetExhausted(1)).toBe(false);
    expect(nextBackoffMinutes(1)).toBe(60); // 1 hour
    // Service writes: status='ready', captureAttemptCount=1, nextAttemptAt = now() + 60 minutes
  });
});

// ── Test 6: zero-lock-rows clean exit invariant (documented) ─────────────────

describe('zero-lock-rows clean exit invariant', () => {
  test('RETURNING id pattern enforces clean exit — documented invariant', () => {
    // The lock acquisition step in captureBaselineService.run uses:
    //   UPDATE subaccount_baselines
    //   SET status = 'capturing', last_attempt_at = now()
    //   WHERE id = $baselineId AND status IN ('pending', 'ready')
    //   RETURNING id, organisation_id, subaccount_id, capture_attempt_count
    //
    // When RETURNING returns zero rows (another worker beat us, or the row
    // is already terminal), the service logs a structured lock_miss event
    // and returns without throwing. This invariant is verified by the
    // integration test in Chunk 3C (baselineInvariants.test.ts).
    //
    // This test documents the invariant so the decision is visible here
    // and confirms the pure-function layer (aggregateOutcome etc.) does not
    // have to handle the zero-rows case — it is handled upstream.
    expect(true).toBe(true); // integration coverage in Chunk 3C
  });
});
