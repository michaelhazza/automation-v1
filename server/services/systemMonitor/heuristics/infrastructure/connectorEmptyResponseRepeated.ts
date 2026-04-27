import type { Heuristic, HeuristicContext, Candidate, HeuristicResult, Evidence } from '../types.js';
import type { ConnectorPollEntity } from '../candidateTypes.js';

const EMPTY_RESPONSE_THRESHOLD = 3;

export const connectorEmptyResponseRepeated: Heuristic = {
  id: 'connector-empty-response-repeated',
  category: 'infrastructure',
  phase: '2.0',
  severity: 'medium',
  confidence: 0.70,
  expectedFpRate: 0.07,
  requiresBaseline: [
    { entityKind: 'connector', metric: 'rows_ingested', minSampleCount: 10 },
  ],
  suppressions: [],
  firesPerEntityPerHour: 1,

  async evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult> {
    const conn = candidate.entity as ConnectorPollEntity;

    if (conn.recentEmptyResultCount < EMPTY_RESPONSE_THRESHOLD) return { fired: false };

    const baseline = await ctx.baselines.getOrNull('connector', conn.connectorId, 'rows_ingested', 10);
    if (!baseline || baseline.p50 < 1) return { fired: false, reason: 'insufficient_data' };

    const evidence: Evidence = [{
      type: 'connector_empty_response_repeated',
      ref: conn.connectorId,
      summary: `Connector '${conn.connectorType}' (${conn.connectorId}) returned empty results ${conn.recentEmptyResultCount}× in the last hour; baseline median is ${baseline.p50.toFixed(1)} rows/poll.`,
    }];
    return { fired: true, evidence, confidence: 0.70 };
  },

  describe(evidence) {
    const ev = evidence[0];
    return ev ? ev.summary : 'Connector returned empty results ≥3 times in the last hour despite a non-zero baseline.';
  },
};
