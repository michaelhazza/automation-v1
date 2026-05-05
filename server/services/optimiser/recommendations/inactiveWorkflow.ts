// ---------------------------------------------------------------------------
// Evaluator: optimiser.inactive.workflow
//
// Thresholds (spec §2):
//   > 1.5× expected cadence (schedule-based) → severity='info'
//   > 14 days with no schedule                → severity='warn'
//
// Since the query module only emits schedule-enabled agents, we use
// >14 days as the secondary threshold (no schedule metadata in evidence).
// The evidence carries daysSinceLastRun for threshold evaluation.
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { InactiveWorkflowEvidence } from '../queries/inactiveWorkflows.js';
import { inactiveWorkflowActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.inactive.workflow';

// Sentinel for "never ran" (set in query module)
const NEVER_RAN_SENTINEL = 999;

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<InactiveWorkflowEvidence> = (
  rows: QueryRow<InactiveWorkflowEvidence>[],
  _ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('inactiveWorkflow evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (
      typeof ev?.daysSinceLastRun !== 'number' ||
      typeof ev?.subaccountAgentId !== 'string' ||
      typeof ev?.agentId !== 'string'
    ) {
      throw Object.assign(
        new Error('inactiveWorkflow evaluator: malformed evidence — missing required fields'),
        { errorType: 'data_invalid' },
      );
    }

    const { daysSinceLastRun } = ev;

    // Only flag if there's meaningful inactivity
    if (daysSinceLastRun < 1) continue;

    let severity: 'info' | 'warn' | 'critical';
    if (daysSinceLastRun >= NEVER_RAN_SENTINEL || daysSinceLastRun > 14) {
      // Never ran or overdue by more than 14 days
      severity = 'warn';
    } else {
      // Overdue but < 14 days
      severity = 'info';
    }

    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        subaccount_agent_id: ev.subaccountAgentId,
        agent_id: ev.agentId,
        agent_name: ev.agentName,
        expected_cadence: 'daily',
        last_run_at: ev.lastRunAt ?? null,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: inactiveWorkflowActionHint(ev.subaccountAgentId),
    });
  }

  return outputs;
};
