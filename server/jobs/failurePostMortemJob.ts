// ---------------------------------------------------------------------------
// failurePostMortemJob — full §9.1 handler for closed-loop skill improvement.
// Closed-Loop Skill Improvement spec §9.1 steps 1–14 (Chunk 3 + Chunk 4).
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
  peerReviewerDrops,
  skillRegressionCases,
  amendmentProposerMetrics,
} from '../db/schema/index.js';
import { routeCall } from '../services/llmRouter.js';
import { buildRcaPrompt, validateRcaProposerOutput } from '../services/rcaPromptBuilder.js';
import {
  checkAmendmentCaps,
  deriveAmendmentStackFromSnapshot,
} from './failurePostMortemJobPure.js';
import {
  computeAmendmentDedupKey,
  classifyDedup,
  type DedupCohort,
} from './amendmentDedupPure.js';
import { callPeerReview } from '../services/peerReviewCaller.js';

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

const IMPERATIVE_MODAL_PATTERN = /\b(must|should|never|always|do not|don['']t|do)\b/i;
const EVALUATOR_TARGETS = ['scorecard_judge_prompt', 'rca_proposer_prompt', 'peer_review_prompt'];

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

        // RCA synthesis (was §9.1 step 7 in Chunk 3; now step 6 numbering per plan)
        const rcaResponse = await routeCall({
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

        const rawRcaContent =
          typeof rcaResponse.content === 'string' ? rcaResponse.content.trim() : '';

        let parsedRca: unknown;
        try {
          parsedRca = JSON.parse(rawRcaContent);
        } catch {
          logger.info('amendment.dropped.schema_invalid', {
            scorecardJudgementId,
            runId,
            reason: 'json_parse_failed',
          });
          return;
        }

        const validation = validateRcaProposerOutput(parsedRca);
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

        // Write sanity-gate artifact (local JSON file, gitignored)
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
        }

        // ── Chunk 4 steps begin here ──────────────────────────────────────────

        // Step 7 — Anti-recursion check
        if (
          validatedRca.proposedRemedyBody &&
          EVALUATOR_TARGETS.some((t) => validatedRca.proposedRemedyBody!.includes(t))
        ) {
          logger.info('amendment.dropped.schema_invalid', {
            subKind: 'evaluator_surface',
            scorecardJudgementId,
            runId,
          });
          return;
        }

        // Step 8 — context_fact declarative-only check
        if (
          validatedRca.proposedRemedyKind === 'context_fact' &&
          IMPERATIVE_MODAL_PATTERN.test(validatedRca.proposedRemedyBody!)
        ) {
          logger.info('amendment.dropped.schema_invalid', {
            subKind: 'context_fact_imperative',
            scorecardJudgementId,
            runId,
          });
          return;
        }

        // Step 9 — Deduplication
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dedupRows = await scopedDb
          .select({
            id: skillAmendments.id,
            status: skillAmendments.status,
            rejectedAt: skillAmendments.rejectedAt,
            body: skillAmendments.body,
            kind: skillAmendments.kind,
          })
          .from(skillAmendments)
          .where(
            and(
              eq(skillAmendments.orgId, organisationId),
              or(
                eq(skillAmendments.systemSkillId, resolvedSkillId),
                eq(skillAmendments.orgSkillId, resolvedSkillId),
              ),
            ),
          );

        const candidateKey = computeAmendmentDedupKey(
          resolvedSkillId,
          validatedRca.proposedRemedyKind,
          validatedRca.proposedRemedyBody!,
        );

        const cohort: DedupCohort = {
          activeAccepted: dedupRows
            .filter((r) => r.status === 'accepted')
            .map((r) => ({
              id: r.id,
              dedupKey: computeAmendmentDedupKey(resolvedSkillId, r.kind, r.body),
            })),
          pendingReview: dedupRows
            .filter((r) => r.status === 'pending_review')
            .map((r) => ({
              id: r.id,
              dedupKey: computeAmendmentDedupKey(resolvedSkillId, r.kind, r.body),
            })),
          recentlyRejectedWithin14Days: dedupRows
            .filter(
              (r) =>
                r.status === 'rejected' &&
                r.rejectedAt !== null &&
                r.rejectedAt !== undefined &&
                r.rejectedAt >= fourteenDaysAgo,
            )
            .map((r) => ({
              id: r.id,
              dedupKey: computeAmendmentDedupKey(resolvedSkillId, r.kind, r.body),
              rejectedAt: r.rejectedAt!,
            })),
          failingRunsInLast7Days: 0,
        };

        const dedupDecision = classifyDedup({ candidateKey, cohort, now: new Date() });

        if (dedupDecision.decision === 'suppress_increment_active') {
          await scopedDb
            .update(skillAmendments)
            .set({ suppressedDuplicateCount: sql`${skillAmendments.suppressedDuplicateCount} + 1` })
            .where(eq(skillAmendments.id, dedupDecision.targetId));
          logger.info('amendment.suppressed', {
            subKind: 'active_duplicate',
            scorecardJudgementId,
            runId,
            targetId: dedupDecision.targetId,
          });
          return;
        }

        if (dedupDecision.decision === 'suppress_increment_pending') {
          await scopedDb
            .update(skillAmendments)
            .set({ occurrenceCount: sql`${skillAmendments.occurrenceCount} + 1` })
            .where(eq(skillAmendments.id, dedupDecision.targetId));
          logger.info('amendment.suppressed', {
            subKind: 'pending_duplicate',
            scorecardJudgementId,
            runId,
            targetId: dedupDecision.targetId,
          });
          return;
        }

        if (dedupDecision.decision === 'suppress_recently_rejected') {
          logger.info('amendment.suppressed', {
            subKind: 'recently_rejected',
            scorecardJudgementId,
            runId,
            targetId: dedupDecision.targetId,
          });
          return;
        }

        // decision is 'insert' or 'insert_override_freshness' — proceed to peer review

        // Step 10 — Peer review
        const prResult = await callPeerReview({
          scorecardJudgementId,
          organisationId,
          subaccountId,
          runId,
          proposedKind: validatedRca.proposedRemedyKind,
          proposedBody: validatedRca.proposedRemedyBody!,
          failureMode: validatedRca.failureMode,
          contributingFactors: validatedRca.contributingFactors,
        });

        if (prResult.status === 'router_exhausted') {
          logger.info('amendment.dropped.peer_review_unavailable', {
            reason: prResult.reason,
            scorecardJudgementId,
            runId,
          });
          // UPSERT proposer metrics — peer_review_drop_count
          await db
            .insert(amendmentProposerMetrics)
            .values({
              proposerModelVersion: 'unknown',
              periodStart: new Date().toISOString().slice(0, 10),
              proposalCount: 0,
              peerReviewDropCount: 1,
            })
            .onConflictDoUpdate({
              target: [
                amendmentProposerMetrics.proposerModelVersion,
                amendmentProposerMetrics.periodStart,
              ],
              set: {
                peerReviewDropCount: sql`${amendmentProposerMetrics.peerReviewDropCount} + 1`,
              },
            });
          return;
        }

        if (prResult.status === 'does_not_address') {
          await scopedDb
            .insert(peerReviewerDrops)
            .values({
              orgId: organisationId,
              scorecardJudgementId,
              dropReason: prResult.reasoning,
              peerReviewerModelVersion: prResult.peerReviewerModelVersion,
            })
            .onConflictDoNothing();

          await scopedDb
            .insert(skillRegressionCases)
            .values({
              orgId: organisationId,
              scorecardJudgementId,
              tag: 'unresolved',
            })
            .onConflictDoNothing();

          logger.info('amendment.dropped.peer_review', {
            scorecardJudgementId,
            runId,
          });

          // UPSERT proposer metrics — peer_review_drop_count
          await db
            .insert(amendmentProposerMetrics)
            .values({
              proposerModelVersion: prResult.peerReviewerModelVersion,
              periodStart: new Date().toISOString().slice(0, 10),
              proposalCount: 0,
              peerReviewDropCount: 1,
            })
            .onConflictDoUpdate({
              target: [
                amendmentProposerMetrics.proposerModelVersion,
                amendmentProposerMetrics.periodStart,
              ],
              set: {
                peerReviewDropCount: sql`${amendmentProposerMetrics.peerReviewDropCount} + 1`,
              },
            });
          return;
        }

        // prResult.status === 'addresses_root_cause' — proceed to write

        // Step 11 — Write amendment row (compound write inside open tx)
        let insertedId: string;
        try {
          const [inserted] = await scopedDb
            .insert(skillAmendments)
            .values({
              orgId: organisationId,
              subaccountId,
              ...(snapshotRow.systemSkillId
                ? { systemSkillId: snapshotRow.systemSkillId }
                : { orgSkillId: snapshotRow.orgSkillId! }),
              kind: validatedRca.proposedRemedyKind,
              body: validatedRca.proposedRemedyBody!,
              status: 'draft',
              source: 'agent_proposed_from_failure',
              blastRadiusEstimate: validatedRca.proposedRemedyKind === 'guardrail' ? 'medium' : 'low',
              confidence: validatedRca.confidence,
              versionNumber: 1,
              scorecardJudgementId,
              rcaRecordId: validatedRca.recordId,
              rcaJson: validatedRca as unknown as Record<string, unknown>,
              proposerRunId: runId,
              peerReviewerModelVersion: prResult.peerReviewerModelVersion,
              peerReviewerVerdict: true,
              peerReviewerReasoning: prResult.reasoning,
            })
            .returning({ id: skillAmendments.id });

          insertedId = inserted.id;

          // Set lineage_root_id = id (self-reference)
          await scopedDb
            .update(skillAmendments)
            .set({ lineageRootId: insertedId })
            .where(eq(skillAmendments.id, insertedId));

          // UPDATE status to pending_review (preserves draft→pending_review audit transition)
          await scopedDb
            .update(skillAmendments)
            .set({ status: 'pending_review' })
            .where(
              and(
                eq(skillAmendments.id, insertedId),
                eq(skillAmendments.status, 'draft'),
              ),
            );
        } catch (err) {
          // UNIQUE (scorecard_judgement_id) WHERE status != 'retired' violation
          const pgErr = err as { code?: string; constraint?: string };
          if (pgErr.code === '23505') {
            logger.info('amendment.dedupe_on_judgement_id', {
              scorecardJudgementId,
              runId,
            });
            return;
          }
          throw err;
        }

        // Step 12 — Write regression case
        await scopedDb
          .insert(skillRegressionCases)
          .values({
            orgId: organisationId,
            amendmentId: insertedId,
            scorecardJudgementId,
            tag: 'unresolved',
          })
          .onConflictDoNothing();

        // Step 13 — Terminal event
        logger.info('amendment.proposed', {
          amendmentId: insertedId,
          scorecardJudgementId,
          kind: validatedRca.proposedRemedyKind,
          runId,
        });

        // Step 14 — Proposer metrics UPSERT
        await db
          .insert(amendmentProposerMetrics)
          .values({
            proposerModelVersion: prResult.peerReviewerModelVersion,
            periodStart: new Date().toISOString().slice(0, 10),
            proposalCount: 1,
            peerReviewDropCount: 0,
          })
          .onConflictDoUpdate({
            target: [
              amendmentProposerMetrics.proposerModelVersion,
              amendmentProposerMetrics.periodStart,
            ],
            set: {
              proposalCount: sql`${amendmentProposerMetrics.proposalCount} + 1`,
            },
          });
      },
    );
  });
}
