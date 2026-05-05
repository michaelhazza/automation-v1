// ---------------------------------------------------------------------------
// Evaluator: optimiser.playbook.escalation_rate
//
// Thresholds (spec §2):
//   >30% escalation rate → severity='warn'
//   >60% escalation rate → severity='critical'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { EscalationRateEvidence } from '../queries/escalationRate.js';
import { escalationActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.playbook.escalation_rate';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<EscalationRateEvidence> = (
  rows: QueryRow<EscalationRateEvidence>[],
  _ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('playbookEscalation evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.escalationRate !== 'number' || typeof ev?.workflowId !== 'string') {
      throw Object.assign(
        new Error('playbookEscalation evaluator: malformed evidence — missing escalationRate or workflowId'),
        { errorType: 'data_invalid' },
      );
    }

    const { escalationRate } = ev;

    let severity: 'info' | 'warn' | 'critical' | null = null;
    if (escalationRate > 0.6) {
      severity = 'critical';
    } else if (escalationRate > 0.3) {
      severity = 'warn';
    }

    if (severity === null) continue;

    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        workflow_id: ev.workflowId,
        run_count: ev.totalCount,
        escalation_count: ev.escalationCount,
        escalation_pct: ev.escalationRate,
        common_step_id: null,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: escalationActionHint(ev.workflowId),
    });
  }

  return outputs;
};
