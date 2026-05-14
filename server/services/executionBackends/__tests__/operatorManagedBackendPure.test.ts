import { describe, expect, it } from 'vitest';

import {
  classifyChainLinkFailure,
  decideChainResumeOutcome,
  deriveCredentialStartMode,
  derivePredecessorAllowList,
} from '../operatorManagedBackendPure.js';

describe('classifyChainLinkFailure', () => {
  describe("kind: 'start' — pending-state failures", () => {
    it('classifies a transient start failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'transient',
        failureReason: 'connection_timeout',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('transient');
      expect(result.failure_reason).toBe('connection_timeout');
    });

    it('classifies a session_unavailable start failure as permanent failure_class', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'session_unavailable',
        failureReason: 'OPERATOR_SESSION_UNAVAILABLE',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('permanent');
    });

    it('classifies an auth start failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'auth',
        failureReason: 'auth_expired',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('auth');
    });

    it('classifies a concurrency start failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'concurrency',
        failureReason: 'OPERATOR_SESSION_LIMIT_EXCEEDED',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('concurrency');
    });

    it('classifies a budget start failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'budget',
        failureReason: 'budget_cap_exceeded',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('budget');
    });

    it('classifies a profile_corruption start failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'pending',
        failedMidStep: false,
        errorClass: 'profile_corruption',
        failureReason: 'OPERATOR_PROFILE_UNRECOVERABLE',
      });
      expect(result.kind).toBe('start');
      expect(result.failure_class).toBe('profile_corruption');
    });
  });

  describe("kind: 'hard_cap_unresumable' — running state with failedMidStep=true", () => {
    it('classifies hard_cap_unresumable as permanent with no counter increment', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'running',
        failedMidStep: true,
        errorClass: 'transient',
        failureReason: 'hard_cap_unresumable',
      });
      expect(result.kind).toBe('hard_cap_unresumable');
      expect(result.failure_class).toBe('permanent');
    });

    it('classifies hard_cap_unresumable regardless of errorClass', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'running',
        failedMidStep: true,
        errorClass: 'session_unavailable',
        failureReason: 'hard_cap_unresumable',
      });
      expect(result.kind).toBe('hard_cap_unresumable');
      expect(result.failure_class).toBe('permanent');
    });
  });

  describe("kind: 'runtime' — running state without failedMidStep", () => {
    it('classifies a permanent runtime failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'running',
        failedMidStep: false,
        errorClass: 'permanent',
        failureReason: 'operator_runtime_crash',
      });
      expect(result.kind).toBe('runtime');
      expect(result.failure_class).toBe('permanent');
    });

    it('classifies a transient runtime failure', () => {
      const result = classifyChainLinkFailure({
        operatorRunStatus: 'running',
        failedMidStep: false,
        errorClass: 'transient',
        failureReason: 'heartbeat_stale',
      });
      expect(result.kind).toBe('runtime');
      expect(result.failure_class).toBe('transient');
    });
  });
});

describe('decideChainResumeOutcome', () => {
  const baseSettings = {
    session_soft_cap_minutes: 120,
    auto_extend_grace_minutes: 30,
    max_chain_length: 50,
    max_wall_clock_per_task_days: 30,
    per_task_budget_cap_minutes: 6000,
    concurrent_operator_sessions_cap: 5,
  };

  it('returns task_terminal_cancelled for cancelled chain link', () => {
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

  it('returns task_paused_chain_failure for failed with failedMidStep=true', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'failed',
      hasCheckpoint: false,
      failedMidStep: true,
      chainSeq: 3,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 1,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_chain_failure');
    expect(result.failureReason).toBe('hard_cap_unresumable');
  });

  it('returns task_terminal_failed for failed with failedMidStep=false', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'failed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 3,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 1,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
  });

  it('returns task_paused_budget_exceeded when budget cap hit (branch 1)', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 5,
      settingsSnapshot: { ...baseSettings, per_task_budget_cap_minutes: 6000 },
      consumedBudgetMinutes: 6000,
      elapsedWallClockDays: 1,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_budget_exceeded');
    expect(result.failureReason).toBe('budget_cap_exceeded');
  });

  it('returns task_paused_wall_clock_exceeded when wall-clock cap hit (branch 2)', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 5,
      settingsSnapshot: { ...baseSettings, max_wall_clock_per_task_days: 30 },
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 30,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_wall_clock_exceeded');
    expect(result.failureReason).toBe('max_wall_clock_exceeded');
  });

  it('budget cap takes precedence over wall-clock cap (branch 1 first-match)', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 5,
      settingsSnapshot: {
        ...baseSettings,
        per_task_budget_cap_minutes: 6000,
        max_wall_clock_per_task_days: 30,
      },
      consumedBudgetMinutes: 6000,
      elapsedWallClockDays: 30,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_paused_budget_exceeded');
  });

  it('returns task_terminal_failed when max chain length reached (branch 3)', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 50,
      settingsSnapshot: { ...baseSettings, max_chain_length: 50 },
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 1,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
    expect(result.failureReason).toBe('max_chain_length_reached');
  });

  it('returns dispatch_next_chain_link when none of the caps are tripped (branch 4)', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: true,
      failedMidStep: false,
      chainSeq: 5,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 100,
      elapsedWallClockDays: 1,
      isTaskDone: false,
    });
    expect(result.action).toBe('dispatch_next_chain_link');
  });

  it('returns task_terminal_completed when completed with null checkpoint and task done', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 3,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 0,
      elapsedWallClockDays: 0,
      isTaskDone: true,
    });
    expect(result.action).toBe('task_terminal_completed');
  });

  it('returns task_terminal_failed when completed with null checkpoint and task NOT done', () => {
    const result = decideChainResumeOutcome({
      chainLinkStatus: 'completed',
      hasCheckpoint: false,
      failedMidStep: false,
      chainSeq: 3,
      settingsSnapshot: baseSettings,
      consumedBudgetMinutes: 0,
      elapsedWallClockDays: 0,
      isTaskDone: false,
    });
    expect(result.action).toBe('task_terminal_failed');
    expect(result.failureReason).toBe('checkpoint_signal_invalid');
  });
});

describe('deriveCredentialStartMode', () => {
  it('returns operator_session for first chain link (null prior)', () => {
    const result = deriveCredentialStartMode({
      priorChainLink: null,
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(result).toBe('operator_session');
  });

  it('returns operator_session when prior was operator_session mode', () => {
    const result = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'operator_session',
        linkBoundaryAt: new Date('2026-05-12T10:00:00Z'),
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(result).toBe('operator_session');
  });

  it('returns api_key when prior was api_key and no clearing signals', () => {
    const result = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: new Date('2026-05-12T10:00:00Z'),
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [],
    });
    expect(result).toBe('api_key');
  });

  it('clears stickiness when usability_restored fired after boundary', () => {
    const boundary = new Date('2026-05-12T10:00:00Z');
    const restoredAt = new Date('2026-05-12T11:00:00Z');
    const result = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: boundary,
      },
      usabilityRestoredSince: [restoredAt],
      credentialRefreshedSince: [],
    });
    expect(result).toBe('operator_session');
  });

  it('clears stickiness when credential_refreshed fired after boundary', () => {
    const boundary = new Date('2026-05-12T10:00:00Z');
    const refreshedAt = new Date('2026-05-12T12:00:00Z');
    const result = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: boundary,
      },
      usabilityRestoredSince: [],
      credentialRefreshedSince: [refreshedAt],
    });
    expect(result).toBe('operator_session');
  });

  it('does NOT clear stickiness when clearing signal is BEFORE boundary', () => {
    const boundary = new Date('2026-05-12T10:00:00Z');
    const restoredAt = new Date('2026-05-12T09:00:00Z'); // before boundary
    const result = deriveCredentialStartMode({
      priorChainLink: {
        credentialMode: 'api_key',
        linkBoundaryAt: boundary,
      },
      usabilityRestoredSince: [restoredAt],
      credentialRefreshedSince: [],
    });
    expect(result).toBe('api_key');
  });
});

describe('derivePredecessorAllowList', () => {
  it('bootstrap allows only pending', () => {
    const list = derivePredecessorAllowList('bootstrap');
    expect(list).toContain('pending');
    expect(list).not.toContain('cancelled');
  });

  it('continuation allows only paused_for_chain_continuation', () => {
    const list = derivePredecessorAllowList('continuation');
    expect(list).toContain('paused_for_chain_continuation');
    expect(list).not.toContain('cancelled');
  });

  it('retry allows only paused_chain_failure', () => {
    const list = derivePredecessorAllowList('retry');
    expect(list).toContain('paused_chain_failure');
    expect(list).not.toContain('cancelled');
  });

  it('budget_extension allows only paused_budget_exceeded', () => {
    const list = derivePredecessorAllowList('budget_extension');
    expect(list).toContain('paused_budget_exceeded');
    expect(list).not.toContain('cancelled');
  });

  it("'cancelled' is excluded from every predecessor set (cancel-vs-dispatch invariant)", () => {
    const reasons = ['bootstrap', 'continuation', 'retry', 'budget_extension'] as const;
    for (const reason of reasons) {
      const list = derivePredecessorAllowList(reason);
      expect(list, `${reason} must not allow 'cancelled'`).not.toContain('cancelled');
    }
  });

  it("'delegated' is excluded from every predecessor set", () => {
    const reasons = ['bootstrap', 'continuation', 'retry', 'budget_extension'] as const;
    for (const reason of reasons) {
      const list = derivePredecessorAllowList(reason);
      expect(list, `${reason} must not allow 'delegated'`).not.toContain('delegated');
    }
  });
});
