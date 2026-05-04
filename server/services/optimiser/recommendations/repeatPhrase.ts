// ---------------------------------------------------------------------------
// Evaluator: optimiser.escalation.repeat_phrase
//
// Thresholds (spec §2):
//   count >= 3 in window → severity='info'
// ---------------------------------------------------------------------------

import type { EvaluatorOutput, EvaluatorContext, Evaluator } from './types.js';
import type { QueryRow } from '../queries/types.js';
import type { EscalationPhraseEvidence } from '../queries/escalationPhrases.js';
import { phraseActionHint } from './actionHints.js';

const CATEGORY = 'optimiser.escalation.repeat_phrase';

function severityRank(s: 'info' | 'warn' | 'critical'): number {
  if (s === 'critical') return 3;
  if (s === 'warn') return 2;
  return 1;
}

export const evaluate: Evaluator<EscalationPhraseEvidence> = (
  rows: QueryRow<EscalationPhraseEvidence>[],
  ctx: EvaluatorContext,
): EvaluatorOutput[] => {
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('repeatPhrase evaluator: rows must be an array'), {
      errorType: 'data_invalid',
    });
  }

  const outputs: EvaluatorOutput[] = [];

  for (const row of rows) {
    const ev = row.evidence;
    if (typeof ev?.count !== 'number' || typeof ev?.phrase !== 'string') {
      throw Object.assign(
        new Error('repeatPhrase evaluator: malformed evidence — missing count or phrase'),
        { errorType: 'data_invalid' },
      );
    }

    if (ev.count < 3) continue;

    const severity = 'info' as const;
    const dedupeKey = row.metricKey;

    outputs.push({
      category: CATEGORY,
      severity,
      dedupeKey,
      evidence: {
        phrase: ev.phrase,
        count: ev.count,
        sample_escalation_ids: ev.sampleEscalationIds,
        median_version: ev.median_version,
      },
      priorityTuple: [severityRank(severity), CATEGORY, dedupeKey],
      actionHint: phraseActionHint(ctx.subaccountId, ev.phrase),
    });
  }

  return outputs;
};
