/**
 * operatorManagedBackendDispatch.test.ts — pure dispatch decision logic tests.
 *
 * Tests the pure decision-layer helpers that govern dispatch behaviour:
 * (a) concurrency-cap → LIMIT_EXCEEDED path
 * (b) subaccount mismatch assertion
 * (c) broker unavailable → fallback resolution
 * (d) fallback null → UNAVAILABLE chain-link failed
 * (e) dispatch-crash recovery: status='pending' AND vendor_session_id IS NULL
 * (f) adoption returns existing sandbox
 */

import { describe, expect, it } from 'vitest';

import {
  derivePredecessorAllowList,
  decideChainResumeOutcome,
  deriveCredentialStartMode,
} from '../operatorManagedBackendPure.js';
import { OperatorSessionLimitExceededError } from '../../operatorBackendErrors.js';

// ---------------------------------------------------------------------------
// (a) Concurrency cap: OperatorSessionLimitExceededError shape
// ---------------------------------------------------------------------------

describe('concurrency cap error', () => {
  it('constructs OperatorSessionLimitExceededError with correct fields', () => {
    const err = new OperatorSessionLimitExceededError({
      cap: 5,
      current: 5,
      subaccountId: 'sub-123',
    });
    expect(err.statusCode).toBe(429);
    expect(err.errorCode).toBe('operator_session_limit_exceeded');
    expect(err.cap).toBe(5);
    expect(err.current).toBe(5);
    expect(err.subaccountId).toBe('sub-123');
    expect(err instanceof OperatorSessionLimitExceededError).toBe(true);
  });

  it('cap < current still constructs correctly', () => {
    const err = new OperatorSessionLimitExceededError({
      cap: 3,
      current: 4,
      subaccountId: 'sub-456',
    });
    expect(err.cap).toBe(3);
    expect(err.current).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// (b) Subaccount mismatch — derivation via predecessor allow-list
// The adapter throws on mismatch; here we test the pure allowList helper
// that governs which states can reach the mismatch check.
// ---------------------------------------------------------------------------

describe('predecessor allow-list (dispatch reason gate)', () => {
  it('bootstrap allows only pending', () => {
    const allowed = derivePredecessorAllowList('bootstrap');
    expect(allowed).toContain('pending');
    expect(allowed).not.toContain('paused_chain_failure');
    expect(allowed).not.toContain('cancelled');
  });

  it('continuation allows only paused_for_chain_continuation', () => {
    const allowed = derivePredecessorAllowList('continuation');
    expect(allowed).toContain('paused_for_chain_continuation');
    expect(allowed).not.toContain('pending');
    expect(allowed).not.toContain('cancelled');
  });

  it('retry allows only paused_chain_failure', () => {
    const allowed = derivePredecessorAllowList('retry');
    expect(allowed).toContain('paused_chain_failure');
    expect(allowed).not.toContain('pending');
  });

  it('budget_extension allows only paused_budget_exceeded', () => {
    const allowed = derivePredecessorAllowList('budget_extension');
    expect(allowed).toContain('paused_budget_exceeded');
    expect(allowed).not.toContain('pending');
  });

  it('cancelled is excluded from every predecessor set', () => {
    const reasons = ['bootstrap', 'continuation', 'retry', 'budget_extension'] as const;
    for (const reason of reasons) {
      const allowed = derivePredecessorAllowList(reason);
      expect(allowed).not.toContain('cancelled');
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Broker unavailable → fallback path (deriveCredentialStartMode)
// ---------------------------------------------------------------------------

describe('credential start mode derivation (fallback stickiness)', () => {
  it('first link always returns operator_session', () => {
    const mode = deriveCredentialStartMode({
      priorChainLink: null,
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(mode).toBe('operator_session');
  });

  it('prior link in operator_session mode → next link operator_session', () => {
    const mode = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'operator_session',
        linkBoundaryAt: new Date('2026-05-01T00:00:00Z'),
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(mode).toBe('operator_session');
  });

  it('prior link in api_key with no clearing signals → sticky api_key', () => {
    const mode = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: new Date('2026-05-01T00:00:00Z'),
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(mode).toBe('api_key');
  });

  it('prior link api_key but usability_restored fired → clears stickiness', () => {
    const boundary = new Date('2026-05-01T00:00:00Z');
    const mode = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: boundary,
      },
      usabilityRestoredSince: [new Date('2026-05-01T01:00:00Z')],
      credentialRefreshedSince: [],
    });
    expect(mode).toBe('operator_session');
  });

  it('prior link api_key but credential_refreshed fired → clears stickiness', () => {
    const boundary = new Date('2026-05-01T00:00:00Z');
    const mode = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: boundary,
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [new Date('2026-05-01T02:00:00Z')],
    });
    expect(mode).toBe('operator_session');
  });
});

// ---------------------------------------------------------------------------
// (d) Fallback null → UNAVAILABLE — decideChainResumeOutcome covers failed
// ---------------------------------------------------------------------------

describe('decideChainResumeOutcome — failed chain link paths', () => {
  const baseSettings = {
    session_soft_cap_minutes: 120,
    auto_extend_grace_minutes: 30,
    max_chain_length: 20,
    max_wall_clock_per_task_days: 30,
    per_task_budget_cap_minutes: 2400,
    concurrent_operator_sessions_cap: 5,
  };

  it('failed with failedMidStep=false → task_terminal_failed', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'failed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 1,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 0,
      elapsedWallClockDays: 0,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
  });

  it('failed with failedMidStep=true → task_paused_chain_failure', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'failed',
      hasCheckpoint: false,
      failedMidStep: true,
      chainSeq: 1,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 0,
      elapsedWallClockDays: 0,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_chain_failure');
  });

  it('cancelled → task_terminal_cancelled', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'cancelled',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 1,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 0,
      elapsedWallClockDays: 0,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_cancelled');
  });
});

// ---------------------------------------------------------------------------
// (e/f) Dispatch-crash recovery: adoption returns existing sandbox
// These are integration-level; we test the pure decision shape here.
// ---------------------------------------------------------------------------

describe('chain-resume decision — dispatch_next_chain_link (adoption flow)', () => {
  const baseSettings = {
    session_soft_cap_minutes: 120,
    auto_extend_grace_minutes: 30,
    max_chain_length: 20,
    max_wall_clock_per_task_days: 30,
    per_task_budget_cap_minutes: 2400,
    concurrent_operator_sessions_cap: 5,
  };

  it('completed with checkpoint and caps not reached → dispatch_next_chain_link', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 2,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 240,
      elapsedWallClockDays: 0.5,
      isTaskDone: false,
    });
    expect(result.action).toBe('dispatch_next_chain_link');
  });

  it('completed with checkpoint but budget cap reached → task_paused_budget_exceeded', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 2,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 2400, // at cap
      elapsedWallClockDays: 0.5,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_budget_exceeded');
  });

  it('completed with checkpoint but max chain length reached → task_terminal_failed', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 20, // at max_chain_length
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 0.5,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
  });

  it('completed without checkpoint and isTaskDone=true → task_terminal_completed', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 1,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 0.1,
      isTaskDone: true,
    });
    expect(result.action).toBe('task_terminal_completed');
  });

  it('completed without checkpoint and isTaskDone=false → task_terminal_failed', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 1,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 0.1,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
    expect(result.failureReason).toBe('checkpoint_signal_invalid');
  });
});
