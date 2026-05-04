// ---------------------------------------------------------------------------
// Evaluator: optimiser.memory.low_citation_waste
//
// Thresholds (spec §2):
//   avgCitationScore < 0.5  → severity='info'
//   avgCitationScore < 0.2  → severity='warn'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { MemoryCitationEvidence } from '../queries/memoryCitation.js';
import { memoryCitationActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.memory.low_citation_waste';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<MemoryCitationEvidence> = (
  rows: QueryRow<MemoryCitationEvidence>[],
  _ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('memoryCitation evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.avgCitationScore !== 'number' || typeof ev?.agentId !== 'string') {
      throw Object.assign(
        new Error('memoryCitation evaluator: malformed evidence — missing avgCitationScore or agentId'),
        { errorType: 'data_invalid' },
      );
    }

    const { avgCitationScore } = ev;

    let severity: 'info' | 'warn' | null = null;
    if (avgCitationScore < 0.2) {
      severity = 'warn';
    } else if (avgCitationScore < 0.5) {
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
        avgCitationScore: ev.avgCitationScore,
        totalCitations: ev.totalCitations,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: memoryCitationActionHint(ev.agentId),
    });
  }

  return outputs;
};
