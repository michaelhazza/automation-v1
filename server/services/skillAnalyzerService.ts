import { eq, and, sql, isNull } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { skillVersioningHelper } from './skillVersioningHelper.js';
import { systemSkills } from '../db/schema/systemSkills.js';
import { systemAgents } from '../db/schema/systemAgents.js';
import { routeCall } from './llmRouter.js';
import { ParseFailureError } from '../lib/parseFailureError.js';
import { truncateUtf8Safe } from '../lib/utf8Truncate.js';
import { skillAnalyzerServicePure } from './skillAnalyzerServicePure.js';
import type { ParsedSkill } from './skillParserServicePure.js';
import type { LibrarySkillSummary, AgentRecommendation, MergeWarning, WarningResolution, WarningTier, ProposedMerge, SkillAnalyzerJobStatus } from './skillAnalyzerServicePure.js';
import { evaluateApprovalState, buildClassifierFailureOutcome, CLASSIFIER_FALLBACK_WARNING } from './skillAnalyzerServicePure.js';
import type { ClassifyState } from '../db/schema/skillAnalyzerJobs.js';
import * as skillAnalyzerConfigService from './skillAnalyzerConfigService.js';
import { randomUUID } from 'crypto';
import { hashSkillContent, toErrorMessage } from './skillAnalyzerService/hashing.js';
import { slugifyName } from './skillAnalyzerService/helpers/slugify.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../db/schema/index.js';
import { createJob } from './skillAnalyzerService/jobLifecycle/create.js';
import { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS } from './skillAnalyzerService/jobLifecycle/resume.js';
import { getJob, getJobById, listJobs } from './skillAnalyzerService/jobLifecycle/get.js';
import { setResultAction, bulkSetResultAction } from './skillAnalyzerService/results/setAction.js';
import { updateProposedAgent, updateAgentProposal, updateResultAgentProposals } from './skillAnalyzerService/results/updateProposal.js';
import { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic } from './skillAnalyzerService/results/warnings.js';
import { patchMergeFields, resetMergeToOriginal } from './skillAnalyzerService/results/merge.js';
// Phase 1 of skill-analyzer-v2: the analyzer is system-only. The
// org-skill skillService import was removed; executeApproved now writes
// to system_skills via systemSkillService. DISTINCT results use the
// generic_methodology handler; SKILL_HANDLERS is checked for IMPROVEMENT
// / PARTIAL_OVERLAP paths only (existing skills must remain paired).
import { systemSkillService, type SystemSkill } from './systemSkillService.js';
import { systemAgentService } from './systemAgentService.js';
import { SKILL_HANDLERS } from './skillExecutor.js';
import { configBackupService } from './configBackupService.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — CRUD for jobs/results + pipeline orchestration
// ---------------------------------------------------------------------------

// Status union is defined once in skillAnalyzerServicePure.ts alongside the
// mid-flight and terminal subsets. Re-export here so existing callers keep
// their import path.
export {
  SKILL_ANALYZER_JOB_STATUSES,
  SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  SKILL_ANALYZER_TERMINAL_STATUSES,
  isSkillAnalyzerTerminalStatus,
  isSkillAnalyzerMidFlightStatus,
  type SkillAnalyzerJobStatus,
  type SkillAnalyzerMidFlightStatus,
  type SkillAnalyzerTerminalStatus,
} from './skillAnalyzerServicePure.js';

export { createJob };
export { resumeJob, RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS };
export { getJob, getJobById, listJobs };

export type { MatchedSkillContent, AvailableSystemAgent, EnrichedResult, GetJobResponse, ResolveWarningParams, UpdateAgentProposalParams, PatchMergeFieldsParams } from './skillAnalyzerService/types.js';

export { setResultAction, bulkSetResultAction };
export { updateProposedAgent, updateAgentProposal, updateResultAgentProposals };
export { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic };
export { patchMergeFields, resetMergeToOriginal };

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

/** v2 §11.11.3: systemAdmin recovery for a stuck execution_lock. Only clears
 *  the lock when it has been held longer than
 *  `config.executionLockStaleSeconds` — prevents an operator from accidentally
 *  yanking the rug out from under a live Execute. Router already enforces
 *  `requireSystemAdmin`. */
export async function unlockStaleExecution(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}): Promise<{ unlocked: true; heldForSeconds: number }> {
  const { jobId, organisationId, userId } = params;
  const jobRows = await db
    .select({
      id: skillAnalyzerJobs.id,
      executionLock: skillAnalyzerJobs.executionLock,
      executionStartedAt: skillAnalyzerJobs.executionStartedAt,
    })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  const job = jobRows[0];
  if (!job) throw { statusCode: 404, message: 'Job not found' };
  if (!job.executionLock) {
    throw {
      statusCode: 409,
      message: 'Execution lock is not held — nothing to unlock.',
      errorCode: 'EXECUTION_LOCK_NOT_HELD',
    };
  }
  // A lock with no executionStartedAt is an inconsistent state — never
  // assume infinite age and silently nuke it. Bail with a dedicated code so
  // the operator can investigate (likely needs a direct DB fix).
  if (!job.executionStartedAt) {
    throw {
      statusCode: 409,
      message: 'Execution lock has no start timestamp — refusing to unlock without one. Inspect the job row directly.',
      errorCode: 'EXECUTION_LOCK_NO_START',
    };
  }

  const config = await skillAnalyzerConfigService.getConfig();
  const staleThresholdMs = config.executionLockStaleSeconds * 1000;
  const heldForMs = Date.now() - new Date(job.executionStartedAt).getTime();
  if (heldForMs < staleThresholdMs) {
    throw {
      statusCode: 409,
      message: `Execution lock is not yet stale (held for ${Math.floor(heldForMs / 1000)}s, threshold ${config.executionLockStaleSeconds}s).`,
      errorCode: 'EXECUTION_LOCK_FRESH',
    };
  }

  // Clear the lock, token, and start timestamp. The affected-row check
  // closes the narrow window where the live Execute's `finally` ran between
  // our staleness check and this UPDATE — returning 0 rows means the lock
  // was already released, which we surface distinctly rather than falsely
  // claiming to have unlocked it.
  const cleared = await db
    .update(skillAnalyzerJobs)
    .set({
      executionLock: false,
      executionLockToken: null,
      executionStartedAt: null,
      executionFinishedAt: new Date(),
    })
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.executionLock, true)))
    .returning({ id: skillAnalyzerJobs.id });

  if (!cleared[0]) {
    throw {
      statusCode: 409,
      message: 'Lock was released concurrently by the running Execute. No action needed.',
      errorCode: 'EXECUTION_LOCK_RELEASED_CONCURRENTLY',
    };
  }

  logger.warn('[skillAnalyzer] stale execution lock cleared', {
    jobId,
    userId,
    heldForSeconds: Math.floor(heldForMs / 1000),
    staleThresholdSeconds: config.executionLockStaleSeconds,
  });

  return { unlocked: true, heldForSeconds: Math.floor(heldForMs / 1000) };
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
    await db
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
      await db
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
        await db
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
        await db
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

/** Update job progress (used by the job handler). */
export async function updateJobProgress(
  jobId: string,
  update: {
    status?: SkillAnalyzerJobStatus;
    progressPct?: number;
    progressMessage?: string;
    errorMessage?: string;
    candidateCount?: number;
    exactDuplicateCount?: number;
    comparisonCount?: number;
    parsedCandidates?: unknown;
    completedAt?: Date;
    classifyState?: ClassifyState;
  }
): Promise<void> {
  type JobUpdate = typeof skillAnalyzerJobs.$inferInsert;
  const values: Partial<JobUpdate> = { updatedAt: new Date() };
  if (update.status !== undefined) values.status = update.status;
  if (update.progressPct !== undefined) values.progressPct = update.progressPct;
  if (update.progressMessage !== undefined) values.progressMessage = update.progressMessage;
  if (update.errorMessage !== undefined) values.errorMessage = update.errorMessage;
  if (update.candidateCount !== undefined) values.candidateCount = update.candidateCount;
  if (update.exactDuplicateCount !== undefined) values.exactDuplicateCount = update.exactDuplicateCount;
  if (update.comparisonCount !== undefined) values.comparisonCount = update.comparisonCount;
  if (update.parsedCandidates !== undefined) values.parsedCandidates = update.parsedCandidates as JobUpdate['parsedCandidates'];
  if (update.completedAt !== undefined) values.completedAt = update.completedAt;
  if (update.classifyState !== undefined) values.classifyState = update.classifyState;

  await db
    .update(skillAnalyzerJobs)
    .set(values)
    .where(eq(skillAnalyzerJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Internal functions for job handler use (no org-scoping — admin bypass path)
// ---------------------------------------------------------------------------

/** Batch insert results for a job. Splits into 100-row batches. */
export async function insertResults(
  rows: (typeof skillAnalyzerResults.$inferInsert)[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
  }
}

/** Insert a single result row for a job. */
export async function insertSingleResult(
  row: typeof skillAnalyzerResults.$inferInsert,
): Promise<void> {
  await db.insert(skillAnalyzerResults).values(row);
}

/** List already-written result rows for a job as a minimal projection.
 *  Returned for crash-resume in Stage 5: the job handler re-invokes after a
 *  worker crash, and any candidate_index already present in this list has had
 *  its LLM classification paid for and persisted — we must not re-call the
 *  provider for it. Only the fields downstream stages actually read are
 *  selected (candidateIndex + classification drive Stage 7 agent-propose and
 *  Stage 8 agent-proposal backfill).
 *
 *  Deduplicated by candidateIndex at the query boundary because
 *  skill_analyzer_results has no UNIQUE(job_id, candidate_index) constraint.
 *  Pre-PR (when Stage 1 called clearResultsForJob on every retry) a single
 *  jobId could end up with two rows for the same index; callers that iterate
 *  this list must see each index exactly once so downstream reconstruction
 *  produces a single deterministic classifiedResults entry per candidate.
 *
 *  Ordering matters for determinism. We sort by candidate_index ASC, then
 *  created_at DESC, then id DESC as a final tiebreaker — the first row
 *  encountered for each candidate_index wins, so "latest write wins" semantics
 *  apply. Without ORDER BY, Postgres returns rows in storage order, which is
 *  not stable across vacuum / hot-update boundaries and can flip the chosen
 *  row between runs. */
export async function listResultIndicesForJob(
  jobId: string,
): Promise<Array<{
  candidateIndex: number;
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  matchedSkillId: string | null;
  proposedMergedName: string | null;
  proposedMergedInstructions: string | null;
}>> {
  // Raw SQL used to extract JSONB sub-fields without pulling the full JSONB blob.
  const rawRows = await db.execute(sql`
    SELECT
      candidate_index        AS "candidateIndex",
      classification,
      matched_skill_id       AS "matchedSkillId",
      proposed_merged_content->>'name'         AS "proposedMergedName",
      proposed_merged_content->>'instructions' AS "proposedMergedInstructions"
    FROM skill_analyzer_results
    WHERE job_id = ${jobId}
    ORDER BY candidate_index ASC, created_at DESC, id DESC
  `);

  type RawRow = {
    candidateIndex: number;
    classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
    matchedSkillId: string | null;
    proposedMergedName: string | null;
    proposedMergedInstructions: string | null;
  };

  const seen = new Set<number>();
  const deduped: RawRow[] = [];
  for (const row of rawRows as unknown as RawRow[]) {
    if (seen.has(row.candidateIndex)) continue;
    seen.add(row.candidateIndex);
    deduped.push(row);
  }
  return deduped;
}

/** Record that a slug's LLM classification is in-flight.
 *  Writes startedAtMs into classify_state.inFlight[slug] via a JSONB merge.
 *  The slug is a parameterized bind value — no sql.raw, injection-safe. */
export async function markSkillInFlight(
  jobId: string,
  slug: string,
  startedAtMs: number,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`jsonb_set(
        coalesce(classify_state, '{}'),
        ARRAY['inFlight', ${slug}]::text[],
        ${String(startedAtMs)}::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Remove a slug from classify_state.inFlight once classification completes. */
export async function unmarkSkillInFlight(
  jobId: string,
  slug: string,
): Promise<void> {
  await db
    .update(skillAnalyzerJobs)
    .set({
      classifyState: sql`coalesce(classify_state, '{}') #- ARRAY['inFlight', ${slug}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

/** Persist the cluster-level agent recommendation on the job row.
 *  Written by Stage 8b after all per-skill proposals are finalised.
 *  Idempotent: no-op if a recommendation is already stored (job retry safety).
 *  Validates minimum shape before writing to prevent corrupt JSONB. */
export async function updateJobAgentRecommendation(
  jobId: string,
  recommendation: AgentRecommendation,
): Promise<void> {
  // Minimal shape guard — shouldCreateAgent must be boolean, reasoning non-empty string,
  // skillSlugs must be an array when present (UI calls .map() on it).
  if (typeof recommendation.shouldCreateAgent !== 'boolean') {
    throw new Error('updateJobAgentRecommendation: shouldCreateAgent must be boolean');
  }
  if (typeof recommendation.reasoning !== 'string' || recommendation.reasoning.trim() === '') {
    throw new Error('updateJobAgentRecommendation: reasoning must be a non-empty string');
  }
  if (recommendation.skillSlugs !== undefined && !Array.isArray(recommendation.skillSlugs)) {
    throw new Error('updateJobAgentRecommendation: skillSlugs must be an array if present');
  }

  // v2 Fix 5: also write the proposedNewAgents array. Single-agent case today;
  // shape supports N entries per job.
  const proposedNewAgents = recommendation.shouldCreateAgent
    ? [{
        proposedAgentIndex: 0,
        slug: recommendation.agentSlug ?? slugifyName(recommendation.agentName ?? 'proposed-agent'),
        name: recommendation.agentName ?? 'Proposed Agent',
        description: recommendation.agentDescription ?? recommendation.reasoning,
        reasoning: recommendation.reasoning,
        skillSlugs: Array.isArray(recommendation.skillSlugs) ? recommendation.skillSlugs : [],
        status: 'proposed' as const,
      }]
    : [];

  // Idempotency: only write if the column is still null (first run wins on retry).
  const updated = await db
    .update(skillAnalyzerJobs)
    .set({
      agentRecommendation: recommendation,
      proposedNewAgents,
    })
    .where(and(eq(skillAnalyzerJobs.id, jobId), isNull(skillAnalyzerJobs.agentRecommendation)))
    .returning({ id: skillAnalyzerJobs.id });

  if (updated.length === 0) {
    // Row was skipped — recommendation already written on a previous run.
    // Do NOT return early: the retro-inject below must still run. On resumed
    // or re-triggered jobs the agentRecommendation column is already set
    // (idempotency guard blocks the write) but the per-result agentProposals
    // may be empty if the inject was missed on a prior run (e.g. before Fix 5
    // was deployed, or if the inject was aborted mid-loop). The per-row
    // duplicate guard at line ~2123 prevents double-injection.
    logger.info('skill_analyzer_agent_recommendation_already_exists', { jobId });
  }

  // Retro-inject synthetic proposed-new-agent entries into affected
  // DISTINCT results' agentProposals so per-skill assignment panels can
  // show the proposed agent. Only runs when a new agent was suggested.
  if (recommendation.shouldCreateAgent && Array.isArray(recommendation.skillSlugs) && recommendation.skillSlugs.length > 0) {
    const slugSet = recommendation.skillSlugs.map(s => s.toLowerCase());
    const affectedRows = await db
      .select({ id: skillAnalyzerResults.id, candidateSlug: skillAnalyzerResults.candidateSlug, agentProposals: skillAnalyzerResults.agentProposals })
      .from(skillAnalyzerResults)
      .where(and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classification, 'DISTINCT'),
      ));
    const proposed = proposedNewAgents[0];
    for (const row of affectedRows) {
      if (!slugSet.includes(row.candidateSlug.toLowerCase())) continue;
      const existing = Array.isArray(row.agentProposals) ? row.agentProposals as Array<Record<string, unknown>> : [];
      // Skip if we've already injected this proposal on a previous run.
      if (existing.some(p => p?.isProposedNewAgent === true && p?.proposedAgentIndex === proposed.proposedAgentIndex)) {
        continue;
      }
      const synthetic = {
        systemAgentId: null,
        slugSnapshot: proposed.slug,
        nameSnapshot: proposed.name,
        score: 1.0,
        selected: true,
        isProposedNewAgent: true,
        proposedAgentIndex: proposed.proposedAgentIndex,
      };
      // Place the proposed agent at the top so the UI ranks it first.
      const nextProposals = [synthetic, ...existing];
      await db
        .update(skillAnalyzerResults)
        .set({ agentProposals: nextProposals })
        .where(eq(skillAnalyzerResults.id, row.id));
    }
  }
}

// ---------------------------------------------------------------------------
// Classification retry helpers
// ---------------------------------------------------------------------------

/** Classification outcome returned by the LLM classify stage.
 *  `mergeRationale` is populated on the rule-based fallback path (same helper
 *  as skillAnalyzerJob.ts Stage 5) so the retry path can persist it to the
 *  `merge_rationale` column. */
type ClassificationOutcome = {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
  proposedMerge: ProposedMerge | null;
  mergeRationale: string | null;
  classifierFallbackApplied: boolean;
};

/** Run LLM classification for a single candidate/library pair.
 *  Reuses the same model, backoff, and prompt as skillAnalyzerJob.ts Stage 5.
 *  Returns the classification result plus failure metadata. */
async function classifySingleCandidate(
  candidate: ParsedSkill,
  matchedLib: LibrarySkillSummary,
  similarityScore: number,
  jobId: string,
  organisationId: string,
): Promise<{
  result: ClassificationOutcome;
  classificationFailed: boolean;
  classificationFailureReason: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' | null;
}> {
  const band = skillAnalyzerServicePure.classifyBand(similarityScore);
  const { system, userMessage } = skillAnalyzerServicePure.buildClassifyPromptWithMerge(
    candidate,
    matchedLib,
    band as 'likely_duplicate' | 'ambiguous',
  );

  let parsed: ReturnType<typeof skillAnalyzerServicePure.parseClassificationResponseWithMerge>;
  let apiError: unknown = undefined;

  try {
    // Route through llmRouter so this service-layer classify call shows up
    // in llm_requests alongside the job-layer sites. The router handles
    // retries on provider errors + parse failures (via postProcess) via
    // its fallback loop; the outer withBackoff from before is retired.
    const response = await routeCall({
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 8192,
      temperature: 0.1,
      context: {
        organisationId,
        sourceType:         'analyzer',
        sourceId:           jobId,
        featureTag:         'skill-analyzer-service-classify',
        taskType:           'general',
        systemCallerPolicy: 'bypass_routing',
        provider:           'anthropic',
        model:              'claude-sonnet-4-6',
      },
      postProcess: (content: string) => {
        const res = skillAnalyzerServicePure.parseClassificationResponseWithMerge(content);
        if (res === null) {
          throw new ParseFailureError({ rawExcerpt: truncateUtf8Safe(content, 2048) });
        }
      },
    });
    parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
  } catch (err) {
    parsed = null;
    // Parse failures are not "API errors" for the failure-reason derivation;
    // the router has already recorded the ledger row with status='parse_failure'.
    apiError = (err as { code?: string })?.code === 'CLASSIFICATION_PARSE_FAILURE' ? undefined : err;
  }

  const classificationFailed = parsed === null;

  // On failure: route through the same fallback helper the Stage-5 job uses so
  // the reviewer sees a concrete rule-based proposal instead of "Proposal
  // unavailable." Both code paths MUST go through buildClassifierFailureOutcome
  // so the failure behaviour stays in lockstep.
  if (classificationFailed) {
    const fallback = buildClassifierFailureOutcome({
      candidate: {
        name: candidate.name,
        description: candidate.description,
        definition: (candidate.definition as object | null) ?? null,
        instructions: candidate.instructions ?? null,
      },
      library: {
        name: matchedLib.name,
        description: matchedLib.description,
        definition: (matchedLib.definition as object | null) ?? null,
        instructions: matchedLib.instructions ?? null,
      },
    });
    return {
      result: {
        classification: fallback.classification,
        confidence: fallback.confidence,
        reasoning: fallback.reasoning,
        proposedMerge: fallback.proposedMerge,
        mergeRationale: fallback.mergeRationale,
        classifierFallbackApplied: true,
      },
      classificationFailed: true,
      classificationFailureReason:
        skillAnalyzerServicePure.deriveClassificationFailureReason(apiError ?? null),
    };
  }

  // Success path: the LLM gave us a parseable result. It may or may not
  // include a proposedMerge (DUPLICATE / DISTINCT legitimately return null).
  return {
    result: {
      classification: parsed!.classification,
      confidence: parsed!.confidence,
      reasoning: parsed!.reasoning,
      proposedMerge: (parsed!.proposedMerge as ProposedMerge | null) ?? null,
      mergeRationale: (parsed!.proposedMerge as ProposedMerge | null)?.mergeRationale ?? null,
      classifierFallbackApplied: false,
    },
    classificationFailed: false,
    classificationFailureReason: null,
  };
}

/** Retry classification for a single result row that has classificationFailed=true.
 *  Idempotent: returns immediately if the row is not in a failed state.
 *  Uses the stored parsedCandidates + similarityScore — no re-parse or re-embed. */
export async function retryClassification(
  jobId: string,
  resultId: string,
  organisationId: string,
): Promise<void> {
  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };
  const job = jobRows[0];

  const resultRows = await db
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  if (!resultRows[0]) throw { statusCode: 404, message: 'Result not found' };
  const result = resultRows[0];

  // Idempotency guard: no-op if the row is not in a failed classification state
  if (!result.classificationFailed) return;

  const candidates = (job.parsedCandidates ?? []) as ParsedSkill[];
  const candidate = candidates[result.candidateIndex];
  if (!candidate) throw { statusCode: 422, message: 'Candidate not found in job parsedCandidates' };
  if (!result.matchedSkillId) throw { statusCode: 422, message: 'No matched skill to classify against' };
  if (result.similarityScore == null) throw { statusCode: 422, message: 'Missing similarity score' };

  const matchedSkillRows = await db
    .select()
    .from(systemSkills)
    .where(eq(systemSkills.id, result.matchedSkillId))
    .limit(1);
  if (!matchedSkillRows[0]) throw { statusCode: 422, message: 'Matched skill no longer exists' };
  const matchedSkill = matchedSkillRows[0];

  const matchedLib: LibrarySkillSummary = {
    id: matchedSkill.id,
    slug: matchedSkill.slug,
    name: matchedSkill.name,
    description: matchedSkill.description ?? '',
    definition: matchedSkill.definition as object,
    instructions: matchedSkill.instructions ?? null,
    isSystem: true,
  };

  const { result: classificationRaw, classificationFailed, classificationFailureReason } =
    await classifySingleCandidate(candidate, matchedLib, result.similarityScore, jobId, organisationId);

  // v6 Fix 5 (mirror): post-classifier DISTINCT_FALLBACK. Mirrors
  // skillAnalyzerJob.ts:1060-1091 so retries stay in lockstep with the main
  // classify path. When the LLM returned PARTIAL_OVERLAP/IMPROVEMENT but the
  // candidate cross-references the matched library skill AND similarity is
  // below 70%, reclassify as DISTINCT — merging would produce a confused
  // hybrid. Higher-similarity cross-references remain as merges; the main
  // path flags them via validation and that flagging is not mirrored on
  // retry (see note above about validate/remediate scope).
  let classification = classificationRaw;
  if (
    (classification.classification === 'PARTIAL_OVERLAP' ||
      classification.classification === 'IMPROVEMENT') &&
    skillAnalyzerServicePure.crossReferencesLibrarySkill(
      candidate.description,
      matchedLib.name,
      matchedLib.slug,
    ) &&
    result.similarityScore < 0.70
  ) {
    classification = {
      classification: 'DISTINCT',
      confidence: 0.5,
      reasoning:
        `${classification.reasoning} — post-classifier DISTINCT_FALLBACK: incoming skill cross-references "${matchedLib.name}" as a separate tool (similarity ${Math.round(result.similarityScore * 100)}%), so the merge was discarded in favour of presenting this as a new skill.`,
      proposedMerge: null,
      mergeRationale: null,
      classifierFallbackApplied: false,
    };
  }

  const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

  // Strip mergeRationale before persisting to proposed_merged_content — the
  // rationale lives in its own DB column (same contract as the Stage-5 job).
  const storedMerge: ProposedMerge | null = classification.proposedMerge
    ? { ...classification.proposedMerge, mergeRationale: undefined }
    : null;

  // When the fallback path ran, surface CLASSIFIER_FALLBACK so the UI banner
  // + approval gate activate (mirrors skillAnalyzerJob.ts:1092-1101). Full
  // validateMergeOutput / remediateTables re-validation on retry is tracked
  // separately — retry currently persists just the fallback marker.
  const mergeWarnings: MergeWarning[] | null = classification.classifierFallbackApplied
    ? [CLASSIFIER_FALLBACK_WARNING]
    : null;

  await db
    .update(skillAnalyzerResults)
    .set({
      classification: classification.classification,
      confidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      diffSummary,
      proposedMergedContent: storedMerge,
      mergeRationale: classification.mergeRationale,
      mergeWarnings,
      classifierFallbackApplied: classification.classifierFallbackApplied,
      // Only seed the immutable original if it has never been set — retries
      // must not overwrite it, otherwise "Reset to AI suggestion" would
      // restore the retry's output rather than the original job output.
      ...(result.originalProposedMerge === null && storedMerge !== null
        ? { originalProposedMerge: storedMerge }
        : {}),
      classificationFailed,
      classificationFailureReason,
    })
    .where(
      and(
        eq(skillAnalyzerResults.id, resultId),
        eq(skillAnalyzerResults.classificationFailed, true), // optimistic concurrency
      ),
    );
}

/** Retry all classificationFailed=true results in a job sequentially
 *  (no parallel burst) with jittered delay to avoid re-triggering 429s. */
export async function bulkRetryFailedClassifications(
  jobId: string,
  organisationId: string,
): Promise<{ retried: number; stillFailed: number }> {
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };

  const failedResults = await db
    .select({ id: skillAnalyzerResults.id })
    .from(skillAnalyzerResults)
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ),
    );

  for (let i = 0; i < failedResults.length; i++) {
    try {
      await retryClassification(jobId, failedResults[i].id, organisationId);
    } catch {
      // Row has a data-integrity problem (missing candidate / matchedSkillId /
      // similarityScore) — cannot be retried. Leave classificationFailed=true
      // and continue with remaining rows so one bad row doesn't abort the batch.
    }
    // Jittered delay: 500–1500ms between calls to avoid re-triggering 429s
    if (i < failedResults.length - 1) {
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
    }
  }

  const remaining = await db
    .select({ id: skillAnalyzerResults.id })
    .from(skillAnalyzerResults)
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.classificationFailed, true),
      ),
    );

  // retried = number of rows attempted (all failed rows are always attempted once)
  return { retried: failedResults.length, stillFailed: remaining.length };
}

export const skillAnalyzerService = {
  createJob,
  resumeJob,
  getJob,
  listJobs,
  setResultAction,
  bulkSetResultAction,
  updateAgentProposal,
  updateProposedAgent,
  patchMergeFields,
  resetMergeToOriginal,
  resolveWarning,
  executeApproved,
  unlockStaleExecution,
  updateJobProgress,
  retryClassification,
  bulkRetryFailedClassifications,
  // Internal — used by job handler only
  getJobById,
  insertResults,
  insertSingleResult,
  listResultIndicesForJob,
  markSkillInFlight,
  unmarkSkillInFlight,
  updateResultAgentProposals,
  updateJobAgentRecommendation,
  appendBatchCollisionWarnings,
  applyBatchDeductionAndWarningAtomic,
};
