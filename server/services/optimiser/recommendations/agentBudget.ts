/**
 * server/services/optimiser/recommendations/agentBudget.ts
 *
 * Evaluator: agent over-budget detection.
 *
 * Trigger: agent spent > 1.3x its monthly budget for 2 consecutive months
 *   (this_month > budget * 1.3 AND last_month > budget * 1.3, budget > 0).
 *
 * Category: optimiser.agent.over_budget
 * Severity: critical
 * Dedupe key: agent_id
 * Action hint: configuration-assistant://subaccount/${subaccountId}?focus=budget
 */

import type { AgentBudgetRow } from '../queries/agentBudget.js';

export interface RecommendationCandidate {
  category: string;
  severity: 'info' | 'warn' | 'critical';
  evidence: Record<string, unknown>;
  dedupe_key: string;
  action_hint?: string;
}

const CATEGORY = 'optimiser.agent.over_budget';
const BUDGET_MULTIPLIER = 1.3;

export function evaluateAgentBudget(
  rows: AgentBudgetRow[],
  ctx: { subaccountId: string },
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const row of rows) {
    // Skip agents with no configured budget
    if (row.budget <= 0) continue;

    const threshold = row.budget * BUDGET_MULTIPLIER;

    // Trigger: both this month AND last month over 1.3x budget
    if (row.this_month > threshold && row.last_month > threshold) {
      candidates.push({
        category: CATEGORY,
        severity: 'critical',
        evidence: {
          agent_id: row.agent_id,
          this_month: row.this_month,
          last_month: row.last_month,
          budget: row.budget,
          top_cost_driver: row.top_cost_driver,
        },
        dedupe_key: row.agent_id,
        action_hint: `configuration-assistant://subaccount/${ctx.subaccountId}?focus=budget`,
      });
    }
  }

  return candidates;
}
