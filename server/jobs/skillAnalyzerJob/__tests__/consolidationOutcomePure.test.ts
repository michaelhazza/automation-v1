import { describe, expect, it } from 'vitest';
import { classifyConsolidationOutcome } from '../consolidationOutcomePure.js';

describe('classifyConsolidationOutcome', () => {
  it('returns failed/not_shortened when postWords >= preWords (protocol violation)', () => {
    expect(classifyConsolidationOutcome(100, 100)).toEqual({
      outcome: 'failed',
      failureReason: 'not_shortened',
      preWords: 100,
      postWords: 100,
    });
    expect(classifyConsolidationOutcome(100, 120)).toEqual({
      outcome: 'failed',
      failureReason: 'not_shortened',
      preWords: 100,
      postWords: 120,
    });
  });

  it('returns succeeded with rounded reductionPct when postWords < preWords', () => {
    expect(classifyConsolidationOutcome(100, 80)).toEqual({
      outcome: 'succeeded',
      preWords: 100,
      postWords: 80,
      reductionPct: 20,
    });
    expect(classifyConsolidationOutcome(100, 67)).toEqual({
      outcome: 'succeeded',
      preWords: 100,
      postWords: 67,
      reductionPct: 33,
    });
  });

  it('handles preWords === 0 without divide-by-zero', () => {
    expect(classifyConsolidationOutcome(0, 0)).toEqual({
      outcome: 'failed',
      failureReason: 'not_shortened',
      preWords: 0,
      postWords: 0,
    });
  });

  it('exercises the preWords === 0 succeeded branch (reductionPct: 0 guard)', () => {
    // Reaches the `preWords > 0 ? ... : 0` branch with preWords === 0
    // and postWords < preWords. The arithmetic is unreachable in
    // production (the caller filters non-positive preWords upstream)
    // but the guard exists, so pin it.
    expect(classifyConsolidationOutcome(0, -1)).toEqual({
      outcome: 'succeeded',
      preWords: 0,
      postWords: -1,
      reductionPct: 0,
    });
  });
});
