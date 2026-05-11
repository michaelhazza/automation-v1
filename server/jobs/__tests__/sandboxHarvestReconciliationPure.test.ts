import { describe, it, expect } from 'vitest';
import {
  isExecutionEligibleForReconciliation,
  nextReconciliationAttempt,
  RECONCILIATION_BUFFER_MS,
} from '../sandboxHarvestReconciliationPure.js';

const NOW = new Date('2026-05-11T10:00:00.000Z');

/** Build a row with a startedAt set so the wall-clock deadline has been exceeded. */
function pastDeadlineRow(
  status: string,
  wallClockMs: number,
  extraMs = 1_000,
) {
  const deadlineMs = wallClockMs + RECONCILIATION_BUFFER_MS;
  const startedAt = new Date(NOW.getTime() - deadlineMs - extraMs);
  return { status, startedAt, wallClockMs };
}

/** Build a row with a startedAt set so the wall-clock deadline has NOT been exceeded. */
function beforeDeadlineRow(
  status: string,
  wallClockMs: number,
  shortByMs = 1_000,
) {
  const deadlineMs = wallClockMs + RECONCILIATION_BUFFER_MS;
  const startedAt = new Date(NOW.getTime() - deadlineMs + shortByMs);
  return { status, startedAt, wallClockMs };
}

describe('isExecutionEligibleForReconciliation', () => {
  describe('stuck pre-terminal states', () => {
    for (const status of ['pending', 'running', 'harvesting'] as const) {
      it(`returns true for ${status} past deadline`, () => {
        const row = pastDeadlineRow(status, 60_000);
        expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(true);
      });

      it(`returns false for ${status} before deadline`, () => {
        const row = beforeDeadlineRow(status, 60_000);
        expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(false);
      });
    }
  });

  describe('terminal states', () => {
    const terminalStates = [
      'completed',
      'timed_out',
      'cost_ceiling_hit',
      'crashed',
      'output_validation_failed',
      'harvest_failed',
      'artefact_upload_failed',
      'provider_unavailable',
    ];

    for (const status of terminalStates) {
      it(`returns false for terminal state ${status} even past deadline`, () => {
        const row = pastDeadlineRow(status, 60_000);
        expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(false);
      });
    }
  });

  describe('null startedAt', () => {
    it('returns false when startedAt is null regardless of status', () => {
      const row = { status: 'running', startedAt: null, wallClockMs: 60_000 };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(false);
    });
  });

  describe('string startedAt', () => {
    it('accepts ISO 8601 string for startedAt', () => {
      const startedAtMs = NOW.getTime() - (60_000 + RECONCILIATION_BUFFER_MS + 1_000);
      const startedAt = new Date(startedAtMs).toISOString();
      const row = { status: 'running', startedAt, wallClockMs: 60_000 };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(true);
    });

    it('returns false for invalid date string', () => {
      const row = { status: 'running', startedAt: 'not-a-date', wallClockMs: 60_000 };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(false);
    });
  });

  describe('exact deadline boundary', () => {
    it('returns true when now exactly equals the deadline', () => {
      const wallClockMs = 60_000;
      const startedAt = new Date(NOW.getTime() - (wallClockMs + RECONCILIATION_BUFFER_MS));
      const row = { status: 'running', startedAt, wallClockMs };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(true);
    });

    it('returns false when 1ms before the deadline', () => {
      const wallClockMs = 60_000;
      const startedAt = new Date(NOW.getTime() - (wallClockMs + RECONCILIATION_BUFFER_MS) + 1);
      const row = { status: 'running', startedAt, wallClockMs };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(false);
    });
  });

  describe('zero wallClockMs', () => {
    it('returns true when wallClockMs is 0 and buffer elapsed', () => {
      const startedAt = new Date(NOW.getTime() - RECONCILIATION_BUFFER_MS - 1);
      const row = { status: 'running', startedAt, wallClockMs: 0 };
      expect(isExecutionEligibleForReconciliation(row, NOW)).toBe(true);
    });
  });
});

describe('nextReconciliationAttempt', () => {
  it('returns 1 for attempt 0', () => {
    expect(nextReconciliationAttempt(0)).toBe(1);
  });

  it('returns 2 for attempt 1', () => {
    expect(nextReconciliationAttempt(1)).toBe(2);
  });

  it('clamps negative input to 0 then increments', () => {
    expect(nextReconciliationAttempt(-5)).toBe(1);
  });

  it('handles large attempt counts', () => {
    expect(nextReconciliationAttempt(100)).toBe(101);
  });
});

describe('RECONCILIATION_BUFFER_MS', () => {
  it('equals 60 seconds', () => {
    expect(RECONCILIATION_BUFFER_MS).toBe(60_000);
  });
});
