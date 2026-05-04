// ---------------------------------------------------------------------------
// Evaluator: optimiser.agent.routing_uncertainty
//
// Thresholds (spec §2):
//   uncertaintyRate > 0.4 → severity='warn'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { RoutingUncertaintyEvidence } from '../queries/routingUncertainty.js';
import { routingActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.agent.routing_uncertainty';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<RoutingUncertaintyEvidence> = (
  rows: QueryRow<RoutingUncertaintyEvidence>[],
  _ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('routingUncertainty evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.uncertaintyRate !== 'number' || typeof ev?.agentId !== 'string') {
      throw Object.assign(
        new Error('routingUncertainty evaluator: malformed evidence — missing uncertaintyRate or agentId'),
        { errorType: 'data_invalid' },
      );
    }

    if (ev.uncertaintyRate <= 0.4) continue;

    const severity = 'warn' as const;
    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        agentId: ev.agentId,
        uncertainDecisions: ev.uncertainDecisions,
        totalDecisions: ev.totalDecisions,
        uncertaintyRate: ev.uncertaintyRate,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: routingActionHint(ev.agentId),
    });
  }

  return outputs;
};
