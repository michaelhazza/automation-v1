import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETENTION_HOURS,
  ADMIN_RETENTION_HOURS,
  GC_IN_PROGRESS_STALE_MS,
  deriveProfileRetentionWindow,
  isGcInProgressStale,
  validateProfileStatusTransition,
  deriveNextAttemptNumber,
} from '../operatorTaskProfileServicePure.js';
import { OperatorPureValidationError } from '../executionBackends/operatorManagedBackendPure.js';

describe('deriveProfileRetentionWindow', () => {
  it('returns default retention window of 48 hours when not admin-extended', () => {
    const taskTerminalAt = new Date('2026-05-12T16:00:00Z');
    const result = deriveProfileRetentionWindow(taskTerminalAt, false);
    const expectedMs = DEFAULT_RETENTION_HOURS * 60 * 60 * 1000;
    expect(result.getTime()).toBe(taskTerminalAt.getTime() + expectedMs);
  });

  it('returns admin retention window of 14 days when admin-extended', () => {
    const taskTerminalAt = new Date('2026-05-12T16:00:00Z');
    const result = deriveProfileRetentionWindow(taskTerminalAt, true);
    const expectedMs = ADMIN_RETENTION_HOURS * 60 * 60 * 1000;
    expect(result.getTime()).toBe(taskTerminalAt.getTime() + expectedMs);
  });

  it('default retention is 48h (not 14 days)', () => {
    expect(DEFAULT_RETENTION_HOURS).toBe(48);
  });

  it('admin retention is 14 days in hours', () => {
    expect(ADMIN_RETENTION_HOURS).toBe(14 * 24);
  });
});

describe('isGcInProgressStale', () => {
  it('returns true when gcStartedAt is more than 30 min ago', () => {
    const gcStartedAt = new Date('2026-05-12T10:00:00Z');
    const now = new Date('2026-05-12T10:31:00Z'); // 31 minutes later
    expect(isGcInProgressStale(gcStartedAt, now)).toBe(true);
  });

  it('returns false when gcStartedAt is within 30 min', () => {
    const gcStartedAt = new Date('2026-05-12T10:00:00Z');
    const now = new Date('2026-05-12T10:25:00Z'); // 25 minutes later
    expect(isGcInProgressStale(gcStartedAt, now)).toBe(false);
  });

  it('returns false at exactly 30 min (boundary)', () => {
    const gcStartedAt = new Date('2026-05-12T10:00:00Z');
    const now = new Date(gcStartedAt.getTime() + GC_IN_PROGRESS_STALE_MS);
    expect(isGcInProgressStale(gcStartedAt, now)).toBe(false);
  });
});

describe('validateProfileStatusTransition', () => {
  it('allows active → scheduled_gc', () => {
    expect(() => validateProfileStatusTransition('active', 'scheduled_gc')).not.toThrow();
  });

  it('allows scheduled_gc → gc_in_progress', () => {
    expect(() => validateProfileStatusTransition('scheduled_gc', 'gc_in_progress')).not.toThrow();
  });

  it('allows gc_in_progress → gc_done', () => {
    expect(() => validateProfileStatusTransition('gc_in_progress', 'gc_done')).not.toThrow();
  });

  it('allows gc_in_progress → scheduled_gc (stale reclaim)', () => {
    expect(() => validateProfileStatusTransition('gc_in_progress', 'scheduled_gc')).not.toThrow();
  });

  it('rejects active → gc_done (invalid jump)', () => {
    expect(() => validateProfileStatusTransition('active', 'gc_done')).toThrow(
      OperatorPureValidationError,
    );
  });

  it('rejects gc_done → active (reverse transition)', () => {
    expect(() => validateProfileStatusTransition('gc_done', 'active')).toThrow(
      OperatorPureValidationError,
    );
  });

  it('rejects gc_done → any (terminal state)', () => {
    const targets = ['active', 'scheduled_gc', 'gc_in_progress'] as const;
    for (const to of targets) {
      expect(() => validateProfileStatusTransition('gc_done', to)).toThrow(
        OperatorPureValidationError,
      );
    }
  });
});

describe('deriveNextAttemptNumber', () => {
  it('increments attempt number by 1', () => {
    expect(deriveNextAttemptNumber(1)).toBe(2);
    expect(deriveNextAttemptNumber(2)).toBe(3);
    expect(deriveNextAttemptNumber(5)).toBe(6);
  });

  it('throws on invalid attempt number (< 1)', () => {
    expect(() => deriveNextAttemptNumber(0)).toThrow(OperatorPureValidationError);
    expect(() => deriveNextAttemptNumber(-1)).toThrow(OperatorPureValidationError);
  });
});
