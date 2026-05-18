import { describe, it, expect } from 'vitest';
import {
  expectedVerdictForTag,
  detectRollback,
} from '../amendmentRegressionReplayJobPure.js';
import type { ReplayOutcome } from '../amendmentRegressionReplayJobPure.js';

describe('expectedVerdictForTag', () => {
  it('returns pass for fix_proposed', () => {
    expect(expectedVerdictForTag('fix_proposed')).toBe('pass');
  });

  it('returns fail for fix_wrong', () => {
    expect(expectedVerdictForTag('fix_wrong')).toBe('fail');
  });

  it('returns skip for unresolved', () => {
    expect(expectedVerdictForTag('unresolved')).toBe('skip');
  });
});

describe('detectRollback', () => {
  it('returns rollback false when all fix_proposed cases pass', () => {
    const outcomes: ReplayOutcome[] = [
      { caseId: 'a', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'pass' },
      { caseId: 'b', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'pass' },
    ];
    expect(detectRollback(outcomes)).toEqual({ rollback: false });
  });

  it('returns rollback true when a fix_proposed case fails', () => {
    const outcomes: ReplayOutcome[] = [
      { caseId: 'a', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'pass' },
      { caseId: 'b', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'fail' },
      { caseId: 'c', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'fail' },
    ];
    const result = detectRollback(outcomes);
    expect(result.rollback).toBe(true);
    if (result.rollback) {
      expect(result.reason).toBe('fix_proposed_regressed');
      expect(result.offendingCaseIds).toEqual(['b', 'c']);
    }
  });

  it('does NOT trigger rollback for fix_wrong cases even when they unexpectedly pass', () => {
    const outcomes: ReplayOutcome[] = [
      { caseId: 'a', tag: 'fix_wrong', expectedVerdict: 'fail', actualVerdict: 'pass' },
      { caseId: 'b', tag: 'fix_wrong', expectedVerdict: 'fail', actualVerdict: 'fail' },
    ];
    expect(detectRollback(outcomes)).toEqual({ rollback: false });
  });

  it('triggers rollback for inconclusive outcomes on fix_proposed (conservative posture)', () => {
    const outcomes: ReplayOutcome[] = [
      { caseId: 'a', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'inconclusive' },
    ];
    const result = detectRollback(outcomes);
    expect(result.rollback).toBe(true);
    if (result.rollback) {
      expect(result.reason).toBe('fix_proposed_regressed');
      expect(result.offendingCaseIds).toEqual(['a']);
    }
  });

  it('returns rollback false for empty outcomes', () => {
    expect(detectRollback([])).toEqual({ rollback: false });
  });

  it('identifies only the specific offending fix_proposed cases in mixed outcomes', () => {
    const outcomes: ReplayOutcome[] = [
      { caseId: 'pass-case', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'pass' },
      { caseId: 'fail-case', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'fail' },
      { caseId: 'fix-wrong-case', tag: 'fix_wrong', expectedVerdict: 'fail', actualVerdict: 'pass' },
      { caseId: 'inconclusive-case', tag: 'fix_proposed', expectedVerdict: 'pass', actualVerdict: 'inconclusive' },
    ];
    const result = detectRollback(outcomes);
    expect(result.rollback).toBe(true);
    if (result.rollback) {
      expect(result.offendingCaseIds).toEqual(['fail-case', 'inconclusive-case']);
    }
  });
});
