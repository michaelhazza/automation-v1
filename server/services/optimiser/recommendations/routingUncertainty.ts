/**
 * server/services/optimiser/recommendations/routingUncertainty.ts
 *
 * Evaluator: routing uncertainty detection.
 *
 * Trigger: low_confidence_pct > 30% AND total_decisions >= 50.
 *
 * Category: optimiser.agent.routing_uncertainty
 * Severity: warn
 * Dedupe key: agent_id
 *
 * Per plan: assertPercentInBounds check on low_confidence_pct and second_look_pct.
 */

import type { RoutingUncertaintyRow } from '../queries/routingUncertainty.js';
import { assertPercentInBounds } from '../evaluatorBoundsPure.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.agent.routing_uncertainty';
const LOW_CONFIDENCE_THRESHOLD = 0.30;
const MIN_TOTAL_DECISIONS = 50;
const SOURCE_QUERY = 'optimiser.routingUncertainty';

export function evaluateRoutingUncertainty(
  rows: RoutingUncertaintyRow[],
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    if (!assertPercentInBounds(row.low_confidence_pct, 'low_confidence_pct', CATEGORY, SOURCE_QUERY)) {
      continue;
    }
    if (!assertPercentInBounds(row.second_look_pct, 'second_look_pct', CATEGORY, SOURCE_QUERY)) {
      continue;
    }

    if (row.low_confidence_pct > LOW_CONFIDENCE_THRESHOLD && row.total_decisions >= MIN_TOTAL_DECISIONS) {
      candidates.push({
        category: CATEGORY,
        severity: 'warn',
        evidence: {
          agent_id: row.agent_id,
          low_confidence_pct: row.low_confidence_pct,
          second_look_pct: row.second_look_pct,
          total_decisions: row.total_decisions,
        },
        dedupe_key: row.agent_id,
      });
    }
  }

  return candidates;
}
