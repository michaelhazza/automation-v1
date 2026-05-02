/**
 * server/services/optimiser/recommendations/playbookEscalation.ts
 *
 * Evaluator: playbook escalation rate detection.
 *
 * Trigger: escalation_count / run_count > 60% over 14 days (query already
 *   uses a 7-day window; the evaluator enforces the rate threshold).
 *
 * Category: optimiser.playbook.escalation_rate
 * Severity: warn
 * Dedupe key: workflow_id
 */

import type { EscalationRateRow } from '../queries/escalationRate.js';
import { assertPercentInBounds } from '../evaluatorBoundsPure.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.playbook.escalation_rate';
const ESCALATION_RATE_THRESHOLD = 0.60;
const SOURCE_QUERY = 'optimiser.escalationRate';

export function evaluatePlaybookEscalation(
  rows: EscalationRateRow[],
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    if (row.run_count <= 0) continue;

    const escalation_pct = row.escalation_count / row.run_count;

    if (!assertPercentInBounds(escalation_pct, 'escalation_pct', CATEGORY, SOURCE_QUERY)) {
      continue;
    }

    if (escalation_pct > ESCALATION_RATE_THRESHOLD) {
      candidates.push({
        category: CATEGORY,
        severity: 'warn',
        evidence: {
          workflow_id: row.workflow_id,
          run_count: row.run_count,
          escalation_count: row.escalation_count,
          escalation_pct: Number(escalation_pct.toFixed(4)),
          common_step_id: row.common_step_id,
        },
        dedupe_key: row.workflow_id,
      });
    }
  }

  return candidates;
}
