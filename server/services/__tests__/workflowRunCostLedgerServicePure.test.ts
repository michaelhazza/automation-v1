import { describe, it, expect } from 'vitest';
import { computeAccumulatorDelta } from '../workflowRunCostLedgerServicePure.js';

describe('computeAccumulatorDelta', () => {
  describe('positive delta', () => {
    it('increments the accumulator by the delta', () => {
      const result = computeAccumulatorDelta(100, 50);
      expect(result.newCents).toBe(150);
      expect(result.shouldWrite).toBe(true);
    });

    it('works when currentCents is 0', () => {
      const result = computeAccumulatorDelta(0, 25);
      expect(result.newCents).toBe(25);
      expect(result.shouldWrite).toBe(true);
    });

    it('works with a large delta', () => {
      const result = computeAccumulatorDelta(1_000_000, 999_999);
      expect(result.newCents).toBe(1_999_999);
      expect(result.shouldWrite).toBe(true);
    });
  });

  describe('zero delta — no-op', () => {
    it('returns shouldWrite: false and leaves currentCents unchanged', () => {
      const result = computeAccumulatorDelta(100, 0);
      expect(result.shouldWrite).toBe(false);
      expect(result.newCents).toBe(100);
    });

    it('works when currentCents is also 0', () => {
      const result = computeAccumulatorDelta(0, 0);
      expect(result.shouldWrite).toBe(false);
      expect(result.newCents).toBe(0);
    });
  });

  describe('negative delta — defensive no-op', () => {
    it('returns shouldWrite: false and leaves currentCents unchanged for -1', () => {
      const result = computeAccumulatorDelta(100, -1);
      expect(result.shouldWrite).toBe(false);
      expect(result.newCents).toBe(100);
    });

    it('returns shouldWrite: false for a large negative delta', () => {
      const result = computeAccumulatorDelta(500, -200);
      expect(result.shouldWrite).toBe(false);
      expect(result.newCents).toBe(500);
    });
  });
});
