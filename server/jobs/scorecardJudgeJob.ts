// server/jobs/scorecardJudgeJob.ts
// Scorecard judge job — routes each quality check via the dispatcher
// (deterministic, hybrid, or semantic LLM path).
// Trust & Verification Layer spec §12.3, §6.5 F1 snapshot invariant, §10.1.
// Deterministic-validators spec §7, §11 Step 3.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { scorecards, scorecardJudgements, agentRuns, agents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { sendWithTx } from '../lib/pgBossTxSend.js';
import { dispatchCheck } from '../services/scorecardDispatcher.js';
import type { QualityCheck } from '../db/schema/scorecards.js';
import type { NewScorecardJudgement } from '../db/schema/scorecardJudgements.js';
import type { RunMetadata } from '../lib/scorecardValidators/types.js';

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

export async function scorecardJudgeJobHandler(job: { data: ScorecardJudgeJobPayload }): Promise<void> {
  const { runId, scorecardId, qualityCheckSlug, triggerSource, organisationId } = job.data;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      { tx, organisationId, subaccountId: null, source: `pgboss:scorecard:judge:${runId}` },
      async () => {
        const db = getOrgScopedDb('scorecardJudgeJob');

        // 1. Load run + agent context
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: local db binding is result of getOrgScopedDb — scoped to org via withOrgTx wrapper in createWorker"
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
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: local db binding is result of getOrgScopedDb — scoped to org via withOrgTx wrapper in createWorker"
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

        // 3. Build RunMetadata — populated before any validator runs (spec §7.5).
        const runMeta: RunMetadata = {
          skillSlug: '',
          agentId: runRow.run.agentId,
          subaccountId: runRow.run.subaccountId ?? '',
          runId,
          invokedSkillSlugs: Array.isArray((runRow.run as { resolvedSkillSlugs?: unknown }).resolvedSkillSlugs)
            ? ((runRow.run as { resolvedSkillSlugs?: unknown }).resolvedSkillSlugs as string[])
            : [],
        };

        // 4. Dispatch via the dispatcher (deterministic, hybrid, or semantic LLM path).
        const outcome = await dispatchCheck({
          qc,
          runOutput: runSummary,
          runMetadata: runMeta,
          judgementRunId: `${runId}:${scorecardId}`,
          organisationId,
          scorecardName: sc.name,
          agentName,
          judgeModelId,
        });

        const { verdict, score, reasoning, evaluationMethod, validatorSlug, validatorVersion } = outcome;

        // Emit safety_class_check_failed event when a safety-class check fails (spec §7.6).
        if (qc.safetyClass && verdict === 'fail') {
          logger.info('safety_class_check_failed', {
            scorecardId,
            checkSlug: qualityCheckSlug,
            runId,
            agentId: runRow.run.agentId,
            subaccountId: runRow.run.subaccountId ?? null,
          });
        }

        // 5 & 6. INSERT with ON CONFLICT DO NOTHING (idempotency).
        // ON CONFLICT targets the actual 4-tuple unique index (Finding 1 from plan):
        // scorecard_judgements_run_scorecard_check_trigger_uniq
        // on (run_id, scorecard_id, quality_check_slug, trigger_source).
        const newRow: NewScorecardJudgement = {
          organisationId,
          runId,
          scorecardId,
          qualityCheckSlug,
          triggerSource: toDbTriggerSource(triggerSource),
          verdict,
          score: verdict === 'inconclusive' ? null : (score ?? undefined),
          reasoning: reasoning || null,
          snapshotScorecardName: sc.name,
          snapshotQualityCheckName: qc.name,
          snapshotQualityCheckDesc: qc.description ?? null,
          snapshotJudgeModelId: judgeModelId,
          snapshotRubricVersion: 1,
          evaluationMethod,
          validatorSlug: validatorSlug ?? undefined,
          validatorVersion: validatorVersion ?? undefined,
        };

        let insertedJudgementId: string | undefined;
        try {
          // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: local db binding is result of getOrgScopedDb — scoped to org via withOrgTx wrapper in createWorker"
          const insertResult = await db
            .insert(scorecardJudgements)
            .values(newRow)
            .onConflictDoNothing()
            .returning({ id: scorecardJudgements.id });
          insertedJudgementId = insertResult[0]?.id;
        } catch (err) {
          logger.error('scorecard_judge.insert_failed', {
            runId, scorecardId, qualityCheckSlug,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        // 7. Emit event (structured log — WebSocket pulse picks up DB row change)
        logger.info('scorecard_judgement.recorded', {
          runId, scorecardId, qualityCheckSlug, triggerSource, verdict, score,
        });

        // 7a. Inconclusive-threshold alert (spec §7.3).
        // After each verdict insert, check if all enabled checks for this
        // run/scorecard are now complete and the inconclusive ratio exceeds
        // the alert threshold. This fires once from whichever check completes
        // last; idempotency is acceptable (structured log only).
        if (insertedJudgementId) {
          // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: local db binding is result of getOrgScopedDb — scoped to org via withOrgTx wrapper in createWorker"
          const allVerdicts = await db
            .select({ verdict: scorecardJudgements.verdict })
            .from(scorecardJudgements)
            .where(and(
              eq(scorecardJudgements.runId, runId),
              eq(scorecardJudgements.scorecardId, scorecardId),
            ));
          const enabledChecks = (sc.qualityChecks as QualityCheck[]).filter(q => q.enabled !== false);
          if (allVerdicts.length >= enabledChecks.length && enabledChecks.length > 0) {
            const inconclusiveCount = allVerdicts.filter(v => v.verdict === 'inconclusive').length;
            const threshold = parseFloat(sc.inconclusiveAlertThreshold ?? '0.20');
            if (inconclusiveCount / allVerdicts.length > threshold) {
              logger.warn('scorecard_judge.inconclusive_threshold_exceeded', {
                runId, scorecardId,
                inconclusiveCount,
                totalChecks: allVerdicts.length,
                threshold,
              });
            }
          }
        }

        // 8. Dispatch failure:post-mortem inside the same transaction (Chunk 3).
        // Only dispatched when the insert produced a new row (idempotency guard —
        // ON CONFLICT DO NOTHING means a retry would return no row here).
        if (verdict === 'fail' && insertedJudgementId) {
          const subaccountId = runRow.run.subaccountId ?? null;
          if (subaccountId) {
            await sendWithTx(tx, 'failure:post-mortem', {
              scorecardJudgementId: insertedJudgementId,
              runId,
              organisationId,
              subaccountId,
              qualityCheckSlug,
            }, {
              singletonKey: `failure-post-mortem:${insertedJudgementId}`,
            });
          }
        }
      },
    );
  });
}
