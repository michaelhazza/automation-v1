// ---------------------------------------------------------------------------
// Evaluator: optimiser.skill.slow
//
// Thresholds (spec §2):
//   ratioVsPeerP95 >= 4 → severity='warn'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext } from './types.js';
import type { QueryRow } from '../queries/types.js';

export interface SkillSlowEvidence {
  skillSlug: string;
  thisP95Ms: number;
  peerP95Ms: number;
  peerP50Ms: number;
  nTenants: number;
  medianVersion: number;
  ratioVsPeerP95: number;
}

const CATEGORY = 'optimiser.skill.slow';

// Threshold from spec §2: ratio >= 4 → warn
const SLOW_RATIO_WARN_THRESHOLD = 4;

export function evaluateSkillSlow(
  rows: QueryRow<SkillSlowEvidence>[],
  ctx: EvaluatorContext,
): EvaluatorOutput[] {
  if (!Array.isArray(rows)) {
    throw new Error('data_invalid: rows must be an array');
  }

  const results: EvaluatorOutput[] = [];

  for (const row of rows) {
    const e = row.evidence;

    if (typeof e.ratioVsPeerP95 !== 'number' || typeof e.thisP95Ms !== 'number') {
      throw new Error('data_invalid: missing required evidence fields');
    }

    if (e.ratioVsPeerP95 < SLOW_RATIO_WARN_THRESHOLD) continue;

    const severity = 'warn' as const; // spec §2: ratio >= 4 → warn
    const dedupeKey = row.metricKey; // skill_slug

    // Invariant 33: camelCase keys to match the SkillSlowEvidence shape
    const evidence: Record<string, unknown> = {
      skillSlug: e.skillSlug ?? null,
      thisP95Ms: e.thisP95Ms,
      peerP95Ms: e.peerP95Ms,
      peerP50Ms: e.peerP50Ms,
      nTenants: e.nTenants,
      medianVersion: e.medianVersion,
      ratioVsPeerP95: e.ratioVsPeerP95,
    };

    results.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence,
      priorityTuple: [2, CATEGORY, dedupeKey],
      actionHint: null,
    });
  }



  return results;
}
