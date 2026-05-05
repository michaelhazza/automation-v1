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

    // Invariant 33: all optional fields set to null, never undefined
    const evidence: Record<string, unknown> = {
      skill_slug: e.skillSlug ?? null,
      latency_p95_ms: e.thisP95Ms,
      peer_p95_ms: e.peerP95Ms,
      ratio: e.ratioVsPeerP95,
      medianVersion: e.medianVersion,
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
