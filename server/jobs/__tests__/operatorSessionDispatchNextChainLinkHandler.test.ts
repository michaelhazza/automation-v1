/**
 * operatorSessionDispatchNextChainLinkHandler.test.ts
 *
 * Tests the predecessor allow-list guard, cancel-vs-dispatch invariant,
 * and backoff retry counter logic.
 *
 * All tests are pure (no DB/network).
 */

import { describe, expect, it } from 'vitest';
import { derivePredecessorAllowList } from '../../services/executionBackends/operatorManagedBackendPure.js';
import type { DispatchReason } from '../../services/executionBackends/operatorManagedBackendPure.js';

// ---------------------------------------------------------------------------
// Pure helpers extracted from the handler
// ---------------------------------------------------------------------------

function shouldDispatch(input: {
  agentRunStatus: string;
  reason: DispatchReason;
}): { dispatch: boolean; reason: string } {
  const { agentRunStatus, reason } = input;

  if (agentRunStatus === 'cancelled') {
    return { dispatch: false, reason: 'cancelled_no_op' };
  }

  const allowed = derivePredecessorAllowList(reason);
  if (!allowed.includes(agentRunStatus)) {
    return { dispatch: false, reason: 'predecessor_mismatch' };
  }

  return { dispatch: true, reason: 'ok' };
}

const NON_RETRYABLE_FAILURE_REASONS = new Set([
  'OPERATOR_SESSION_UNAVAILABLE',
  'parent_orphaned',
  'profile_corruption',
  'OPERATOR_PROFILE_UNRECOVERABLE',
]);

function isNonRetryable(failureReason: string): boolean {
  return NON_RETRYABLE_FAILURE_REASONS.has(failureReason);
}

function computeBackoffSeconds(retryAttempt: number): number {
  const BACKOFF_SECONDS = [60, 300, 900] as const;
  return BACKOFF_SECONDS[retryAttempt - 1] ?? 900;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('predecessor allow-list guard', () => {
  it('bootstrap reason + pending status → dispatch', () => {
    const result = shouldDispatch({ agentRunStatus: 'pending', reason: 'bootstrap' });
    expect(result.dispatch).toBe(true);
  });

  it('continuation reason + paused_for_chain_continuation → dispatch', () => {
    const result = shouldDispatch({
      agentRunStatus: 'paused_for_chain_continuation',
      reason: 'continuation',
    });
    expect(result.dispatch).toBe(true);
  });

  it('continuation reason + pending → no-op (mismatch)', () => {
    const result = shouldDispatch({ agentRunStatus: 'pending', reason: 'continuation' });
    expect(result.dispatch).toBe(false);
    expect(result.reason).toBe('predecessor_mismatch');
  });

  it('retry reason + paused_chain_failure → dispatch', () => {
    const result = shouldDispatch({
      agentRunStatus: 'paused_chain_failure',
      reason: 'retry',
    });
    expect(result.dispatch).toBe(true);
  });

  it('budget_extension reason + paused_budget_exceeded → dispatch', () => {
    const result = shouldDispatch({
      agentRunStatus: 'paused_budget_exceeded',
      reason: 'budget_extension',
    });
    expect(result.dispatch).toBe(true);
  });
});

describe('cancel-vs-dispatch invariant', () => {
  it('cancelled status is no-op for every reason', () => {
    const reasons: DispatchReason[] = ['bootstrap', 'continuation', 'retry', 'budget_extension'];
    for (const reason of reasons) {
      const result = shouldDispatch({ agentRunStatus: 'cancelled', reason });
      expect(result.dispatch).toBe(false);
      expect(result.reason).toBe('cancelled_no_op');
    }
  });
});

describe('non-retryable failure reasons bypass retry', () => {
  it('OPERATOR_SESSION_UNAVAILABLE is non-retryable', () => {
    expect(isNonRetryable('OPERATOR_SESSION_UNAVAILABLE')).toBe(true);
  });

  it('profile_corruption is non-retryable', () => {
    expect(isNonRetryable('profile_corruption')).toBe(true);
  });

  it('OPERATOR_PROFILE_UNRECOVERABLE is non-retryable', () => {
    expect(isNonRetryable('OPERATOR_PROFILE_UNRECOVERABLE')).toBe(true);
  });

  it('parent_orphaned is non-retryable', () => {
    expect(isNonRetryable('parent_orphaned')).toBe(true);
  });

  it('transient errors are retryable', () => {
    expect(isNonRetryable('connection_timeout')).toBe(false);
    expect(isNonRetryable('sandbox_start_unknown')).toBe(false);
    expect(isNonRetryable('unknown_error')).toBe(false);
  });
});

describe('backoff retry schedule', () => {
  it('retry attempt 1 → 60 seconds', () => {
    expect(computeBackoffSeconds(1)).toBe(60);
  });

  it('retry attempt 2 → 300 seconds (5 min)', () => {
    expect(computeBackoffSeconds(2)).toBe(300);
  });

  it('retry attempt 3 → 900 seconds (15 min)', () => {
    expect(computeBackoffSeconds(3)).toBe(900);
  });

  it('retry attempt > 3 → 900 seconds (capped)', () => {
    expect(computeBackoffSeconds(4)).toBe(900);
    expect(computeBackoffSeconds(10)).toBe(900);
  });
});
