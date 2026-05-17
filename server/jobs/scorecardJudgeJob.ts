// server/jobs/scorecardJudgeJob.ts
// Scorecard judge job — runs one LLM call to evaluate a single quality check.
// Trust & Verification Layer spec §12.3, §6.5 F1 snapshot invariant, §10.1.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { scorecards, scorecardJudgements, agentRuns, agents } from '../db/schema/index.js';
import { routeCall } from '../services/llmRouter.js';
import { logger } from '../lib/logger.js';
import { buildJudgePrompt, computeVerdict } from '../services/scorecardJudgeRunnerPure.js';
import type { QualityCheck } from '../db/schema/scorecards.js';
import type { NewScorecardJudgement } from '../db/schema/scorecardJudgements.js';

export interface ScorecardJudgeJobPayload {
  runId: string;
  scorecardId: string;
  qualityCheckSlug: string;
  triggerSource: 'sampled' | 'forced_runtime_check_fail' | 'forced_correction';
  organisationId: string;
}

// Maps job trigger source to the schema's trigger_source enum
function toDbTriggerSource(
  src: ScorecardJudgeJobPayload['triggerSource'],
): 'sampled' | 'forced' | 'bench' {
  if (src === 'sampled') return 'sampled';
  return 'forced';
}

const DEFAULT_JUDGE_MODEL_ID = 'claude-haiku-4-5-20251001';
const MAX_JSON_RETRIES = 3;

export async function scorecardJudgeJobHandler(job: { data: ScorecardJudgeJobPayload }): Promise<void> {
  const { runId, scorecardId, qualityCheckSlug, triggerSource, organisationId } = job.data;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      { tx, organisationId, subaccountId: null, source: `pgboss:scorecard:judge:${runId}` },
      async () => {
        const db = getOrgScopedDb('scorecardJudgeJob');

        // 1. Load run + agent context
        // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
        const runRows = await db
          .select({ run: agentRuns, agentName: agents.name })
          .from(agentRuns)
          .leftJoin(agents, eq(agents.id, agentRuns.agentId))
          .where(eq(agentRuns.id, runId));
        const runRow = runRows[0];
        if (!runRow) {
          logger.warn('scorecard_judge.run_not_found', { runId, scorecardId, qualityCheckSlug });
          return;
        }

        // 2. Load scorecard — F1 snapshot captured at judgement time; skip soft-deleted
        // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
        const scRows = await db
          .select()
          .from(scorecards)
          .where(and(eq(scorecards.id, scorecardId), isNull(scorecards.deletedAt)));
        const sc = scRows[0];
        if (!sc) {
          logger.warn('scorecard_judge.scorecard_not_found', { runId, scorecardId, qualityCheckSlug });
          return;
        }

        const qc = (sc.qualityChecks as QualityCheck[]).find(q => q.slug === qualityCheckSlug);
        if (!qc) {
          logger.warn('scorecard_judge.quality_check_not_found', { runId, scorecardId, qualityCheckSlug });
          return;
        }
        // Spec §6.3 — disabled checks must not be graded. Defence-in-depth:
        // buildFanoutJobs / selectForcedGradeTargets already filter disabled,
        // but the job-level guard catches racing edits where the scorecard
        // was edited between fanout and dispatch.
        if (qc.enabled === false) {
          logger.info('scorecard_judge.skipped_disabled_check', {
            runId, scorecardId, qualityCheckSlug,
          });
          return;
        }

        const judgeModelId = sc.judgeModelId ?? DEFAULT_JUDGE_MODEL_ID;
        const runSummary = (runRow.run as { summary?: string }).summary ?? '[No summary available]';
        const agentName = runRow.agentName ?? 'Unknown agent';

        // 3. Build judge prompt
        const { system, user } = buildJudgePrompt({
          scorecardName: sc.name,
          qualityCheckName: qc.name,
          qualityCheckDesc: qc.description,
          runSummary,
          agentName,
        });

        // 4. Call LLM — retry up to MAX_JSON_RETRIES on malformed JSON.
        // Append attempt marker on retries so the router computes a distinct
        // idempotency key per attempt (router key is hash of messages + ctx).
        let observedScore: number | null = null;
        let judgeReasoning: string = '';
        let verdict: 'pass' | 'fail' | 'inconclusive' = 'inconclusive';

        for (let attempt = 0; attempt < MAX_JSON_RETRIES; attempt++) {
          const userMsg = attempt === 0 ? user : `${user}\n\n[Retry attempt: ${attempt}]`;
          try {
            const response = await routeCall({
              messages: [{ role: 'user', content: userMsg }],
              system,
              maxTokens: 512,
              context: {
                organisationId,
                runId,
                sourceType: 'system',
                agentName: 'scorecard-judge',
                taskType: 'review',
                routingMode: 'ceiling',
                featureTag: 'scorecard-judge',
                systemCallerPolicy: 'bypass_routing',
                provider: 'anthropic',
                model: judgeModelId,
              },
            });

            const raw = typeof response.content === 'string' ? response.content.trim() : '';
            const parsed = JSON.parse(raw) as { observedScore?: unknown; judgeReasoning?: unknown };
            if (typeof parsed.observedScore === 'number' && typeof parsed.judgeReasoning === 'string') {
              observedScore = parsed.observedScore;
              judgeReasoning = parsed.judgeReasoning;
              // Spec §6.5 — verdict = observedScore >= passMark. Use the
              // quality check's per-check passMark when set; computeVerdict
              // falls back to DEFAULT_PASS_MARK when undefined.
              verdict = computeVerdict(observedScore, qc.passMark);
              break;
            }
            logger.warn('scorecard_judge.malformed_json', { runId, scorecardId, qualityCheckSlug, attempt, raw });
          } catch (err) {
            logger.warn('scorecard_judge.llm_error', {
              runId, scorecardId, qualityCheckSlug, attempt,
              error: err instanceof Error ? err.message : String(err),
            });
            if (attempt === MAX_JSON_RETRIES - 1) {
              verdict = 'inconclusive';
            }
          }
        }

        // 5 & 6. INSERT with ON CONFLICT DO NOTHING (idempotency)
        const newRow: NewScorecardJudgement = {
          organisationId,
          runId,
          scorecardId,
          qualityCheckSlug,
          triggerSource: toDbTriggerSource(triggerSource),
          verdict,
          score: verdict === 'inconclusive' ? null : (observedScore ?? undefined),
          reasoning: judgeReasoning || null,
          snapshotScorecardName: sc.name,
          snapshotQualityCheckName: qc.name,
          snapshotQualityCheckDesc: qc.description ?? null,
          snapshotJudgeModelId: judgeModelId,
          snapshotRubricVersion: 1,
        };

        try {
          // guard-ignore: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
          await db
            .insert(scorecardJudgements)
            .values(newRow)
            .onConflictDoNothing();
        } catch (err) {
          logger.error('scorecard_judge.insert_failed', {
            runId, scorecardId, qualityCheckSlug,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        // 7. Emit event (structured log — WebSocket pulse picks up DB row change)
        logger.info('scorecard_judgement.recorded', {
          runId, scorecardId, qualityCheckSlug, triggerSource, verdict, score: observedScore,
        });
      },
    );
  });
}
