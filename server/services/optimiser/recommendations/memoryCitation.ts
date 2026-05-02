/**
 * server/services/optimiser/recommendations/memoryCitation.ts
 *
 * Evaluator: memory low-citation waste detection.
 *
 * Trigger: low_citation_pct > 40%.
 *
 * Category: optimiser.memory.low_citation_waste
 * Severity: info
 * Dedupe key: agent_id
 */

import type { MemoryCitationRow } from '../queries/memoryCitation.js';
import { assertPercentInBounds } from '../evaluatorBoundsPure.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.memory.low_citation_waste';
const LOW_CITATION_THRESHOLD = 0.40;
const SOURCE_QUERY = 'optimiser.memoryCitation';

export function evaluateMemoryCitation(
  rows: MemoryCitationRow[],
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    if (!assertPercentInBounds(row.low_citation_pct, 'low_citation_pct', CATEGORY, SOURCE_QUERY)) {
      continue;
    }

    if (row.low_citation_pct > LOW_CITATION_THRESHOLD) {
      candidates.push({
        category: CATEGORY,
        severity: 'info',
        evidence: {
          agent_id: row.agent_id,
          low_citation_pct: row.low_citation_pct,
          total_injected: row.total_injected,
          projected_token_savings: row.projected_token_savings,
        },
        dedupe_key: row.agent_id,
      });
    }
  }

  return candidates;
}
