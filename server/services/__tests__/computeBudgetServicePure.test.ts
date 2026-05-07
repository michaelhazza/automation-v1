/**
 * computeBudgetServicePure.test.ts — Pure-unit tests for the Compute Budget
 * pure helpers.
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §2 (vocabulary lock),
 * plan §4 Chunk 1 (pure extraction).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/computeBudgetServicePure.test.ts
 */
import { expect, test } from 'vitest';
import {
  projectCostCents,
  compareToLimit,
  ComputeBudgetExceededError,
  isComputeBudgetExceededError,
} from '../computeBudgetServicePure.js';

// --- projectCostCents ---

test('projectCostCents: zero delta leaves current unchanged', () => {
  expect(projectCostCents(500, 0)).toBe(500);
});

test('projectCostCents: adds delta to current', () => {
  expect(projectCostCents(300, 200)).toBe(500);
});

test('projectCostCents: both zero yields zero', () => {
  expect(projectCostCents(0, 0)).toBe(0);
});

// --- compareToLimit ---

test('compareToLimit: within when projected < limit', () => {
  expect(compareToLimit(80, 100)).toBe('within');
});

test('compareToLimit: within when projected equals limit', () => {
  expect(compareToLimit(100, 100)).toBe('within');
});

test('compareToLimit: exceeded when projected > limit', () => {
  expect(compareToLimit(101, 100)).toBe('exceeded');
});

test('compareToLimit: zero limit means no cap — always within', () => {
  expect(compareToLimit(99999, 0)).toBe('within');
});

test('compareToLimit: large numbers', () => {
  expect(compareToLimit(1_000_001, 1_000_000)).toBe('exceeded');
  expect(compareToLimit(1_000_000, 1_000_000)).toBe('within');
});

// --- ComputeBudgetExceededError ---

test('ComputeBudgetExceededError: has correct name and code', () => {
  const err = new ComputeBudgetExceededError('monthly_org', 10000, 10001, 'org-1');
  expect(err.name).toBe('ComputeBudgetExceededError');
  expect(err.code).toBe('COMPUTE_BUDGET_EXCEEDED');
  expect(err).toBeInstanceOf(ComputeBudgetExceededError);
  expect(err).toBeInstanceOf(Error);
});

test('ComputeBudgetExceededError: stores fields correctly', () => {
  const err = new ComputeBudgetExceededError('run_cost', 500, 600, 'run-abc');
  expect(err.limitType).toBe('run_cost');
  expect(err.limitCents).toBe(500);
  expect(err.projectedCents).toBe(600);
  expect(err.entityId).toBe('run-abc');
});

test('ComputeBudgetExceededError: message contains limit type and values', () => {
  const err = new ComputeBudgetExceededError('daily_subaccount', 200, 300, 'sub-1');
  expect(err.message).toContain('daily_subaccount');
  expect(err.message).toContain('200');
  expect(err.message).toContain('300');
});

// --- isComputeBudgetExceededError ---

test('isComputeBudgetExceededError: true for ComputeBudgetExceededError instance', () => {
  const err = new ComputeBudgetExceededError('run_cost', 100, 200, 'x');
  expect(isComputeBudgetExceededError(err)).toBe(true);
});

test('isComputeBudgetExceededError: true for plain-object 402 shape with correct code', () => {
  const shape = { statusCode: 402, code: 'COMPUTE_BUDGET_EXCEEDED' };
  expect(isComputeBudgetExceededError(shape)).toBe(true);
});

test('isComputeBudgetExceededError: false for 402 with wrong code', () => {
  const shape = { statusCode: 402, code: 'RATE_LIMITED' };
  expect(isComputeBudgetExceededError(shape)).toBe(false);
});

test('isComputeBudgetExceededError: false for non-budget error', () => {
  expect(isComputeBudgetExceededError(new Error('something else'))).toBe(false);
});

test('isComputeBudgetExceededError: false for null', () => {
  expect(isComputeBudgetExceededError(null)).toBe(false);
});

test('isComputeBudgetExceededError: false for undefined', () => {
  expect(isComputeBudgetExceededError(undefined)).toBe(false);
});

// ── Govern pace helpers (spec §4.11) ─────────────────────────────────────────

import { describe, it } from 'vitest';
import {
  projectPaceCents,
  computePeriodResetAt,
  daysRemainingInPeriod,
  classifyPace,
} from '../computeBudgetServicePure.js';

describe('Govern pace helpers (spec §4.11)', () => {
  describe('projectPaceCents', () => {
    it('projects spend: 1200¢ MTD, 2100¢ over 7 days, 18 remaining → 6600¢', () => {
      // dailyRate = 2100/7 = 300. projection = 1200 + 300*18 = 6600
      expect(projectPaceCents(1200, 2100, 7, 18)).toBe(6600);
    });
    it('daysElapsedInWindow <= 0 → returns currentMtdCents', () => {
      expect(projectPaceCents(5000, 100, 0, 10)).toBe(5000);
      expect(projectPaceCents(5000, 100, -1, 10)).toBe(5000);
    });
    it('daysRemaining <= 0 → returns currentMtdCents (period ends today)', () => {
      expect(projectPaceCents(5000, 100, 7, 0)).toBe(5000);
    });
  });

  describe('computePeriodResetAt', () => {
    it('returns first instant of next UTC calendar month', () => {
      const result = computePeriodResetAt(new Date('2026-05-15T10:00:00.000Z'));
      expect(result.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });
    it('handles December → January roll', () => {
      const result = computePeriodResetAt(new Date('2026-12-20T00:00:00.000Z'));
      expect(result.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  describe('daysRemainingInPeriod', () => {
    it('returns positive days remaining mid-month', () => {
      const days = daysRemainingInPeriod(new Date('2026-05-15T00:00:00.000Z'));
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThan(31);
    });
    it('returns close to 0 at end of month — last millisecond of May returns 1', () => {
      const days = daysRemainingInPeriod(new Date('2026-05-31T23:59:59.999Z'));
      expect(days).toBe(1);
    });
  });

  describe('classifyPace', () => {
    it('cap <= 0 → on_track (unbounded)', () => {
      expect(classifyPace(99999, 0)).toBe('on_track');
      expect(classifyPace(99999, -1)).toBe('on_track');
    });
    it('projected <= 80% of cap → on_track', () => {
      expect(classifyPace(800, 1000)).toBe('on_track');
    });
    it('80% < projected <= 100% of cap → warning', () => {
      expect(classifyPace(900, 1000)).toBe('warning');
      expect(classifyPace(1000, 1000)).toBe('warning');
    });
    it('projected > 100% of cap → over', () => {
      expect(classifyPace(1001, 1000)).toBe('over');
    });
  });
});
