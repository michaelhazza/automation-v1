// ---------------------------------------------------------------------------
// Evaluator: optimiser.llm.cache_poor_reuse
//
// Thresholds (spec §2):
//   cacheHitRate < 0.3 → severity='info'
//   cacheHitRate < 0.1 → severity='warn'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { CacheEfficiencyEvidence } from '../queries/cacheEfficiency.js';
import { cacheActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.llm.cache_poor_reuse';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<CacheEfficiencyEvidence> = (
  rows: QueryRow<CacheEfficiencyEvidence>[],
  _ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('cacheEfficiency evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.cacheHitRate !== 'number' || typeof ev?.agentId !== 'string') {
      throw Object.assign(
        new Error('cacheEfficiency evaluator: malformed evidence — missing cacheHitRate or agentId'),
        { errorType: 'data_invalid' },
      );
    }

    const { cacheHitRate } = ev;

    let severity: 'info' | 'warn' | null = null;
    if (cacheHitRate < 0.1) {
      severity = 'warn';
    } else if (cacheHitRate < 0.3) {
      severity = 'info';
    }

    if (severity === null) continue;

    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        agentId: ev.agentId,
        cacheHits: ev.cacheHits,
        totalRequests: ev.totalRequests,
        cacheHitRate: ev.cacheHitRate,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: cacheActionHint(ev.agentId),
    });
  }

  return outputs;
};
