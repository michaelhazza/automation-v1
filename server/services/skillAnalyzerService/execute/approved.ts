import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillVersioningHelper } from '../../skillVersioningHelper.js';
import { systemSkills } from '../../../db/schema/systemSkills.js';
import { systemAgents } from '../../../db/schema/systemAgents.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import { evaluateApprovalState } from '../../skillAnalyzerServicePure.js';
import type { MergeWarning, WarningResolution, WarningTier } from '../../skillAnalyzerServicePure.js';
import * as skillAnalyzerConfigService from '../../skillAnalyzerConfigService.js';
import { randomUUID } from 'crypto';
import { hashSkillContent, toErrorMessage } from '../hashing.js';
import { getJob } from '../jobLifecycle/get.js';
import { systemSkillService, type SystemSkill } from '../../systemSkillService.js';
import { systemAgentService } from '../../systemAgentService.js';
import { SKILL_HANDLERS } from '../../skillExecutor.js';
import { configBackupService } from '../../configBackupService.js';

/** Execute all approved results (create/update system skills + agent attach).
 *
 *  Per spec §8 (skill-analyzer-v2):
 *  - DISTINCT: handler-gate check → definition-not-null check → create
 *    system skill inside a transaction. Phase 2 extends this branch with
 *    the agent-attach loop; in Phase 1, agentProposals is always [] so the
 *    transaction wraps a single statement.
 *  - PARTIAL_OVERLAP / IMPROVEMENT: validate matchedSkillId + handler pair +
 *    proposedMergedContent then update. In Phase 1, proposedMergedContent
 *    is always null (Phase 3 lands the LLM merge proposal), so every
 *    PARTIAL_OVERLAP execute fails the null guard with the spec's error
 *    message — a known intermediate state called out in §10 Phase 1.
 *  - DUPLICATE: skip (no-op).
 */
export async function executeApproved(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}): Promise<{
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ resultId: string; error: string }>;
  backupId: string | null;
  pendingDraftAgents?: Array<{ agentId: string; slug: string; name: string }>;
}> {
  const { jobId, organisationId } = params;

  // v2 §11.11.3: atomic execution-lock acquisition. Concurrent Execute calls
  // land here and see 409 until the current run finishes.
  //
  // Ownership token: minted here and written in the same atomic UPDATE that
  // takes the lock. Release UPDATEs gate on this token so a late-finishing
  // process (e.g., after a stale-lock unlock reassigned the lock) cannot
  // clear the new owner's lock.
  const lockToken = randomUUID();
  const lockRows = await db
    .update(skillAnalyzerJobs)
    .set({
      executionLock: true,
      executionLockToken: lockToken,
      executionStartedAt: new Date(),
      executionFinishedAt: null,
    })
    .where(and(
      eq(skillAnalyzerJobs.id, jobId),
      eq(skillAnalyzerJobs.organisationId, organisationId),
      eq(skillAnalyzerJobs.executionLock, false),
    ))
    .returning({ id: skillAnalyzerJobs.id });

  if (!lockRows[0]) {
    // Either the job doesn't exist, org mismatch, or another Execute is running.
    const jobRows = await db
      .select({ id: skillAnalyzerJobs.id, executionLock: skillAnalyzerJobs.executionLock })
      .from(skillAnalyzerJobs)
      .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
      .limit(1);
    if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };
    throw {
      statusCode: 409,
      message: 'Execution already in progress. Wait for the current run to finish.',
      errorCode: 'EXECUTION_LOCKED',
    };
  }

  try {
    return await runExecute(params);
  } finally {
    // Release the lock unconditionally — but only if we still own it. The
    // token guard prevents a late-finishing process from clearing a fresh
    // owner's lock after a stale-lock unlock reassigned ownership.
    // executionStartedAt is cleared so a subsequent unlock call can tell
    // the difference between "never ran" and "ran and finished".
    await db
      .update(skillAnalyzerJobs)
      .set({
        executionLock: false,
        executionLockToken: null,
        executionStartedAt: null,
        executionFinishedAt: new Date(),
      })
      .where(and(
        eq(skillAnalyzerJobs.id, jobId),
        eq(skillAnalyzerJobs.executionLockToken, lockToken),
      ));
  }
}

async function runExecute(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}) {
  const { jobId, organisationId } = params;

  const { job, results } = await getJob(jobId, organisationId);

  const approved = results.filter(
    (r) => r.actionTaken === 'approved' && (!r.executionResult || r.executionResult === 'failed'),
  );

  // v2 §11.1 / §11.11.3: re-run evaluateApprovalState at Execute entry.
  // Belt-and-suspenders defense against approvals drifting between approve
  // and execute. Rejects with 409 + reasons[] on any unresolved blocker.
  const configSnapshot = job.configSnapshot as { warningTierMap?: Record<string, WarningTier> } | null;
  const tierMap = skillAnalyzerConfigService.effectiveTierMap(
    configSnapshot as unknown as { warningTierMap: Record<string, WarningTier> } | null,
  );
  for (const r of approved) {
    if (r.classification !== 'PARTIAL_OVERLAP' && r.classification !== 'IMPROVEMENT') continue;
    const warnings = (r.mergeWarnings ?? []) as MergeWarning[];
    const resolutions = (r.warningResolutions ?? []) as WarningResolution[];
    const state = evaluateApprovalState(warnings, resolutions, tierMap);
    if (state.blocked) {
      throw {
        statusCode: 409,
        message: `Cannot execute: result ${r.id} has unresolved blocking warnings.`,
        errorCode: 'MERGE_CRITICAL_WARNINGS',
        resultId: r.id,
        reasons: state.reasons,
      };
    }
  }

  const parsedCandidates = (job.parsedCandidates as unknown[]) || [];

  // Create a pre-mutation backup if there are approved results to execute.
  // On retry, a backup may already exist for this jobId — reuse it rather
  // than attempting a second create (which throws 409).
  let backupId: string | null = null;
  if (approved.length > 0) {
    const existing = await configBackupService.getBackupBySourceId(jobId, organisationId);
    if (existing) {
      backupId = existing.id;
    } else {
      const created = await configBackupService.createBackup({
        organisationId,
        scope: 'skill_analyzer',
        label: `Skill Analyzer Job ${jobId}`,
        sourceId: jobId,
        createdBy: params.userId,
      });
      backupId = created.backupId;
    }
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: Array<{ resultId: string; error: string }> = [];

  // Helper: mark a result as failed and bookkeep counters. Used for both
  // pre-transaction guards and try/catch fallthroughs from the per-result
  // transaction block.
  const failResult = async (resultId: string, errMsg: string): Promise<void> => {
    errors.push({ resultId, error: errMsg });
    failed++;
    await getOrgScopedDb('skillAnalyzerService.executeApprovedResults.failResult')
      .update(skillAnalyzerResults)
      .set({ executionResult: 'failed', executionError: errMsg })
      .where(eq(skillAnalyzerResults.id, resultId));
  };

  // v2 Fix 5 Phase 1: soft-create any confirmed proposed new agents.
  // Runs OUTSIDE per-result transactions so agents exist before any skill
  // attachment. Idempotent via slug lookup — re-runs reuse existing drafts.
  // Map: proposedAgentIndex → agentId for retro-injected proposals.
  const proposedAgentIdByIndex = new Map<number, string>();
  // Track which proposed agents got at least one skill attached; these get
  // promoted to 'active' at the end.
  const proposedAgentsSeeded = new Set<number>();
  try {
    const jobRows = await db
      .select({ proposedNewAgents: skillAnalyzerJobs.proposedNewAgents })
      .from(skillAnalyzerJobs)
      .where(eq(skillAnalyzerJobs.id, params.jobId))
      .limit(1);
    const proposedNewAgents = Array.isArray(jobRows[0]?.proposedNewAgents)
      ? (jobRows[0]!.proposedNewAgents as Array<Record<string, unknown>>)
      : [];
    for (const entry of proposedNewAgents) {
      if (entry?.status !== 'confirmed') continue;
      const slug = typeof entry.slug === 'string' ? entry.slug : null;
      const name = typeof entry.name === 'string' ? entry.name : null;
      const idx = typeof entry.proposedAgentIndex === 'number' ? entry.proposedAgentIndex : null;
      if (!slug || !name || idx === null) continue;

      // Idempotency: reuse existing agent if slug already exists (e.g., a
      // prior Execute attempt partially succeeded). Direct slug query
      // instead of listing every agent.
      let agentId: string;
      try {
        const existingRows = await db
          .select({ id: systemAgents.id })
          .from(systemAgents)
          .where(and(eq(systemAgents.slug, slug), isNull(systemAgents.deletedAt)))
          .limit(1);
        if (existingRows[0]) {
          agentId = existingRows[0].id;
        } else {
          const created = await systemAgentService.createAgent({
            name,
            description: typeof entry.description === 'string' ? entry.description : '',
            masterPrompt: typeof entry.reasoning === 'string' ? entry.reasoning : name,
          });
          // New agents default to status='draft' via the schema default;
          // promoted to 'active' in Phase 3 after attachment succeeds.
          agentId = created.id;
        }
      } catch (err) {
        logger.warn('[skillAnalyzer] proposed agent soft-create failed; skipping', {
          jobId: params.jobId,
          proposedAgentIndex: idx,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      proposedAgentIdByIndex.set(idx, agentId);
    }
  } catch (err) {
    logger.warn('[skillAnalyzer] proposed agents phase skipped', {
      jobId: params.jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const result of approved) {
    const candidate = parsedCandidates[result.candidateIndex] as {
      name: string;
      slug: string;
      description: string;
      definition: object | null;
      instructions: string | null;
    } | undefined;

    if (!candidate) {
      await failResult(result.id, 'Candidate data not found in job');
      continue;
    }

    // -----------------------------------------------------------------------
    // DUPLICATE: skip
    // -----------------------------------------------------------------------
    if (result.classification === 'DUPLICATE') {
      await getOrgScopedDb('skillAnalyzerService.executeApprovedResults.skipDuplicate')
        .update(skillAnalyzerResults)
        .set({ executionResult: 'skipped' })
        .where(eq(skillAnalyzerResults.id, result.id));
      continue;
    }

    // -----------------------------------------------------------------------
    // PARTIAL_OVERLAP / IMPROVEMENT: update existing system skill via merge
    // -----------------------------------------------------------------------
    if (result.classification === 'PARTIAL_OVERLAP' || result.classification === 'IMPROVEMENT') {
      // Guard 1: matchedSkillId must be set.
      if (!result.matchedSkillId) {
        await failResult(result.id, 'matchedSkillId is required for partial-overlap write');
        continue;
      }
      // Guard 2: matched library skill's slug must resolve to a registered
      // handler. The startup validator guarantees this for active rows, but
      // listSkills() includes inactive rows too — a matched inactive row may
      // reference an unregistered handler. Re-read the row inside the txn
      // and check before writing. See spec §8 PARTIAL_OVERLAP branch.
      let matchedRow: SystemSkill | null;
      try {
        matchedRow = await systemSkillService.getSkill(result.matchedSkillId);
      } catch {
        matchedRow = null;
      }
      if (!matchedRow) {
        await failResult(result.id, 'library skill no longer exists — re-run analysis');
        continue;
      }
      if (!(matchedRow.slug in SKILL_HANDLERS)) {
        await failResult(
          result.id,
          `matched library skill has no registered handler — this is an inactive row; reactivation requires an engineer to add a handler to SKILL_HANDLERS in server/services/skillExecutor.ts`,
        );
        continue;
      }
      // Guard 3: proposedMergedContent must be present (Phase 3 populates it).
      const merge = result.proposedMergedContent as
        | { name: string; description: string; definition: object; instructions: string | null }
        | null;
      if (!merge) {
        await failResult(result.id, 'merge proposal unavailable — re-run analysis');
        continue;
      }
      // v2 Fix 7: execution_resolved_name overrides any drift in merge.name
      // that may have occurred between NAME_MISMATCH resolution and Execute.
      // Cascade to definition.name so the schema and file name stay in sync.
      const canonicalName = result.executionResolvedName && result.executionResolvedName.trim().length > 0
        ? result.executionResolvedName.trim()
        : merge.name;
      const canonicalDefinition = canonicalName !== merge.name
        ? { ...(merge.definition as Record<string, unknown>), name: canonicalName }
        : merge.definition;
      // Apply the merge inside a transaction. In Phase 1 this is a single-
      // statement transaction; the wrapping is in place for Phase 2's
      // multi-statement extensions.
      try {
        await db.transaction(async (tx) => {
          const updated_skill = await systemSkillService.updateSystemSkill(
            result.matchedSkillId!,
            {
              name: canonicalName,
              description: merge.description,
              definition: canonicalDefinition as never,
              instructions: merge.instructions,
            },
            { tx, skipVersionWrite: true, externalVersionWrite: true },
          );

          // Version snapshot uses the DB-returned row, not `merge.*`, to guarantee
          // the snapshot matches what was actually persisted.
          await skillVersioningHelper.writeVersion({
            systemSkillId: result.matchedSkillId!,
            name: updated_skill.name,
            description: updated_skill.description,
            definition: updated_skill.definition as object,
            instructions: updated_skill.instructions,
            changeType: 'merge',
            changeSummary: `${result.classification} merge from Skill Analyzer job ${jobId}`,
            authoredBy: params.userId,
            idempotencyKey: `sa:${jobId}:${result.matchedSkillId}:merge`,
            tx,
          });
        });
        await getOrgScopedDb('skillAnalyzerService.executeApprovedResults.markUpdated')
          .update(skillAnalyzerResults)
          .set({ executionResult: 'updated', resultingSkillId: result.matchedSkillId })
          .where(eq(skillAnalyzerResults.id, result.id));
        updated++;
      } catch (err) {
        const errMsg = toErrorMessage(err);
        await failResult(result.id, errMsg);
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // DISTINCT: create a new system skill (+ agent attach in Phase 2)
    // -----------------------------------------------------------------------
    if (result.classification === 'DISTINCT') {
      // Guard 1: generic_methodology requires instructions to function.
      // An imported skill with no instructions would give the agent nothing
      // to work with — fail early rather than silently at execution time.
      if (!candidate.instructions || candidate.instructions.trim().length === 0) {
        await failResult(
          result.id,
          `Skill '${candidate.slug}' has no instructions. The generic_methodology handler requires instructions to function.`,
        );
        continue;
      }
      // Guard 2: candidate definition must be a non-null object — the
      // system_skills.definition column is NOT NULL.
      if (!candidate.definition) {
        await failResult(
          result.id,
          'definition is required — candidate had no tool-definition block',
        );
        continue;
      }
      // Guard 3: slug uniqueness — block before opening the transaction so
      // we surface a clean error rather than a Postgres unique-violation.
      // NOTE: getSkillBySlug filters out inactive rows; we need to check
      // EVERY row regardless of isActive because slug is UNIQUE at the
      // schema level. A retired (isActive=false) row with the same slug
      // would slip past getSkillBySlug and explode at the constraint inside
      // the transaction. Use a direct DB query that ignores isActive.
      //
      // v2 §11.11.7: when a row already exists, hash-compare content against
      // the candidate. Identical content → idempotent adopt (runs the
      // version-write + agent-attach effects against the existing row, so
      // an external-actor Case B scenario still wires up intent). Diverged
      // content → hard fail as before.
      let adoptedExistingSkill: {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        definition: object | null;
        instructions: string | null;
      } | null = null;
      const existingRows = await db
        .select({
          id: systemSkills.id,
          isActive: systemSkills.isActive,
          name: systemSkills.name,
          description: systemSkills.description,
          definition: systemSkills.definition,
          instructions: systemSkills.instructions,
        })
        .from(systemSkills)
        .where(eq(systemSkills.slug, candidate.slug))
        .limit(1);
      if (existingRows[0]) {
        const existing = existingRows[0];
        const candidateHash = hashSkillContent({
          name: candidate.name,
          description: candidate.description,
          definition: candidate.definition,
          instructions: candidate.instructions,
        });
        const existingHash = hashSkillContent({
          name: existing.name,
          description: existing.description,
          definition: existing.definition as object | null,
          instructions: existing.instructions,
        });
        if (candidateHash === existingHash && existing.isActive) {
          // Two distinct sub-cases produce a content-match collision:
          //   A. A prior Execute for this same job created the skill and then
          //      crashed before marking the result row success. Every
          //      downstream effect (version write, agent attach) completed in
          //      that prior transaction.
          //   B. An external actor (admin UI, seed script, another job)
          //      created a skill whose content happens to match ours. None of
          //      our downstream effects have run yet.
          //
          // We can't tell A from B from the skill row alone, but we don't
          // need to: version-write is idempotent via `idempotencyKey` and
          // the agent-attach loop already guards with
          // `currentSlugs.includes(created.slug)`. Running the effects
          // unconditionally fixes Case B silently losing attachments while
          // staying a no-op in Case A.
          logger.info('[skillAnalyzer] execute slug-collision idempotent adopt', {
            resultId: result.id,
            slug: candidate.slug,
            systemSkillId: existing.id,
          });
          adoptedExistingSkill = {
            id: existing.id,
            slug: candidate.slug,
            name: existing.name,
            description: existing.description,
            definition: existing.definition as object | null,
            instructions: existing.instructions,
          };
        } else {
          const msg = existing.isActive
            ? `slug '${candidate.slug}' already exists in system_skills with different content — pick a different slug or update the existing row instead`
            : `slug '${candidate.slug}' already exists in system_skills as a retired (inactive) row — reactivate it or pick a different slug`;
          await failResult(result.id, msg);
          continue;
        }
      }
      // Open the per-result transaction. Inside: create the skill, then
      // for every selected agent proposal look up the live agent row and
      // append the new skill's slug to its defaultSystemSkillSlugs array.
      // If any agent update throws, the entire transaction rolls back so
      // the row is left clean (the skill is not created either) — see
      // spec §8.1 transaction-threading contract. Per-proposal outcomes
      // are emitted to the structured logger; the row-level executionResult
      // reflects only overall transaction success.
      try {
        const newSkill = await db.transaction(async (tx) => {
          // Branch: on an idempotent adopt we skip createSystemSkill (slug
          // already exists with matching content) but still run version
          // write + agent attach against the existing row. writeVersion's
          // idempotencyKey makes this safe on retry; the attach loop guards
          // with `currentSlugs.includes(...)` for the same reason.
          const created = adoptedExistingSkill ?? await systemSkillService.createSystemSkill(
            {
              slug: candidate.slug,
              handlerKey: 'generic_methodology',
              name: candidate.name,
              description: candidate.description,
              definition: candidate.definition as never,
              instructions: candidate.instructions,
            },
            { tx, skipVersionWrite: true, externalVersionWrite: true },
          );

          await skillVersioningHelper.writeVersion({
            systemSkillId: created.id,
            name: created.name,
            description: created.description,
            definition: created.definition as object,
            instructions: created.instructions,
            changeType: 'create',
            changeSummary: adoptedExistingSkill
              ? `Adopted pre-existing skill by Skill Analyzer job ${jobId}`
              : `Created by Skill Analyzer job ${jobId}`,
            authoredBy: params.userId,
            idempotencyKey: `sa:${jobId}:${created.id}:create`,
            tx,
          });

          // Phase 2: read agentProposals off the result row, filter to
          // the selected ones, and attach the new skill's slug to each
          // chosen agent's defaultSystemSkillSlugs array. Missing agents
          // are logged and skipped (not a hard failure — see spec §9
          // edge case "system agent is deleted between analysis and
          // execute").
          const proposals = (result.agentProposals as Array<{
            systemAgentId: string | null;
            slugSnapshot: string;
            nameSnapshot: string;
            score: number;
            selected: boolean;
            isProposedNewAgent?: boolean;
            proposedAgentIndex?: number;
          }> | null) ?? [];

          for (const proposal of proposals) {
            if (!proposal.selected) continue;

            // v2 Fix 5: resolve proposed-new-agent entries to the freshly
            // soft-created agent ID. If the reviewer didn't confirm the
            // proposal, skip (Phase 1 didn't create an agent for it).
            let resolvedAgentId = proposal.systemAgentId;
            if (proposal.isProposedNewAgent) {
              const idx = proposal.proposedAgentIndex ?? 0;
              const newAgentId = proposedAgentIdByIndex.get(idx);
              if (!newAgentId) {
                logger.warn('[skillAnalyzer] proposed-new-agent not created; skipping attach', {
                  resultId: result.id,
                  proposedAgentIndex: idx,
                });
                continue;
              }
              resolvedAgentId = newAgentId;
              proposedAgentsSeeded.add(idx);
            }
            if (!resolvedAgentId) continue;

            let agent;
            try {
              agent = await systemAgentService.getAgent(resolvedAgentId, { tx });
            } catch {
              // 404 — agent was deleted between analysis and execute.
              logger.warn('[skillAnalyzer] agent attach skipped — missing', {
                resultId: result.id,
                systemAgentId: resolvedAgentId,
                outcome: 'skipped-missing',
              });
              continue;
            }

            const currentSlugs: string[] = Array.isArray(agent.defaultSystemSkillSlugs)
              ? (agent.defaultSystemSkillSlugs as string[])
              : [];
            if (currentSlugs.includes(created.slug)) {
              // Already attached — idempotent no-op.
              logger.info('[skillAnalyzer] agent attach already-present', {
                resultId: result.id,
                systemAgentId: resolvedAgentId,
                outcome: 'already-present',
              });
              continue;
            }
            const nextSlugs = [...currentSlugs, created.slug];
            await systemAgentService.updateAgent(
              resolvedAgentId,
              { defaultSystemSkillSlugs: nextSlugs },
              { tx },
            );
            logger.info('[skillAnalyzer] agent attach succeeded', {
              resultId: result.id,
              systemAgentId: resolvedAgentId,
              outcome: 'attached',
            });
          }

          return created;
        });
        await getOrgScopedDb('skillAnalyzerService.executeApprovedResults.markCreated')
          .update(skillAnalyzerResults)
          .set({ executionResult: 'created', resultingSkillId: newSkill.id })
          .where(eq(skillAnalyzerResults.id, result.id));
        created++;
      } catch (err) {
        const errMsg = toErrorMessage(err);
        await failResult(result.id, errMsg);
      }
      continue;
    }
  }

  // Clean up phantom backup if no mutations actually succeeded
  if (backupId && created === 0 && updated === 0) {
    try {
      await configBackupService.deleteBackup(backupId);
      backupId = null;
    } catch (err) {
      logger.warn('[skillAnalyzer] Failed to clean up phantom backup', {
        backupId,
        error: String(err),
      });
      // Non-fatal — execution results are the primary return value
    }
  }

  // v2 Fix 5 Phase 3: promote proposed agents whose skills succeeded from
  // 'draft' to 'active'. Drafts whose skills all failed stay as drafts and
  // appear in pendingDraftAgents[] for admin review.
  const pendingDraftAgents: Array<{ agentId: string; slug: string; name: string }> = [];
  for (const [idx, agentId] of proposedAgentIdByIndex) {
    try {
      const agent = await systemAgentService.getAgent(agentId);
      if (proposedAgentsSeeded.has(idx) && agent.status === 'draft') {
        await systemAgentService.updateAgent(agentId, { status: 'active' });
        logger.info('[skillAnalyzer] proposed agent promoted to active', {
          jobId: params.jobId,
          agentId,
          proposedAgentIndex: idx,
        });
      } else if (agent.status === 'draft') {
        // No skills attached — leave as draft for admin review.
        pendingDraftAgents.push({ agentId, slug: agent.slug, name: agent.name });
      }
    } catch (err) {
      logger.warn('[skillAnalyzer] proposed agent promotion check failed', {
        jobId: params.jobId,
        agentId,
        proposedAgentIndex: idx,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated, failed, errors, backupId, pendingDraftAgents };
}
