// server/jobs/scorecardJudgeForcedJob.ts
// Pure helper for forced scorecard judge job targeting.
// Trust & Verification Layer spec §12.3 forced grading, §13.2 capture flow step 2.
// All exports are pure: no DB, no network, no filesystem.

import type { QualityCheck } from '../db/schema/scorecards.js';

export interface AttachedScorecardSummary {
  scorecardId: string;
  qualityChecks: QualityCheck[];
}

export interface ForcedGradeTarget {
  scorecardId: string;
  qualityCheckSlug: string;
}

/**
 * Returns the set of (scorecardId, qualityCheckSlug) tuples to force-grade
 * based on the runtime check result.
 *
 * Grading fires when:
 *   - blastRadius !== 'self'  (tenant or external actions can affect others)
 *   - runtimeCheckState === 'fail'  (only verified failures trigger escalation)
 *
 * Returns empty array for 'self' blast radius or non-fail states.
 */
export function selectForcedGradeTargets(
  blastRadius: 'self' | 'tenant' | 'external',
  runtimeCheckState: string,
  attachedScorecards: AttachedScorecardSummary[],
): ForcedGradeTarget[] {
  if (blastRadius === 'self' || runtimeCheckState !== 'fail') return [];

  const targets: ForcedGradeTarget[] = [];
  for (const sc of attachedScorecards) {
    for (const qc of sc.qualityChecks) {
      targets.push({ scorecardId: sc.scorecardId, qualityCheckSlug: qc.slug });
    }
  }
  return targets;
}
