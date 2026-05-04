// ---------------------------------------------------------------------------
// Evaluator: optimiser.agent.over_budget
//
// Thresholds (spec §2):
//   >90% budget used  → severity='warn'
//   >100% budget used → severity='critical'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { AgentBudgetEvidence } from '../queries/agentBudget.js';
import { budgetActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.agent.over_budget';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<AgentBudgetEvidence> = (
  rows: QueryRow<AgentBudgetEvidence>[],
  ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('agentBudget evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.percentUsed !== 'number' || typeof ev?.agentId !== 'string') {
      throw Object.assign(
        new Error('agentBudget evaluator: malformed evidence — missing percentUsed or agentId'),
        { errorType: 'data_invalid' },
      );
    }

    const { percentUsed } = ev;

    let severity: 'info' | 'warn' | 'critical' | null = null;
    if (percentUsed > 1.0) {
      severity = 'critical';
    } else if (percentUsed > 0.9) {
      severity = 'warn';
    }

    if (severity === null) continue;

    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        agentId: ev.agentId,
        agentName: ev.agentName,
        thisMonthSpendUsd: ev.thisMonthSpendUsd,
        budgetLimitUsd: ev.budgetLimitUsd,
        percentUsed: ev.percentUsed,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: budgetActionHint(ev.agentId),
    });
  }

  return outputs;
};
