// server/services/benchRunService.ts
// Impure bench run service — estimate, run, approve, query.
// Trust & Verification Layer spec §12.4 (F5 atomicity, M2, M3).
// All DB methods require an active org-scoped tx context (authenticate middleware).

import { eq, desc, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { benchRuns, benchResults } from '../db/schema/index.js';
import type { BenchRun, NewBenchRun } from '../db/schema/benchRuns.js';
import {
  estimateCost,
  applyJudgeNeqCandidateRule,
  validateCostCap,
  aggregateModelStats,
  computeBenchSummary,
} from './benchRunServicePure.js';
import { estimateCost as pricingEstimateCost } from './pricingService.js';
import { logger } from '../lib/logger.js';
import { emitOrgUpdate } from '../websocket/emitters.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BENCH_MAX_COST_CENTS = (() => {
  const v = process.env.BENCH_MAX_COST_CENTS;
  return v ? parseInt(v, 10) : 10_000; // default $100
})();
const JUDGE_MAX_OUTPUT_TOKENS = 1_024;
const CANDIDATE_MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5-20251001';

// ── Typed error helper ────────────────────────────────────────────────────────

function throwStatus(statusCode: number, errorCode: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, errorCode });
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface BenchEstimateInput {
  organisationId: string;
  triggeredByUserId: string;
  targetAgentId?: string | null;
  targetSkillSlug?: string | null;
  candidateModelIds: string[];
  judgeModelId: string;
  sampleCount: number;
}

export interface BenchEstimateResult {
  benchRunId: string;
  estimatedCostCents: number;
  judgeSwapNotice: string | null;
  status: 'awaiting_confirm';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function modelProvider(modelId: string): string {
  if (modelId.startsWith('claude')) return 'anthropic';
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) return 'openai';
  return 'anthropic';
}

async function fetchModelCostCents(
  modelId: string,
  maxTokens: number,
  organisationId: string,
): Promise<number> {
  try {
    return await pricingEstimateCost(modelProvider(modelId), modelId, maxTokens, organisationId);
  } catch {
    return 0;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export const benchRunService = {

  // ─── Estimate ─────────────────────────────────────────────────────────────
  //
  // Creates a bench_run row in 'awaiting_confirm' state with cost estimate.
  // M2: swaps judge if it is also a candidate.
  // M3: rejects if estimate exceeds BENCH_MAX_COST_CENTS.

  async estimate(input: BenchEstimateInput): Promise<BenchEstimateResult> {
    const db = getOrgScopedDb('benchRunService.estimate');

    // Resolve org's default judge model for M2 swap target
    const orgRows = await db.execute(
      sql`SELECT default_judge_model FROM organisations WHERE id = ${input.organisationId} LIMIT 1`,
    );
    const orgDefaultJudge =
      ((orgRows as unknown as Array<{ default_judge_model?: string }>)[0])?.default_judge_model ??
      DEFAULT_JUDGE_MODEL;

    // M2: judge must not be a candidate
    const { judgeModelId, swapNotice } = applyJudgeNeqCandidateRule({
      candidateModels: input.candidateModelIds,
      judgeModelId: input.judgeModelId,
      orgDefaultJudge,
    });

    // Fetch pricing snapshot for each candidate
    const costPerSampleCents: Record<string, number> = {};
    for (const modelId of input.candidateModelIds) {
      costPerSampleCents[modelId] = await fetchModelCostCents(
        modelId, CANDIDATE_MAX_OUTPUT_TOKENS, input.organisationId,
      );
    }

    const judgeCallCents = await fetchModelCostCents(
      judgeModelId, JUDGE_MAX_OUTPUT_TOKENS, input.organisationId,
    );

    const estimatedCostCents = estimateCost({
      candidateModels: input.candidateModelIds,
      sampleCount: input.sampleCount,
      costPerSampleCents,
      judgeCallsPerSample: 1,
      judgeCallCents,
    });

    // M3: throw 422 if over server-side cap
    validateCostCap(estimatedCostCents, BENCH_MAX_COST_CENTS);

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [run] = await db
      .insert(benchRuns)
      .values({
        organisationId: input.organisationId,
        triggeredByUserId: input.triggeredByUserId,
        targetAgentId: input.targetAgentId ?? null,
        targetSkillSlug: input.targetSkillSlug ?? null,
        state: 'awaiting_confirm',
        candidateModelIds: input.candidateModelIds,
        sampleCount: input.sampleCount,
        estimatedCostCents,
      } satisfies NewBenchRun)
      .returning();

    return {
      benchRunId: run.id,
      estimatedCostCents,
      judgeSwapNotice: swapNotice,
      status: 'awaiting_confirm',
    };
  },

  // ─── Run ──────────────────────────────────────────────────────────────────
  //
  // Confirms the bench estimate and enqueues the execute job.
  // Throws 412 if the bench_run is not in 'awaiting_confirm' state.

  async run(benchRunId: string): Promise<void> {
    const db = getOrgScopedDb('benchRunService.run');

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [run] = await db.select().from(benchRuns).where(eq(benchRuns.id, benchRunId));
    if (!run) throwStatus(404, 'BENCH_RUN_NOT_FOUND', `Bench run ${benchRunId} not found`);
    if (run.state !== 'awaiting_confirm') {
      throwStatus(412, 'BENCH_WRONG_STATE',
        `Bench run must be 'awaiting_confirm' to start; current state: ${run.state}`);
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(benchRuns)
      .set({ state: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(benchRuns.id, benchRunId));

    // Enqueue outside the route tx — pg-boss send is idempotent
    const boss = await getPgBoss();
    await (boss as any).send(
      'bench:execute',
      { benchRunId, organisationId: run.organisationId },
    );

    logger.info('bench_run.started', { benchRunId, organisationId: run.organisationId });
  },

  // ─── Approve ──────────────────────────────────────────────────────────────
  //
  // F5 three-phase atomicity:
  //   Phase 1: pre-tx validation (no writes)
  //   Phase 2: in-tx mutation (approved_model_id + state transition)
  //   Phase 3: afterCommit WebSocket fanout (emitOrgUpdate)

  async approve(
    benchRunId: string,
    candidateModelId: string,
  ): Promise<{ approvedModelId: string }> {
    const db = getOrgScopedDb('benchRunService.approve');

    // Phase 1: pre-tx validation — no writes
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [run] = await db.select().from(benchRuns).where(eq(benchRuns.id, benchRunId));
    if (!run) throwStatus(404, 'BENCH_RUN_NOT_FOUND', `Bench run ${benchRunId} not found`);
    if (run.state !== 'awaiting_approval') {
      throwStatus(412, 'BENCH_WRONG_STATE',
        `Bench run must be 'awaiting_approval' to approve; current state: ${run.state}`);
    }
    const candidateIds = run.candidateModelIds as string[];
    if (!candidateIds.includes(candidateModelId)) {
      throwStatus(422, 'BENCH_INVALID_CANDIDATE',
        `${candidateModelId} is not a candidate in this bench run`);
    }

    // Phase 2: in-tx mutation — atomic state transition + approved_model_id
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(benchRuns)
      .set({
        approvedModelId: candidateModelId,
        state: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(benchRuns.id, benchRunId));

    // Phase 3: afterCommit side effects — WebSocket fanout (best-effort)
    // Note: emitted here inside the same tx; socket write is non-transactional.
    emitOrgUpdate(run.organisationId, 'bench:approval_succeeded', {
      benchRunId,
      approvedModelId: candidateModelId,
      targetAgentId: run.targetAgentId,
    });

    logger.info('bench_run.approved', {
      benchRunId,
      approvedModelId: candidateModelId,
      organisationId: run.organisationId,
    });

    return { approvedModelId: candidateModelId };
  },

  // ─── Get ──────────────────────────────────────────────────────────────────

  async get(benchRunId: string): Promise<BenchRun | null> {
    const db = getOrgScopedDb('benchRunService.get');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [run] = await db.select().from(benchRuns).where(eq(benchRuns.id, benchRunId));
    return run ?? null;
  },

  // ─── List results ─────────────────────────────────────────────────────────

  async listResults(benchRunId: string): Promise<typeof benchResults.$inferSelect[]> {
    const db = getOrgScopedDb('benchRunService.listResults');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    return db
      .select()
      .from(benchResults)
      .where(eq(benchResults.benchRunId, benchRunId))
      .orderBy(desc(benchResults.createdAt));
  },

  // ─── Quality drift list ───────────────────────────────────────────────────
  //
  // Returns per-agent summary of recent scorecard judgement quality.
  // Used by GET /api/quality/agents.

  async listAgentsDrift(): Promise<Array<{
    agentId: string;
    agentName: string;
    lastJudgedAt: Date | null;
    avgScore: number | null;
    pendingCount: number;
  }>> {
    const db = getOrgScopedDb('benchRunService.listAgentsDrift');
    const rows = await db.execute(sql`
      SELECT
        a.id                        AS agent_id,
        a.name                      AS agent_name,
        MAX(sj.created_at)          AS last_judged_at,
        AVG(sj.score)               AS avg_score,
        COUNT(CASE WHEN sj.verdict IS NULL THEN 1 END) AS pending_count
      FROM agents a
      LEFT JOIN scorecard_judgements sj
        ON sj.run_id IN (
          SELECT id FROM agent_runs WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 50
        )
      WHERE a.deleted_at IS NULL
      GROUP BY a.id, a.name
      ORDER BY a.name
    `);
    return (rows as unknown as Array<{
      agent_id: string;
      agent_name: string;
      last_judged_at: Date | null;
      avg_score: string | null;
      pending_count: string;
    }>).map(r => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      lastJudgedAt: r.last_judged_at,
      avgScore: r.avg_score !== null ? parseFloat(r.avg_score) : null,
      pendingCount: parseInt(r.pending_count, 10),
    }));
  },

  // ─── Bench history ────────────────────────────────────────────────────────

  async listBenchHistory(): Promise<BenchRun[]> {
    const db = getOrgScopedDb('benchRunService.listBenchHistory');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    return db
      .select()
      .from(benchRuns)
      .orderBy(desc(benchRuns.createdAt))
      .limit(50);
  },

  // ─── Internal: write summary after execute job completes ─────────────────
  //
  // Called by benchExecuteJob after all results are stored.
  // Not exposed as a route; only called from job context (uses getOrgScopedDb).

  async finalize(
    benchRunId: string,
    finalState: 'awaiting_approval' | 'partial' | 'failed',
    failureReason?: string,
  ): Promise<void> {
    const db = getOrgScopedDb('benchRunService.finalize');

    if (finalState === 'failed') {
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
      await db
        .update(benchRuns)
        .set({
          state: 'failed',
          failureReason: failureReason ?? 'Bench execute job failed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(benchRuns.id, benchRunId));
      return;
    }

    // Load all results to compute summary
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const results = await db
      .select()
      .from(benchResults)
      .where(eq(benchResults.benchRunId, benchRunId));

    const stats = aggregateModelStats(results);
    const summary = computeBenchSummary(stats);
    const totalCostCents = results.reduce((s, r) => s + (r.costCents ?? 0), 0);

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    await db
      .update(benchRuns)
      .set({
        state: finalState,
        summary,
        actualCostCents: totalCostCents,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(benchRuns.id, benchRunId));
  },
};
