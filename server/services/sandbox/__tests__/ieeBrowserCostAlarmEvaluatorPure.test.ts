import { describe, it, expect } from 'vitest';
import {
  evaluateTaskCost,
  evaluateDailyCost,
} from '../ieeBrowserCostAlarmEvaluatorPure.js';

describe('evaluateTaskCost', () => {
  const baseCost = {
    agentRunId: 'run-abc',
    ieeRunId: 'iee-xyz',
    subaccountId: 'sub-1',
  };

  it('fires when cost > ceiling', () => {
    const result = evaluateTaskCost(
      { ...baseCost, costCents: 101 },
      { perTaskCostCeilingCents: 100 },
    );
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.payload.costCents).toBe(101);
      expect(result.payload.ceilingCents).toBe(100);
      expect(result.payload.agentRunId).toBe('run-abc');
      expect(result.payload.ieeRunId).toBe('iee-xyz');
      expect(result.payload.subaccountId).toBe('sub-1');
    }
  });

  it('does NOT fire when cost === ceiling (strict greater-than)', () => {
    const result = evaluateTaskCost(
      { ...baseCost, costCents: 100 },
      { perTaskCostCeilingCents: 100 },
    );
    expect(result.fire).toBe(false);
  });

  it('does NOT fire when cost < ceiling', () => {
    const result = evaluateTaskCost(
      { ...baseCost, costCents: 50 },
      { perTaskCostCeilingCents: 100 },
    );
    expect(result.fire).toBe(false);
  });
});

describe('evaluateDailyCost', () => {
  const baseRollup = {
    subaccountId: 'sub-2',
    dayUTC: '2026-05-13',
  };

  it('fires when spend > ceiling', () => {
    const result = evaluateDailyCost(
      { ...baseRollup, spendCents: 1001 },
      { perSubaccountDailyCostCeilingCents: 1000 },
    );
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.payload.spendCents).toBe(1001);
      expect(result.payload.ceilingCents).toBe(1000);
      expect(result.payload.subaccountId).toBe('sub-2');
      expect(result.payload.dayUTC).toBe('2026-05-13');
    }
  });

  it('does NOT fire when spend === ceiling (strict greater-than)', () => {
    const result = evaluateDailyCost(
      { ...baseRollup, spendCents: 1000 },
      { perSubaccountDailyCostCeilingCents: 1000 },
    );
    expect(result.fire).toBe(false);
  });

  it('does NOT fire when spend < ceiling', () => {
    const result = evaluateDailyCost(
      { ...baseRollup, spendCents: 500 },
      { perSubaccountDailyCostCeilingCents: 1000 },
    );
    expect(result.fire).toBe(false);
  });

  it('payload reflects the ceiling value at moment of evaluation (ceiling-change-mid-day)', () => {
    // Simulate the ceiling changing mid-day: provide a new ceiling value in settings.
    // The payload's ceilingCents must reflect the value passed in settings, not a stale one.
    const result = evaluateDailyCost(
      { ...baseRollup, spendCents: 2001 },
      { perSubaccountDailyCostCeilingCents: 2000 },
    );
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.payload.ceilingCents).toBe(2000);
      expect(result.payload.spendCents).toBe(2001);
    }
  });
});
