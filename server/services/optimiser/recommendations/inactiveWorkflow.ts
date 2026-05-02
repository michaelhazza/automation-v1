/**
 * server/services/optimiser/recommendations/inactiveWorkflow.ts
 *
 * Evaluator: inactive workflow detection.
 *
 * Trigger: the query module already filters to workflows that have missed 2+
 *   expected heartbeats. Each returned row is a candidate.
 *
 * Category: optimiser.inactive.workflow
 * Severity: info
 * Dedupe key: subaccount_agent_id
 */

import type { InactiveWorkflowRow } from '../queries/inactiveWorkflows.js';
import type { RecommendationCandidate } from './agentBudget.js';

const CATEGORY = 'optimiser.inactive.workflow';

export function evaluateInactiveWorkflow(
  rows: InactiveWorkflowRow[],
): RecommendationCandidate[] {
  return rows.map((row) => ({
    category: CATEGORY,
    severity: 'info' as const,
    evidence: {
      subaccount_agent_id: row.subaccount_agent_id,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      expected_cadence: row.expected_cadence,
      last_run_at: row.last_run_at,
    },
    dedupe_key: row.subaccount_agent_id,
  }));
}
