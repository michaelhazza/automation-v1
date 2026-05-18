// server/jobs/benchExecuteJob.ts
// Bench execute job — runs all (candidate, sample) pairs for a bench_run.
// Trust & Verification Layer spec §12.4.
//
// Invariants enforced:
//   - FOR UPDATE SKIP LOCKED on bench_run: single-writer per bench.
//   - Per-(model, sample-index) idempotency via unique constraint.
//   - Partial completion → 'partial' state (some samples failed).
//   - All failed → 'failed' state.
//   - All succeeded → 'awaiting_approval' state + summary written.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { benchRuns, benchResults, agentRuns, agentExecutionEvents, agents } from '../db/schema/index.js';
import { routeCall } from '../services/llmRouter.js';
import { logger } from '../lib/logger.js';
import { dispatchCheck } from '../services/scorecardDispatcher.js';
import { benchRunService } from '../services/benchRunService.js';
import type { NewBenchResult } from '../db/schema/benchRuns.js';
import type { QualityCheck } from '../db/schema/scorecards.js';
import type { RunMetadata } from '../lib/scorecardValidators/types.js';

export interface BenchExecuteJobPayload {
  benchRunId: string;
  organisationId: string;
}

const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5-20251001';

// ── Sample input resolution ───────────────────────────────────────────────────

interface SampleInput {
  sampleIndex: number;
  userInput: string;
  agentName: string;
}

async function resolveSampleInputs(
  scopedDb: ReturnType<typeof getOrgScopedDb>,
  targetAgentId: string,
  sampleCount: number,
): Promise<SampleInput[]> {
  const [agentRow] = await scopedDb
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, targetAgentId));
  const agentName = agentRow?.name ?? 'Agent';

  // Fetch recent completed agent_runs as sample pool
  const recentRuns = await scopedDb
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, targetAgentId))
    .orderBy(sql`${agentRuns.createdAt} DESC`)
    .limit(sampleCount);

  if (recentRuns.length === 0) return [];

  const samples: SampleInput[] = [];
  for (let i = 0; i < recentRuns.length; i++) {
    const run = recentRuns[i]!;
    // Get the first non-system event payload from this run as the "input"
    const [firstEvent] = await scopedDb
      .select({ payload: agentExecutionEvents.payload })
      .from(agentExecutionEvents)
      .where(eq(agentExecutionEvents.runId, run.id))
      .orderBy(sql`${agentExecutionEvents.sequenceNumber} ASC`)
      .limit(1);

    const payload = firstEvent?.payload as Record<string, unknown> | undefined;
    const userInput =
      typeof payload?.content === 'string' ? payload.content :
      typeof payload?.message === 'string' ? payload.message :
      `Sample run ${i + 1}`;

    samples.push({ sampleIndex: i, userInput, agentName });
  }
  return samples;
}

// ── Per-sample-per-candidate runner ──────────────────────────────────────────

interface SampleRunResult {
  verdict: 'pass' | 'fail' | 'inconclusive' | 'error';
  score: number | null;
  reasoning: string;
  rawOutput: string;
  latencyMs: number;
}

async function runOneSample(params: {
  candidateModelId: string;
  judgeModelId: string;
  sample: SampleInput;
  benchRunId: string;
  organisationId: string;
}): Promise<SampleRunResult> {
  const { candidateModelId, judgeModelId, sample, organisationId, benchRunId } = params;

  // ── Step 1: Run the candidate model ────────────────────────────────────────
  const candidateStart = Date.now();
  let rawOutput: string;

  try {
    const candidateResponse = await routeCall({
      messages: [{ role: 'user', content: sample.userInput }],
      system: `You are ${sample.agentName}. Answer the user's request helpfully.`,
      maxTokens: 2_048,
      context: {
        organisationId,
        sourceType: 'system',
        agentName: candidateModelId,
        taskType: 'general',
        routingMode: 'ceiling',
        featureTag: 'bench-candidate',
        systemCallerPolicy: 'bypass_routing',
        provider: candidateModelId.startsWith('claude') ? 'anthropic' : 'openai',
        model: candidateModelId,
      },
    });
    rawOutput = typeof candidateResponse.content === 'string' ? candidateResponse.content : '';
  } catch (err) {
    logger.warn('bench_execute.candidate_failed', {
      benchRunId,
      candidateModelId,
      sampleIndex: sample.sampleIndex,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      verdict: 'error',
      score: null,
      reasoning: `Candidate call failed: ${err instanceof Error ? err.message : String(err)}`,
      rawOutput: '',
      latencyMs: Date.now() - candidateStart,
    };
  }

  const latencyMs = Date.now() - candidateStart;

  // ── Step 2: Judge the output via dispatcher (semantic path for bench runs) ──
  // Bench runs use a synthetic QualityCheck with kind: 'semantic' to preserve
  // existing behaviour. Deterministic dispatch is enabled when the underlying
  // rubric is attached (see spec §3 "no bypass flag" requirement).
  const benchQc: QualityCheck = {
    slug: 'bench_response_quality',
    name: 'Response Quality',
    description: 'Is the response helpful, accurate, and well-formed?',
    kind: 'semantic',
  };
  const benchRunMeta: RunMetadata = {
    skillSlug: '',
    agentId: '',
    subaccountId: '',
    runId: benchRunId,
    invokedSkillSlugs: [],
  };

  const judgeOutcome = await dispatchCheck({
    qc: benchQc,
    runOutput: `User input: ${sample.userInput}\n\nCandidate output: ${rawOutput}`,
    runMetadata: benchRunMeta,
    judgementRunId: `bench:${benchRunId}:${candidateModelId}:${sample.sampleIndex}`,
    organisationId,
    scorecardName: 'Bench Quality Check',
    agentName: sample.agentName,
    judgeModelId,
  });

  return {
    verdict: judgeOutcome.verdict === 'pass' || judgeOutcome.verdict === 'fail'
      ? judgeOutcome.verdict
      : 'inconclusive',
    score: judgeOutcome.score,
    reasoning: judgeOutcome.reasoning,
    rawOutput,
    latencyMs,
  };
}

// ── Job handler ───────────────────────────────────────────────────────────────

export async function benchExecuteJobHandler(job: { data: BenchExecuteJobPayload }): Promise<void> {
  const { benchRunId, organisationId } = job.data;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);

    await withOrgTx(
      { tx, organisationId, subaccountId: null, source: `pgboss:bench:execute:${benchRunId}` },
      async () => {
        const scopedDb = getOrgScopedDb('benchExecuteJob');

        // FOR UPDATE SKIP LOCKED — single writer per bench run
        const lockRows = await scopedDb.execute(
          sql`SELECT id, state, candidate_model_ids, sample_count, target_agent_id
              FROM bench_runs
              WHERE id = ${benchRunId}
              FOR UPDATE SKIP LOCKED`,
        );

        const run = (lockRows as unknown as Array<{
          id: string;
          state: string;
          candidate_model_ids: string[];
          sample_count: number;
          target_agent_id: string | null;
        }>)[0];

        if (!run) {
          logger.warn('bench_execute.skipped_locked_or_missing', { benchRunId });
          return;
        }

        if (run.state !== 'running') {
          logger.warn('bench_execute.wrong_state', { benchRunId, state: run.state });
          return;
        }

        const candidateModelIds: string[] = Array.isArray(run.candidate_model_ids)
          ? run.candidate_model_ids
          : [];
        const sampleCount: number = run.sample_count;
        const targetAgentId: string | null = run.target_agent_id;

        const samples = targetAgentId
          ? await resolveSampleInputs(scopedDb, targetAgentId, sampleCount)
          : [];

        if (samples.length === 0) {
          logger.warn('bench_execute.no_samples', { benchRunId, targetAgentId });
          await benchRunService.finalize(benchRunId, 'failed', 'No sample inputs found for target agent');
          return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const candidateModelId of candidateModelIds) {
          for (const sample of samples) {
            // Idempotency — skip if result row already exists
            const [existing] = await scopedDb
              .select({ id: benchResults.id })
              .from(benchResults)
              .where(and(
                eq(benchResults.benchRunId, benchRunId),
                eq(benchResults.candidateModelId, candidateModelId),
                eq(benchResults.sampleIndex, sample.sampleIndex),
              ));

            if (existing) {
              successCount += 1;
              continue;
            }

            try {
              const result = await runOneSample({
                candidateModelId,
                judgeModelId: DEFAULT_JUDGE_MODEL,
                sample,
                benchRunId,
                organisationId,
              });

              await scopedDb
                .insert(benchResults)
                .values({
                  organisationId,
                  benchRunId,
                  candidateModelId,
                  sampleIndex: sample.sampleIndex,
                  verdict: result.verdict,
                  score: result.score ?? undefined,
                  reasoning: result.reasoning || null,
                  latencyMs: result.latencyMs,
                  costCents: undefined,
                  rawOutput: result.rawOutput,
                } satisfies NewBenchResult)
                .onConflictDoNothing();

              if (result.verdict !== 'error') successCount += 1;
              else errorCount += 1;
            } catch (err) {
              errorCount += 1;
              logger.error('bench_execute.sample_failed', {
                benchRunId, candidateModelId, sampleIndex: sample.sampleIndex,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        const finalState: 'awaiting_approval' | 'partial' | 'failed' =
          errorCount === 0 ? 'awaiting_approval' :
          successCount > 0 ? 'partial' :
          'failed';

        await benchRunService.finalize(
          benchRunId, finalState,
          finalState === 'failed' ? `All ${candidateModelIds.length * samples.length} samples failed` : undefined,
        );

        logger.info('bench_execute.complete', {
          benchRunId, finalState,
          total: candidateModelIds.length * samples.length,
          successCount, errorCount,
        });
      },
    );
  });
}
