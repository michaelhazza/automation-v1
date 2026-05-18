// ---------------------------------------------------------------------------
// amendmentRegressionReplayJob — per-amendment regression replay worker.
// Closed-Loop Skill Improvement spec §9.2 (Chunk 7).
//
// Queue: amendment:regression-replay
// Triggered by: skillAmendmentService.accept() inside accept transaction.
// Idempotency: status check on amendment row; ON CONFLICT DO UPDATE on effectiveness sidecar.
// ---------------------------------------------------------------------------

import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { withOrgTx } from '../instrumentation.js';
import { db } from '../db/index.js';
import {
  skillAmendments,
  skillRegressionCases,
  skillAmendmentEffectiveness,
  agentRuns,
  scorecardJudgements,
  scorecards,
} from '../db/schema/index.js';
import { buildJudgePrompt, computeVerdict } from '../services/scorecardJudgeRunnerPure.js';
import { routeCall } from '../services/llmRouter.js';
import { skillAmendmentService } from '../services/skillAmendmentService.js';
import { logger } from '../lib/logger.js';
import {
  expectedVerdictForTag,
  detectRollback,
} from './amendmentRegressionReplayJobPure.js';
import type { ReplayOutcome } from './amendmentRegressionReplayJobPure.js';

const DEFAULT_JUDGE_MODEL_ID = 'claude-haiku-4-5-20251001';
const MAX_JSON_RETRIES = 3;

export interface RegressionReplayPayload {
  amendmentId: string;
  organisationId: string;
  subaccountId: string;
  systemSkillId: string | null;
  orgSkillId: string | null;
}

export async function regressionReplayJobHandler(
  job: { data: RegressionReplayPayload },
): Promise<void> {
  const { amendmentId, organisationId, subaccountId } = job.data;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      { tx, organisationId, subaccountId, source: `pgboss:amendment:regression-replay:${amendmentId}` },
      async () => {
        const scopedDb = getOrgScopedDb('amendmentRegressionReplayJob');

        // 1. Fetch the amendment — idempotency guard (only run if still 'accepted').
        const [amendment] = await scopedDb
          .select({
            id: skillAmendments.id,
            status: skillAmendments.status,
            proposerModelVersion: skillAmendments.proposerModelVersion,
          })
          .from(skillAmendments)
          .where(and(eq(skillAmendments.id, amendmentId), eq(skillAmendments.orgId, organisationId)));

        if (!amendment) {
          logger.warn('amendment.regression_replay.amendment_not_found', { amendmentId, organisationId });
          return;
        }

        if (amendment.status !== 'accepted') {
          logger.info('amendment.regression_replay.skipped_not_accepted', {
            amendmentId,
            status: amendment.status,
          });
          return;
        }

        // 2. Fetch all regression cases for this amendment.
        const cases = await scopedDb
          .select({
            id: skillRegressionCases.id,
            tag: skillRegressionCases.tag,
            scorecardJudgementId: skillRegressionCases.scorecardJudgementId,
          })
          .from(skillRegressionCases)
          .where(eq(skillRegressionCases.amendmentId, amendmentId));

        if (cases.length === 0) {
          logger.info('amendment.regression_replay.no_cases', { amendmentId });
          await upsertEffectiveness(scopedDb, amendmentId, organisationId, 'pass');
          return;
        }

        // 3. Replay each non-unresolved case via the scorecard judge.
        const outcomes: ReplayOutcome[] = [];
        let infrastructureMissing = false;

        for (const kase of cases) {
          const tag = kase.tag as 'fix_proposed' | 'fix_wrong' | 'unresolved';
          const expectedVerdict = expectedVerdictForTag(tag);

          if (expectedVerdict === 'skip') {
            continue;
          }

          try {
            const actualVerdict = await replayOneCase(scopedDb, kase.scorecardJudgementId, organisationId);

            if (actualVerdict === null) {
              infrastructureMissing = true;
              outcomes.push({ caseId: kase.id, tag, expectedVerdict, actualVerdict: 'inconclusive' });
            } else {
              outcomes.push({ caseId: kase.id, tag, expectedVerdict, actualVerdict });
            }
          } catch (err) {
            logger.warn('amendment.regression_replay.case_error', {
              amendmentId,
              caseId: kase.id,
              error: err instanceof Error ? err.message : String(err),
            });
            outcomes.push({ caseId: kase.id, tag, expectedVerdict, actualVerdict: 'inconclusive' });
          }
        }

        if (infrastructureMissing) {
          logger.warn('amendment.replay_infrastructure_missing', {
            amendmentId,
            inconclusiveCaseCount: outcomes.filter((o) => o.actualVerdict === 'inconclusive').length,
          });
        }

        // 4. Detect rollback condition.
        const rollbackResult = detectRollback(outcomes);

        if (rollbackResult.rollback) {
          // 5a. Rollback: retire the amendment, emit alert, update metrics.
          logger.warn('amendment.rollback_triggered', {
            amendmentId,
            offendingCaseIds: rollbackResult.offendingCaseIds,
          });

          await skillAmendmentService.retire(amendmentId, 'rollback', organisationId, 'sev2');

          const regressionFailureCount = rollbackResult.offendingCaseIds.length;

          if (amendment.proposerModelVersion) {
            const today = new Date().toISOString().slice(0, 10);
            await scopedDb.execute(sql`
              INSERT INTO amendment_proposer_metrics (proposer_model_version, period_start, rollback_count, regression_failure_after_accept_count)
              VALUES (${amendment.proposerModelVersion}, ${today}::date, 1, ${regressionFailureCount})
              ON CONFLICT (proposer_model_version, period_start) DO UPDATE
                SET rollback_count = amendment_proposer_metrics.rollback_count + 1,
                    regression_failure_after_accept_count =
                      amendment_proposer_metrics.regression_failure_after_accept_count + ${regressionFailureCount},
                    updated_at = now()
            `);
          }

          // Update fix_proposed cases that failed replay to fix_wrong.
          for (const caseId of rollbackResult.offendingCaseIds) {
            await scopedDb
              .update(skillRegressionCases)
              .set({ tag: 'fix_wrong', updatedAt: new Date() })
              .where(eq(skillRegressionCases.id, caseId));
          }

          await upsertEffectiveness(scopedDb, amendmentId, organisationId, 'rollback');
        } else {
          // 5b. No rollback.
          await upsertEffectiveness(scopedDb, amendmentId, organisationId, 'pass');
        }

        logger.info('amendment.regression_replay.complete', {
          amendmentId,
          outcomeCount: outcomes.length,
          rollback: rollbackResult.rollback,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Replay one regression case — re-run the scorecard judge on the original run.
// Returns null when required data cannot be found (replay infrastructure gap).
// ---------------------------------------------------------------------------

async function replayOneCase(
  scopedDb: ReturnType<typeof getOrgScopedDb>,
  scorecardJudgementId: string,
  organisationId: string,
): Promise<'pass' | 'fail' | 'inconclusive' | null> {
  const [judgement] = await scopedDb
    .select({
      runId: scorecardJudgements.runId,
      scorecardId: scorecardJudgements.scorecardId,
      snapshotScorecardName: scorecardJudgements.snapshotScorecardName,
      snapshotQualityCheckName: scorecardJudgements.snapshotQualityCheckName,
      snapshotQualityCheckDesc: scorecardJudgements.snapshotQualityCheckDesc,
      snapshotJudgeModelId: scorecardJudgements.snapshotJudgeModelId,
    })
    .from(scorecardJudgements)
    .where(
      and(
        eq(scorecardJudgements.id, scorecardJudgementId),
        eq(scorecardJudgements.organisationId, organisationId),
      ),
    );

  if (!judgement) return null;

  const [runRow] = await scopedDb
    .select({ summary: agentRuns.summary })
    .from(agentRuns)
    .where(eq(agentRuns.id, judgement.runId));

  if (!runRow) return null;

  const [scorecardRow] = await scopedDb
    .select({ name: scorecards.name })
    .from(scorecards)
    .where(eq(scorecards.id, judgement.scorecardId));

  const runSummary = (runRow.summary as string | null | undefined) ?? '[No summary available]';
  const agentName = scorecardRow?.name ?? 'Unknown agent';
  const judgeModelId = judgement.snapshotJudgeModelId ?? DEFAULT_JUDGE_MODEL_ID;

  const { system, user } = buildJudgePrompt({
    scorecardName: judgement.snapshotScorecardName,
    qualityCheckName: judgement.snapshotQualityCheckName,
    qualityCheckDesc: judgement.snapshotQualityCheckDesc,
    runSummary,
    agentName,
  });

  for (let attempt = 0; attempt < MAX_JSON_RETRIES; attempt++) {
    const userMsg = attempt === 0 ? user : `${user}\n\n[Retry attempt: ${attempt}]`;
    try {
      const response = await routeCall({
        messages: [{ role: 'user', content: userMsg }],
        system,
        maxTokens: 512,
        context: {
          organisationId,
          sourceType: 'system',
          taskType: 'review',
          routingMode: 'ceiling',
          featureTag: 'amendment-regression-replay',
          systemCallerPolicy: 'bypass_routing',
          provider: 'anthropic',
          model: judgeModelId,
        },
      });

      const raw = typeof response.content === 'string' ? response.content.trim() : '';
      const parsed = JSON.parse(raw) as { observedScore?: unknown };
      if (typeof parsed.observedScore === 'number') {
        return computeVerdict(parsed.observedScore);
      }
    } catch {
      // Retry on malformed JSON or transient LLM error.
    }
  }

  return 'inconclusive';
}

// ---------------------------------------------------------------------------
// UPSERT the effectiveness sidecar row for this amendment.
// ---------------------------------------------------------------------------

async function upsertEffectiveness(
  scopedDb: ReturnType<typeof getOrgScopedDb>,
  amendmentId: string,
  orgId: string,
  lastReplayVerdict: string,
): Promise<void> {
  await scopedDb
    .insert(skillAmendmentEffectiveness)
    .values({
      amendmentId,
      orgId,
      lastReplayRunAt: new Date(),
      lastReplayVerdict,
    })
    .onConflictDoUpdate({
      target: skillAmendmentEffectiveness.amendmentId,
      set: {
        lastReplayRunAt: new Date(),
        lastReplayVerdict,
        updatedAt: new Date(),
      },
    });
}
