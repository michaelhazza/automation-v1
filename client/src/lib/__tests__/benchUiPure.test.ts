// client/src/lib/__tests__/benchUiPure.test.ts
// Unit tests for benchUiPure helpers.
// Trust & Verification Layer spec §12.4 test considerations.

import { describe, it, expect } from 'vitest';
import {
  formatCostEstimate,
  formatVerdict,
  riskPillClass,
  riskLabel,
  benchStateLabel,
  verdictPassRate,
  formatPassRate,
} from '../benchUiPure';

describe('formatCostEstimate', () => {
  it('formats zero cents as < $0.01', () => {
    expect(formatCostEstimate(0)).toBe('< $0.01');
  });

  it('formats sub-cent as < $0.01', () => {
    expect(formatCostEstimate(0.5)).toBe('< $0.01');
  });

  it('formats 100 cents as $1.00', () => {
    expect(formatCostEstimate(100)).toBe('$1.00');
  });

  it('formats 1234 cents as $12.34', () => {
    expect(formatCostEstimate(1234)).toBe('$12.34');
  });

  it('returns — for null', () => {
    expect(formatCostEstimate(null)).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatCostEstimate(undefined)).toBe('—');
  });
});

describe('formatVerdict', () => {
  it('formats pass', () => {
    expect(formatVerdict('pass')).toBe('Pass');
  });

  it('formats fail', () => {
    expect(formatVerdict('fail')).toBe('Fail');
  });

  it('formats inconclusive', () => {
    expect(formatVerdict('inconclusive')).toBe('Inconclusive');
  });

  it('formats error', () => {
    expect(formatVerdict('error')).toBe('Error');
  });

  it('returns — for null', () => {
    expect(formatVerdict(null)).toBe('—');
  });

  it('passes through unknown values', () => {
    expect(formatVerdict('custom_state')).toBe('custom_state');
  });
});

describe('riskPillClass', () => {
  it('returns green classes for low', () => {
    expect(riskPillClass('low')).toContain('green');
  });

  it('returns amber classes for medium', () => {
    expect(riskPillClass('medium')).toContain('amber');
  });

  it('returns red classes for high', () => {
    expect(riskPillClass('high')).toContain('red');
  });

  it('returns slate classes for null', () => {
    expect(riskPillClass(null)).toContain('slate');
  });
});

describe('riskLabel', () => {
  it('labels low', () => {
    expect(riskLabel('low')).toBe('Low risk');
  });

  it('labels medium', () => {
    expect(riskLabel('medium')).toBe('Medium risk');
  });

  it('labels high', () => {
    expect(riskLabel('high')).toBe('High risk');
  });

  it('returns Unknown for null', () => {
    expect(riskLabel(null)).toBe('Unknown');
  });
});

describe('benchStateLabel', () => {
  it('labels awaiting_confirm', () => {
    expect(benchStateLabel('awaiting_confirm')).toBe('Awaiting confirmation');
  });

  it('labels running', () => {
    expect(benchStateLabel('running')).toBe('Running');
  });

  it('labels awaiting_approval', () => {
    expect(benchStateLabel('awaiting_approval')).toBe('Awaiting approval');
  });

  it('labels completed', () => {
    expect(benchStateLabel('completed')).toBe('Completed');
  });

  it('labels failed', () => {
    expect(benchStateLabel('failed')).toBe('Failed');
  });

  it('returns — for null', () => {
    expect(benchStateLabel(null)).toBe('—');
  });

  it('passes through unknown state', () => {
    expect(benchStateLabel('pending')).toBe('pending');
  });
});

describe('verdictPassRate', () => {
  const results = [
    { candidateModelId: 'claude-opus', verdict: 'pass' },
    { candidateModelId: 'claude-opus', verdict: 'pass' },
    { candidateModelId: 'claude-opus', verdict: 'fail' },
    { candidateModelId: 'gpt-4', verdict: 'pass' },
  ];

  it('computes pass rate correctly', () => {
    expect(verdictPassRate(results, 'claude-opus')).toBeCloseTo(2 / 3);
  });

  it('returns 0 for empty candidate', () => {
    expect(verdictPassRate(results, 'unknown-model')).toBe(0);
  });

  it('returns 1.0 when all pass', () => {
    expect(verdictPassRate(results, 'gpt-4')).toBe(1);
  });
});

describe('formatPassRate', () => {
  it('formats 0.666 as 67%', () => {
    expect(formatPassRate(2 / 3)).toBe('67%');
  });

  it('formats 1 as 100%', () => {
    expect(formatPassRate(1)).toBe('100%');
  });

  it('formats 0 as 0%', () => {
    expect(formatPassRate(0)).toBe('0%');
  });
});
