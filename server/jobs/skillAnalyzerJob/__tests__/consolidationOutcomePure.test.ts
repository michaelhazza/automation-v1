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
});
