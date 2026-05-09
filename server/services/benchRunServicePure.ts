// server/services/benchRunServicePure.ts
// Pure helpers for the bench run orchestrator.
// Trust & Verification Layer spec §12.4 (M2 judge≠candidate, M3 cost cap).
// All exports are pure: no DB, no network, no filesystem.

import { computeRegressionRisk, computeBenchComposite } from './scorecardServicePure.js';

// ── estimateCost ──────────────────────────────────────────────────────────────

export interface EstimateCostInput {
  candidateModels: string[];
  sampleCount: number;
  /** Per-model cost per one LLM call (in cents). Caller fetches via pricingService. */
  costPerSampleCents: Record<string, number>;
  /** Number of quality checks the bench judge will evaluate per sample. */
  judgeCallsPerSample: number;
  /** Cost per judge LLM call in cents. Caller fetches via pricingService. */
  judgeCallCents: number;
}

/**
 * Estimates total bench cost in cents.
 * Total = Σ(candidate cost × sampleCount) + (candidateCount × sampleCount × judgeCallsPerSample × judgeCallCents)
 */
export function estimateCost(input: EstimateCostInput): number {
  if (input.candidateModels.length === 0 || input.sampleCount === 0) return 0;

  const candidateCents = input.candidateModels.reduce((sum, model) => {
    return sum + (input.costPerSampleCents[model] ?? 0) * input.sampleCount;
  }, 0);

  const judgeCents =
    input.candidateModels.length *
    input.sampleCount *
    input.judgeCallsPerSample *
    input.judgeCallCents;

  return Math.ceil(candidateCents + judgeCents);
}

// ── applyJudgeNeqCandidateRule ────────────────────────────────────────────────

export interface JudgeNeqCandidateInput {
  candidateModels: string[];
  judgeModelId: string;
  orgDefaultJudge: string;
}

/**
 * M2 invariant: judge model must not be a bench candidate.
 * If the judge IS a candidate, swaps to orgDefaultJudge and surfaces a notice.
 */
export function applyJudgeNeqCandidateRule(input: JudgeNeqCandidateInput): {
  judgeModelId: string;
  swapNotice: string | null;
} {
  if (input.candidateModels.includes(input.judgeModelId)) {
    return {
      judgeModelId: input.orgDefaultJudge,
      swapNotice: `Judge model '${input.judgeModelId}' is a bench candidate; switched to '${input.orgDefaultJudge}' to prevent self-scoring bias.`,
    };
  }
  return { judgeModelId: input.judgeModelId, swapNotice: null };
}

// ── validateCostCap ───────────────────────────────────────────────────────────

/**
 * M3 server-side cost cap (spec §12.4).
 * Throws a structured error when estimated cost exceeds the cap — never enters
 * 'awaiting_confirm' state when over cap.
 */
export function validateCostCap(estimatedCents: number, capCents: number): void {
  if (estimatedCents > capCents) {
    throw Object.assign(
      new Error(`Estimated bench cost ${estimatedCents}¢ exceeds server cap ${capCents}¢`),
      {
        statusCode: 422,
        errorCode: 'BENCH_COST_CAP_EXCEEDED',
        estimatedCents,
        capCents,
      },
    );
  }
}

// ── computeBenchSummary ───────────────────────────────────────────────────────

export interface RawBenchResultRow {
  candidateModelId: string;
  verdict: 'pass' | 'fail' | 'inconclusive' | 'error' | null;
  score: number | null;
  latencyMs: number | null;
  costCents: number | null;
}

export interface BenchModelStats {
  candidateModelId: string;
  meanScore: number;
  variance: number;
  meanLatencyMs: number;
  totalCostCents: number;
  sampleCount: number;
  regressionRisk: 'low' | 'medium' | 'high';
  passesAllPassMarks: boolean;
}

/**
 * Aggregates per-(model, sample) raw rows into per-model stats.
 * Rows with null scores (inconclusive/error) are excluded from mean/variance
 * but counted in sampleCount. passesAllPassMarks is false if any row is 'fail'.
 */
export function aggregateModelStats(
  rows: RawBenchResultRow[],
  passMark: number = 0.7,
): BenchModelStats[] {
  const byModel = new Map<string, RawBenchResultRow[]>();
  for (const row of rows) {
    const existing = byModel.get(row.candidateModelId) ?? [];
    existing.push(row);
    byModel.set(row.candidateModelId, existing);
  }

  const stats: BenchModelStats[] = [];
  for (const [candidateModelId, modelRows] of byModel) {
    const scores = modelRows.map(r => r.score).filter((s): s is number => s !== null && Number.isFinite(s));
    const latencies = modelRows.map(r => r.latencyMs).filter((l): l is number => l !== null);
    const costs = modelRows.map(r => r.costCents).filter((c): c is number => c !== null);

    const meanScore = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
    const variance = scores.length > 1
      ? scores.reduce((s, v) => s + (v - meanScore) ** 2, 0) / scores.length
      : 0;
    const meanLatencyMs = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0;
    const totalCostCents = costs.reduce((s, v) => s + v, 0);

    const passesAllPassMarks = modelRows.every(r => r.verdict !== 'fail') &&
      (scores.length === 0 || meanScore >= passMark);

    stats.push({
      candidateModelId,
      meanScore,
      variance,
      meanLatencyMs,
      totalCostCents,
      sampleCount: modelRows.length,
      regressionRisk: computeRegressionRisk(variance, modelRows.length),
      passesAllPassMarks,
    });
  }
  return stats;
}

/**
 * Computes the bench summary (composite winner + per-model stats).
 * Wraps computeBenchComposite from scorecardServicePure.
 */
export function computeBenchSummary(stats: BenchModelStats[]): {
  recommendedModelId: string | null;
  reason: string;
} {
  return computeBenchComposite(
    stats.map(s => ({
      candidateModelId: s.candidateModelId,
      passesAllPassMarks: s.passesAllPassMarks,
      regressionRisk: s.regressionRisk,
      totalCostCents: s.totalCostCents,
    })),
  );
}
