// ---------------------------------------------------------------------------
// Evaluator contracts for the sub-account optimiser.
//
// Evaluators are PURE functions — no I/O, no clock reads, no DB access.
// They receive a list of QueryRow<TEvidence>[] from the corresponding query
// module and return EvaluatorOutput[] that will be upserted as
// agent_recommendations rows.
// ---------------------------------------------------------------------------

import type { QueryRow } from '../queries/types.js';

export interface EvaluatorContext {
  subaccountId: string;
  organisationId: string;
  medianVersion: number;
  priorRecsByDedupe: Map<string, { evidenceHash: string; evidence: Record<string, unknown> }>;
}

export interface EvaluatorOutput {
  category: string;
  severity: 'info' | 'warn' | 'critical';
  dedupeKey: string;
  evidence: Record<string, unknown>;
  priorityTuple: [severityRank: number, categoryAsc: string, dedupeKeyAsc: string];
  actionHint: string | null;
}

export type Evaluator<TEvidence = Record<string, unknown>> = (
  rows: QueryRow<TEvidence>[],
  ctx: EvaluatorContext,
) => EvaluatorOutput[];
