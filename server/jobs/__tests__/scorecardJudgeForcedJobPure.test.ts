import { describe, it, expect } from 'vitest';
import { selectForcedGradeTargets } from '../../jobs/scorecardJudgeForcedJob.js';

const makeScorecard = (scorecardId: string, slugs: string[]) => ({
  scorecardId,
  qualityChecks: slugs.map(s => ({ slug: s, name: s })),
});

describe('selectForcedGradeTargets', () => {
  it('returns empty when blastRadius is self (no side-effects)', () => {
    const scorecards = [makeScorecard('sc-1', ['c1', 'c2'])];
    expect(selectForcedGradeTargets('self', 'fail', scorecards)).toHaveLength(0);
  });

  it('returns empty for state=pass regardless of blastRadius', () => {
    const scorecards = [makeScorecard('sc-1', ['c1'])];
    expect(selectForcedGradeTargets('tenant', 'pass', scorecards)).toHaveLength(0);
    expect(selectForcedGradeTargets('external', 'pass', scorecards)).toHaveLength(0);
  });

  it('returns empty for state=inconclusive regardless of blastRadius', () => {
    const scorecards = [makeScorecard('sc-1', ['c1'])];
    expect(selectForcedGradeTargets('tenant', 'inconclusive', scorecards)).toHaveLength(0);
    expect(selectForcedGradeTargets('external', 'inconclusive', scorecards)).toHaveLength(0);
  });

  it('returns empty for self + fail (self means no scoring needed)', () => {
    const scorecards = [makeScorecard('sc-1', ['c1', 'c2', 'c3'])];
    expect(selectForcedGradeTargets('self', 'fail', scorecards)).toHaveLength(0);
  });

  it('returns all (scorecardId, qualityCheckSlug) tuples for tenant fail', () => {
    const scorecards = [
      makeScorecard('sc-A', ['c1', 'c2', 'c3']),
      makeScorecard('sc-B', ['c1', 'c2', 'c3']),
    ];
    const targets = selectForcedGradeTargets('tenant', 'fail', scorecards);
    expect(targets).toHaveLength(6);
    expect(targets.filter(t => t.scorecardId === 'sc-A')).toHaveLength(3);
    expect(targets.filter(t => t.scorecardId === 'sc-B')).toHaveLength(3);
  });

  it('returns all targets for external fail', () => {
    const scorecards = [makeScorecard('sc-1', ['c1', 'c2'])];
    const targets = selectForcedGradeTargets('external', 'fail', scorecards);
    expect(targets).toHaveLength(2);
    expect(targets[0]?.scorecardId).toBe('sc-1');
  });

  it('returns empty when no scorecards attached even on tenant fail', () => {
    expect(selectForcedGradeTargets('tenant', 'fail', [])).toHaveLength(0);
  });

  it('acceptance: tenant fail + 2 scorecards × 3 checks = 6 forced jobs', () => {
    const scorecards = [
      makeScorecard('sc-X', ['qc-1', 'qc-2', 'qc-3']),
      makeScorecard('sc-Y', ['qc-1', 'qc-2', 'qc-3']),
    ];
    const targets = selectForcedGradeTargets('tenant', 'fail', scorecards);
    expect(targets).toHaveLength(6);
    const ids = targets.map(t => t.scorecardId);
    expect(ids.filter(id => id === 'sc-X')).toHaveLength(3);
    expect(ids.filter(id => id === 'sc-Y')).toHaveLength(3);
    const slugs = targets.map(t => t.qualityCheckSlug);
    expect(new Set(slugs).size).toBe(3);
  });

  it('each returned target has both scorecardId and qualityCheckSlug', () => {
    const scorecards = [makeScorecard('sc-1', ['qa', 'qb'])];
    const targets = selectForcedGradeTargets('external', 'fail', scorecards);
    for (const t of targets) {
      expect(typeof t.scorecardId).toBe('string');
      expect(typeof t.qualityCheckSlug).toBe('string');
    }
  });
});
