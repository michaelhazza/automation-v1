// Planner cost calculator — pure function (spec §16.2.1)
// Converts token usage + call counts into BriefCostPreview / actualCostCents split.

import type { BriefCostPreview } from '../../../shared/types/briefResultContract.js';

// ── Token pricing (cents per 1M tokens) ──────────────────────────────────────
// System defaults; overridden by systemSettings in production.

const PRICING: Record<string, { inputCentsPerM: number; outputCentsPerM: number }> = {
  'claude-haiku-4-5':   { inputCentsPerM: 25,  outputCentsPerM: 125  },
  'claude-sonnet-4-6':  { inputCentsPerM: 300, outputCentsPerM: 1500 },
};

const DEFAULT_PRICING = { inputCentsPerM: 300, outputCentsPerM: 1500 };

function tokensToCents(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return Math.round(
    (inputTokens  * p.inputCentsPerM  / 1_000_000) +
    (outputTokens * p.outputCentsPerM / 1_000_000),
  );
}

// Live-call cost estimate: ~0.01 cents per GHL API call (negligible; tracked for attribution)
const LIVE_CALL_COST_CENTS = 0;

// ── computePlannerCostPreview ─────────────────────────────────────────────────

export interface CostPreviewInput {
  stage3ParseUsage?:          { inputTokens: number; outputTokens: number; model: string };
  stage3EscalationUsage?:     { inputTokens: number; outputTokens: number; model: string };
  liveCallCountEstimate?:     number;
  hybridLiveCallCountEstimate?: number;
  basedOn?: BriefCostPreview['basedOn'];
}

export function computePlannerCostPreview(input: CostPreviewInput): BriefCostPreview {
  let predictedCents = 0;
  let confidence: BriefCostPreview['confidence'] = 'high';

  if (input.stage3ParseUsage) {
    const { inputTokens, outputTokens, model } = input.stage3ParseUsage;
    predictedCents += tokensToCents(inputTokens, outputTokens, model);
    confidence = 'medium';
  }
  if (input.stage3EscalationUsage) {
    const { inputTokens, outputTokens, model } = input.stage3EscalationUsage;
    predictedCents += tokensToCents(inputTokens, outputTokens, model);
    confidence = 'low';
  }
  if (input.liveCallCountEstimate) {
    predictedCents += input.liveCallCountEstimate * LIVE_CALL_COST_CENTS;
  }
  if (input.hybridLiveCallCountEstimate) {
    predictedCents += input.hybridLiveCallCountEstimate * LIVE_CALL_COST_CENTS;
  }

  const basedOn: BriefCostPreview['basedOn'] =
    input.basedOn ??
    (input.stage3ParseUsage ? 'planner_estimate' : 'static_heuristic');

  return { predictedCostCents: predictedCents, confidence, basedOn };
}

// ── computeActualCostCents ────────────────────────────────────────────────────

export interface ActualCostInput {
  stage3ParseUsage?:      { inputTokens: number; outputTokens: number; model: string };
  stage3EscalationUsage?: { inputTokens: number; outputTokens: number; model: string };
  liveCallCount?:         number;
  hybridLiveCallCount?:   number;
}

export function computeActualCostCents(input: ActualCostInput): {
  total: number;
  stage3: number;
  executor: number;
} {
  let stage3 = 0;
  if (input.stage3ParseUsage) {
    const { inputTokens, outputTokens, model } = input.stage3ParseUsage;
    stage3 += tokensToCents(inputTokens, outputTokens, model);
  }
  if (input.stage3EscalationUsage) {
    const { inputTokens, outputTokens, model } = input.stage3EscalationUsage;
    stage3 += tokensToCents(inputTokens, outputTokens, model);
  }

  const liveCalls   = (input.liveCallCount        ?? 0) * LIVE_CALL_COST_CENTS;
  const hybridCalls = (input.hybridLiveCallCount   ?? 0) * LIVE_CALL_COST_CENTS;
  const executor    = liveCalls + hybridCalls;

  return { total: stage3 + executor, stage3, executor };
}
