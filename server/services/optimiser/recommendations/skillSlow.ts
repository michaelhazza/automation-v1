/**
 * server/services/optimiser/recommendations/skillSlow.ts
 *
 * Evaluator: slow skill detection.
 *
 * Trigger: ratio > 4 sustained over 7 days. Rows from querySkillLatency are
 *   already filtered to skills with >= 5 peer tenants (via the peer-median view
 *   HAVING clause), so no additional peer-count check is needed here.
 *
 * Category: optimiser.skill.slow
 * Severity: warn
 * Dedupe key: skill_slug
 */

import type { SkillLatencyRow } from '../queries/skillLatency.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.skill.slow';
const RATIO_THRESHOLD = 4;

export function evaluateSkillSlow(
  rows: SkillLatencyRow[],
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    // peer_p95_ms must be positive to compute a meaningful ratio
    if (row.peer_p95_ms <= 0) continue;

    if (row.ratio > RATIO_THRESHOLD) {
      candidates.push({
        category: CATEGORY,
        severity: 'warn',
        evidence: {
          skill_slug: row.skill_slug,
          latency_p95_ms: row.latency_p95_ms,
          peer_p95_ms: row.peer_p95_ms,
          ratio: row.ratio,
        },
        dedupe_key: row.skill_slug,
      });
    }
  }

  return candidates;
}
