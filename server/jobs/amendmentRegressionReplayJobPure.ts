// ---------------------------------------------------------------------------
// amendmentRegressionReplayJobPure — pure helpers for the amendment:regression-replay job.
// Closed-Loop Skill Improvement spec §9.2 (Chunk 7).
// All exports are pure: no DB, no network, no filesystem.
// ---------------------------------------------------------------------------

export type RegressionCaseTag = 'fix_proposed' | 'fix_wrong' | 'unresolved';

/**
 * Returns the expected scorecard verdict for a regression case tag.
 *
 * fix_proposed → we expect the amendment to have fixed this case → 'pass'
 * fix_wrong    → we expect the case to still fail (the amendment doesn't fix it) → 'fail'
 * unresolved   → no expected outcome yet; skip replay for this case → 'skip'
 */
export function expectedVerdictForTag(tag: RegressionCaseTag): 'pass' | 'fail' | 'skip' {
  switch (tag) {
    case 'fix_proposed': return 'pass';
    case 'fix_wrong': return 'fail';
    case 'unresolved': return 'skip';
    default: {
      const _exhaustive: never = tag;
      return _exhaustive;
    }
  }
}

export interface ReplayOutcome {
  caseId: string;
  tag: RegressionCaseTag;
  expectedVerdict: 'pass' | 'fail' | 'skip';
  actualVerdict: 'pass' | 'fail' | 'inconclusive';
}

/**
 * Determines whether any fix_proposed case regressed or is inconclusive.
 *
 * Rollback triggers:
 *  - fix_proposed + fail:        the amendment demonstrably broke the case it was meant to fix.
 *  - fix_proposed + inconclusive: cannot confirm the fix still holds; conservatively suspend
 *                                 rather than leaving a potentially broken amendment active.
 *
 * fix_wrong cases that unexpectedly pass do NOT trigger rollback.
 * unresolved cases (skip) are never evaluated.
 */
export function detectRollback(
  outcomes: ReplayOutcome[],
): { rollback: false } | { rollback: true; reason: 'fix_proposed_regressed'; offendingCaseIds: string[] } {
  const offending = outcomes
    .filter((o) => o.tag === 'fix_proposed' && (o.actualVerdict === 'fail' || o.actualVerdict === 'inconclusive'))
    .map((o) => o.caseId);

  if (offending.length === 0) return { rollback: false };
  return { rollback: true, reason: 'fix_proposed_regressed', offendingCaseIds: offending };
}
