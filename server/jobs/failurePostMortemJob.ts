// ---------------------------------------------------------------------------
// failurePostMortemJob — RCA-only handler for closed-loop skill improvement.
// Closed-Loop Skill Improvement spec §9.1 steps 1–6 (Chunk 3, sanity gate).
//
// HARD RULE: This handler must NOT write to skill_amendments,
// peer_reviewer_drops, or skill_regression_cases tables. RCA outputs are
// logged and written to local JSON files only. Chunk 4 implements those writes.
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import {
  skillAmendments,
  skillAmendmentFreezes,
  skillAmendmentRunSnapshot,
  scorecardJudgements,
  agentRuns,
  skills,
} from '../db/schema/index.js';
import { routeCall } from '../services/llmRouter.js';
import { buildRcaPrompt, validateRcaProposerOutput } from '../services/rcaPromptBuilder.js';
import {
  checkAmendmentCaps,
  deriveAmendmentStackFromSnapshot,
} from './failurePostMortemJobPure.js';

export interface FailurePostMortemPayload {
  scorecardJudgementId: string;
  runId: string;
  organisationId: string;
  subaccountId: string;
  skillSlug: string;
}

const RCA_SAMPLES_DIR = path.resolve(
  process.cwd(),
  'tasks/builds/closed-loop-skill-improvement/rca-samples',
);

export async function failurePostMortemJobHandler(
  job: { data: FailurePostMortemPayload },
): Promise<void> {
  const { scorecardJudgementId, runId, organisationId, subaccountId, skillSlug } = job.data;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      {
        tx,
        organisationId,
        subaccountId,
        source: 'pgboss:failure-post-mortem',
      },
      async () => {
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: local db binding is result of getOrgScopedDb — scoped to org via withOrgTx wrapper"
        const scopedDb = getOrgScopedDb('failurePostMortemJob');

        // Step 1 — Freeze check
        const freezeRows = await scopedDb
          .select({ id: skillAmendmentFreezes.id })
          .from(skillAmendmentFreezes)
          .where(
            and(
              eq(skillAmendmentFreezes.orgId, organisationId),
              eq(skillAmendmentFreezes.subaccountId, subaccountId),
              isNull(skillAmendmentFreezes.thawedAt),
              or(
                eq(skillAmendmentFreezes.freezeType, 'proposal_generation'),
                eq(skillAmendmentFreezes.freezeType, 'review_required'),
              ),
            ),
          );
        if (freezeRows.length > 0) {
          logger.info('amendment.dropped.freeze_active', {
            scorecardJudgementId,
            runId,
            organisationId,
            subaccountId,
            skillSlug,
            freezeId: freezeRows[0].id,
          });
          return;
        }

        // Step 2 — Load snapshot row first (needed for skill ID resolution)
        const snapshotRows = await scopedDb
          .select()
          .from(skillAmendmentRunSnapshot)
          .where(eq(skillAmendmentRunSnapshot.runId, runId));
        const snapshotRow = snapshotRows[0];

        if (!snapshotRow) {
          logger.info('amendment.dropped.snapshot_missing', {
            scorecardJudgementId,
            runId,
            organisationId,
            subaccountId,
            skillSlug,
          });
          logger.info('composition.degraded', {
            reason: 'snapshot_missing',
            scorecardJudgementId,
            runId,
          });
          return;
        }

        // Resolve the skill ID (exactly one of systemSkillId / orgSkillId is set on snapshot)
        const resolvedSkillId = snapshotRow.systemSkillId ?? snapshotRow.orgSkillId;
        if (!resolvedSkillId) {
          logger.info('amendment.dropped.snapshot_missing', {
            scorecardJudgementId,
            runId,
            reason: 'no_skill_id_on_snapshot',
          });
          return;
        }

        // Step 3 — Lifetime cap check (accepted amendments for this skill/subaccount/org)
        const allAmendmentRows = await scopedDb
          .select({ createdAt: skillAmendments.createdAt, status: skillAmendments.status })
          .from(skillAmendments)
          .where(
            and(
              eq(skillAmendments.orgId, organisationId),
              eq(skillAmendments.subaccountId, subaccountId),
              or(
                eq(skillAmendments.systemSkillId, resolvedSkillId),
                eq(skillAmendments.orgSkillId, resolvedSkillId),
              ),
            ),
          );

        const caps = checkAmendmentCaps(allAmendmentRows, new Date());

        if (caps.lifetimeCapExceeded) {
          await scopedDb.insert(skillAmendmentFreezes).values({
            orgId: organisationId,
            subaccountId,
            scope: 'skill',
            scopeId: resolvedSkillId,
            freezeType: 'review_required',
            reason: 'lifetime_cap_reached',
            createdByUserId: null,
          });
          logger.info('amendment.dropped.cap_exceeded', {
            scorecardJudgementId,
            runId,
            organisationId,
            subaccountId,
            skillSlug,
            subKind: 'lifetime',
            lifetimeCount: caps.lifetimeCount,
          });
          return;
        }

        // Step 4 — Weekly cap check
        if (caps.weeklyCapExceeded) {
          logger.info('amendment.dropped.cap_exceeded', {
            scorecardJudgementId,
            runId,
            organisationId,
            subaccountId,
            skillSlug,
            subKind: 'weekly',
            weeklyCount: caps.weeklyCount,
          });
          return;
        }

        // Step 5 — Inherited-skill detection via snapshot
        // Custom skill: system_skill_id IS NULL AND org_skill_id references a skill
        // with subaccount_id IS NOT NULL.
        if (snapshotRow.systemSkillId === null && snapshotRow.orgSkillId !== null) {
          const skillRows = await scopedDb
            .select({ subaccountId: skills.subaccountId })
            .from(skills)
            .where(eq(skills.id, snapshotRow.orgSkillId));
          if (skillRows[0]?.subaccountId !== null && skillRows[0]?.subaccountId !== undefined) {
            logger.info('amendment.dropped.custom_skill', {
              scorecardJudgementId,
              runId,
              organisationId,
              subaccountId,
              skillSlug,
              orgSkillId: snapshotRow.orgSkillId,
            });
            return;
          }
        }

        // Step 6 — Context assembly
        const judgementRows = await scopedDb
          .select({
            id: scorecardJudgements.id,
            runId: scorecardJudgements.runId,
            reasoning: scorecardJudgements.reasoning,
            snapshotScorecardName: scorecardJudgements.snapshotScorecardName,
            snapshotQualityCheckName: scorecardJudgements.snapshotQualityCheckName,
            snapshotQualityCheckDesc: scorecardJudgements.snapshotQualityCheckDesc,
          })
          .from(scorecardJudgements)
          .where(eq(scorecardJudgements.id, scorecardJudgementId));
        const judgement = judgementRows[0];

        if (!judgement) {
          logger.warn('amendment.dropped.snapshot_missing', {
            reason: 'judgement_not_found',
            scorecardJudgementId,
            runId,
          });
          return;
        }

        const runRows = await scopedDb
          .select({ summary: agentRuns.summary, subaccountId: agentRuns.subaccountId })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId));
        const runRow = runRows[0];
        const runTranscript = runRow?.summary ?? '[No summary available]';

        // recentOperatorCorrections: placeholder — full correction query comes in Chunk 4
        const recentOperatorCorrections: Array<{ at: Date; summary: string }> = [];

        const amendmentStack = deriveAmendmentStackFromSnapshot(snapshotRow);

        const contextBundle = {
          runTranscript,
          rubricSnapshot: {
            name: judgement.snapshotScorecardName,
            checkName: judgement.snapshotQualityCheckName,
            checkDesc: judgement.snapshotQualityCheckDesc ?? '',
          },
          failedCheckReasoning: judgement.reasoning ?? '',
          entityRecord: {
            entityType: 'subaccount',
            entityId: subaccountId,
            snapshot: {},
          },
          recentOperatorCorrections,
          amendmentStack,
        };

        const rcaPrompt = buildRcaPrompt(contextBundle);

        // Step 7 — RCA synthesis
        const response = await routeCall({
          messages: [{ role: 'user', content: rcaPrompt.user }],
          system: rcaPrompt.system,
          maxTokens: 1024,
          context: {
            organisationId,
            runId,
            sourceType: 'system',
            featureTag: 'closed-loop-rca-synthesis',
            taskType: 'general',
          },
        });

        const rawContent =
          typeof response.content === 'string' ? response.content.trim() : '';

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          logger.info('amendment.dropped.schema_invalid', {
            scorecardJudgementId,
            runId,
            reason: 'json_parse_failed',
          });
          return;
        }

        const validation = validateRcaProposerOutput(parsed);
        if (!validation.ok) {
          logger.info('amendment.dropped.schema_invalid', {
            scorecardJudgementId,
            runId,
            errors: validation.errors,
          });
          return;
        }

        const validatedRca = validation.value;

        if (validatedRca.proposedRemedyKind === 'no_remedy_proposed') {
          logger.info('amendment.dropped.no_remedy', {
            scorecardJudgementId,
            runId,
            skillSlug,
            failureMode: validatedRca.failureMode,
          });
          return;
        }

        // Step 8 — Sanity gate artifact: write JSON to local file
        const contextBundleHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({
            rubricSnapshot: contextBundle.rubricSnapshot,
            failedCheckReasoning: contextBundle.failedCheckReasoning,
            amendmentStack: contextBundle.amendmentStack,
          }))
          .digest('hex');
        const transcriptHash = crypto
          .createHash('sha256')
          .update(runTranscript)
          .digest('hex');
        const entityHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(contextBundle.entityRecord))
          .digest('hex');
        const systemHash = crypto
          .createHash('sha256')
          .update(rcaPrompt.system)
          .digest('hex');
        const userHash = crypto
          .createHash('sha256')
          .update(rcaPrompt.user)
          .digest('hex');

        const artifact = {
          scorecardJudgementId,
          runId,
          skillSlug,
          rcaRecordId: validatedRca.recordId,
          validatedRca,
          contextBundleHash,
          transcriptHash,
          entityHash,
          generatedAt: new Date().toISOString(),
          prompt: { systemHash, userHash },
        };

        try {
          await fs.mkdir(RCA_SAMPLES_DIR, { recursive: true });
          const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${scorecardJudgementId}.json`;
          await fs.writeFile(
            path.join(RCA_SAMPLES_DIR, filename),
            JSON.stringify(artifact, null, 2),
          );
        } catch (err) {
          logger.warn('amendment.rca_sample_write_failed', {
            scorecardJudgementId,
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
          // Non-fatal: sanity gate write failure should not block the terminal event
        }

        logger.info('amendment.rca_only_logged', {
          scorecardJudgementId,
          runId,
          skillSlug,
          rcaRecordId: validatedRca.recordId,
          proposedRemedyKind: validatedRca.proposedRemedyKind,
          confidence: validatedRca.confidence,
          contextBundleHash,
        });
      },
    );
  });
}
