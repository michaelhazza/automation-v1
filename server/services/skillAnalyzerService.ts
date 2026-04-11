import { eq, desc, inArray, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../db/schema/index.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { skillParserService } from './skillParserService.js';
// Phase 1 of skill-analyzer-v2: the analyzer is system-only. The
// org-skill skillService import was removed; executeApproved now writes
// to system_skills via systemSkillService and gates DISTINCT results
// against the SKILL_HANDLERS registry to prevent shipping unpaired rows.
import { systemSkillService, type SystemSkill } from './systemSkillService.js';
import { systemAgentService } from './systemAgentService.js';
import { SKILL_HANDLERS } from './skillExecutor.js';

// ---------------------------------------------------------------------------
// Skill Analyzer Service — CRUD for jobs/results + pipeline orchestration
// ---------------------------------------------------------------------------

export type SkillAnalyzerJobStatus =
  | 'pending' | 'parsing' | 'hashing' | 'embedding'
  | 'comparing' | 'classifying' | 'completed' | 'failed';

/** Create a new analysis job and enqueue it for background processing.
 *  For paste/github, rawInput is the text/url string.
 *  For upload, rawInput is the array of Multer files. */
export async function createJob(params: {
  organisationId: string;
  userId: string;
  sourceType: 'paste' | 'upload' | 'github' | 'download';
  sourceMetadata: Record<string, unknown>;
  rawInput: string | Express.Multer.File[];
}): Promise<{ jobId: string }> {
  const { organisationId, userId, sourceType, sourceMetadata, rawInput } = params;

  // For paste source, parse immediately and store candidates on the job row.
  // For upload/github, the job handler will fetch/parse during processing.
  let parsedCandidates: unknown = null;

  if (sourceType === 'paste' && typeof rawInput === 'string') {
    const candidates = skillParserService.parseFromPaste(rawInput);
    parsedCandidates = candidates;
  } else if (sourceType === 'upload' && Array.isArray(rawInput)) {
    // Parse synchronously at job creation — files are already in temp dir
    const candidates = await skillParserService.parseUploadedFiles(rawInput);
    parsedCandidates = candidates;
  }
  // For github and download, candidates are fetched during job processing

  const rows = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId,
      createdBy: userId,
      sourceType,
      sourceMetadata,
      parsedCandidates,
      status: 'pending',
      progressPct: 0,
    })
    .returning({ id: skillAnalyzerJobs.id });

  const jobId = rows[0].id;

  // Enqueue pg-boss job
  const boss = await getPgBoss();
  await boss.send('skill-analyzer', { jobId }, {
    singletonKey: undefined,
  });

  return { jobId };
}

/** Shape of `matchedSkillContent` attached to result rows in the GET response.
 *  Computed live from systemSkillService.getSkill at request time. See spec §7.4. */
export interface MatchedSkillContent {
  id: string;
  slug: string;
  name: string;
  description: string;
  definition: object;
  instructions: string | null;
}

/** Shape of `availableSystemAgents` attached to the job in the GET response.
 *  Used by the Phase 4 "Add another system agent..." combobox. */
export interface AvailableSystemAgent {
  systemAgentId: string;
  slug: string;
  name: string;
}

/** Result row enriched with the live `matchedSkillContent` lookup. */
export type EnrichedResult = typeof skillAnalyzerResults.$inferSelect & {
  matchedSkillContent?: MatchedSkillContent;
};

/** Job + enriched results + Phase 1 GET response extensions. */
export interface GetJobResponse {
  job: typeof skillAnalyzerJobs.$inferSelect;
  results: EnrichedResult[];
  /** Per spec §7.4: candidate slugs in this job's results that have no
   *  corresponding key in SKILL_HANDLERS at request time. The Review UI
   *  uses this to disable the Approve button on affected New Skill cards
   *  and to filter the "Approve all new" bulk action. */
  unregisteredHandlerSlugs: string[];
  /** Per spec §7.4: live snapshot of all system agents for the
   *  "Add another system agent..." combobox in Phase 4. */
  availableSystemAgents: AvailableSystemAgent[];
}

/** Get job status and results. Validates that job belongs to the org.
 *  Phase 1 of skill-analyzer-v2 extends the response with three new fields:
 *  - matchedSkillContent on each result with a non-null matchedSkillId
 *  - unregisteredHandlerSlugs on the job (handler-gate state for §7.1 UI)
 *  - availableSystemAgents on the job (combobox source for Phase 4) */
export async function getJob(
  jobId: string,
  organisationId: string
): Promise<GetJobResponse> {
  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  const job = jobRows[0];
  if (!job) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const rawResults = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.jobId, jobId))
    .orderBy(skillAnalyzerResults.candidateIndex);

  // Live lookup: for every result with matchedSkillId set, fetch the current
  // system_skills row and attach as matchedSkillContent. If the skill was
  // deleted between analysis and now, omit the field for that result (the
  // Review UI handles the missing field with a fallback notice — spec §7.4).
  const matchedSkillIds = Array.from(
    new Set(
      rawResults
        .map((r) => r.matchedSkillId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  );
  const matchedSkillsById = new Map<string, SystemSkill>();
  for (const id of matchedSkillIds) {
    try {
      const skill = await systemSkillService.getSkill(id);
      matchedSkillsById.set(id, skill);
    } catch {
      // 404 — skill was deleted after analysis. Leave out of the map.
    }
  }

  const results: EnrichedResult[] = rawResults.map((r) => {
    if (!r.matchedSkillId) return r;
    const matched = matchedSkillsById.get(r.matchedSkillId);
    if (!matched) return r;
    const matchedSkillContent: MatchedSkillContent = {
      id: matched.id,
      slug: matched.slug,
      name: matched.name,
      description: matched.description,
      definition: matched.definition as object,
      instructions: matched.instructions,
    };
    return { ...r, matchedSkillContent };
  });

  // Diff the candidate slugs in this job against the live SKILL_HANDLERS
  // registry. Any candidate slug whose handler is not registered appears in
  // unregisteredHandlerSlugs and the Review UI gates approval accordingly.
  const candidateSlugs = Array.from(new Set(rawResults.map((r) => r.candidateSlug)));
  const registeredHandlers = new Set(Object.keys(SKILL_HANDLERS));
  const unregisteredHandlerSlugs = candidateSlugs.filter((slug) => !registeredHandlers.has(slug));

  // Live read of system_agents for the "Add another system agent" combobox.
  // Full inventory at request time — not cached.
  const allAgents = await systemAgentService.listAgents();
  const availableSystemAgents: AvailableSystemAgent[] = allAgents.map((a) => ({
    systemAgentId: a.id,
    slug: a.slug,
    name: a.name,
  }));

  return { job, results, unregisteredHandlerSlugs, availableSystemAgents };
}

/** List jobs for an org (most recent first). */
export async function listJobs(
  organisationId: string,
  limit = 20,
  offset = 0
): Promise<(typeof skillAnalyzerJobs.$inferSelect)[]> {
  return db
    .select()
    .from(skillAnalyzerJobs)
    .where(eq(skillAnalyzerJobs.organisationId, organisationId))
    .orderBy(desc(skillAnalyzerJobs.createdAt))
    .limit(limit)
    .offset(offset);
}

/** Set action on a single result. Validates job + org ownership. */
export async function setResultAction(params: {
  resultId: string;
  jobId: string;
  organisationId: string;
  userId: string;
  action: 'approved' | 'rejected' | 'skipped';
}): Promise<void> {
  const { resultId, jobId, organisationId, userId, action } = params;

  // Verify job belongs to org
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  await db
    .update(skillAnalyzerResults)
    .set({
      actionTaken: action,
      actionTakenAt: new Date(),
      actionTakenBy: userId,
    })
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)));
}

/** Bulk set action on multiple results. */
export async function bulkSetResultAction(params: {
  resultIds: string[];
  jobId: string;
  organisationId: string;
  userId: string;
  action: 'approved' | 'rejected' | 'skipped';
}): Promise<void> {
  const { resultIds, jobId, organisationId, userId, action } = params;
  if (resultIds.length === 0) return;

  // Verify job belongs to org
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  await db
    .update(skillAnalyzerResults)
    .set({
      actionTaken: action,
      actionTakenAt: new Date(),
      actionTakenBy: userId,
    })
    .where(
      and(
        inArray(skillAnalyzerResults.id, resultIds),
        eq(skillAnalyzerResults.jobId, jobId)
      )
    );
}

/** Body for the PATCH /jobs/:jobId/results/:resultId/agents endpoint.
 *  Exactly one of `selected`, `remove`, or `addIfMissing` must be present.
 *  See spec §7.3 for the full contract. */
export interface UpdateAgentProposalParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  systemAgentId: string;
  /** Toggle the selected flag on an existing proposal. */
  selected?: boolean;
  /** Drop the proposal from agentProposals entirely. */
  remove?: boolean;
  /** Manual-add: when the proposal is not in agentProposals, refresh the
   *  agent's embedding and append a fully-scored proposal with selected=true.
   *  When the proposal is already present, this is a no-op. */
  addIfMissing?: boolean;
}

/** Update one entry in a result row's agentProposals jsonb. Used by the
 *  Phase 4 PATCH /agents endpoint. Per spec §7.3 the endpoint has three
 *  modes — toggle / remove / addIfMissing — exactly one of which must be
 *  set. The service throws on validation failures with the same shape the
 *  routes expect: { statusCode, message }. */
export async function updateAgentProposal(
  params: UpdateAgentProposalParams,
): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId, systemAgentId } = params;

  // Mutual exclusivity validation
  const modeCount =
    (params.selected !== undefined ? 1 : 0) +
    (params.remove === true ? 1 : 0) +
    (params.addIfMissing === true ? 1 : 0);
  if (modeCount !== 1) {
    throw {
      statusCode: 400,
      message: 'exactly one of selected, remove, or addIfMissing is required',
    };
  }

  // Verify job belongs to org and load the result row.
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const resultRows = await db
    .select()
    .from(skillAnalyzerResults)
    .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
    .limit(1);
  const row = resultRows[0];
  if (!row) {
    throw { statusCode: 404, message: 'Result not found' };
  }

  // Per spec §7.3, agent proposals are only valid on DISTINCT results.
  if (row.classification !== 'DISTINCT') {
    throw {
      statusCode: 409,
      message: 'agent proposals are only valid on DISTINCT results',
    };
  }

  type ProposalRow = {
    systemAgentId: string;
    slugSnapshot: string;
    nameSnapshot: string;
    score: number;
    selected: boolean;
  };
  const proposals: ProposalRow[] = Array.isArray(row.agentProposals)
    ? (row.agentProposals as ProposalRow[])
    : [];

  // ---------------------------------------------------------------------
  // Mode dispatch
  // ---------------------------------------------------------------------
  let nextProposals: ProposalRow[];

  if (params.remove === true) {
    if (!proposals.find((p) => p.systemAgentId === systemAgentId)) {
      throw { statusCode: 404, message: 'proposal not found' };
    }
    nextProposals = proposals.filter((p) => p.systemAgentId !== systemAgentId);
  } else if (params.selected !== undefined) {
    const idx = proposals.findIndex((p) => p.systemAgentId === systemAgentId);
    if (idx === -1) {
      throw { statusCode: 404, message: 'proposal not found' };
    }
    nextProposals = proposals.map((p, i) =>
      i === idx ? { ...p, selected: params.selected === true } : p,
    );
  } else {
    // addIfMissing
    const existingIdx = proposals.findIndex((p) => p.systemAgentId === systemAgentId);
    if (existingIdx !== -1) {
      // Already present — no-op. Return the row unchanged so the client
      // can follow up with a separate selected toggle if needed.
      nextProposals = proposals;
    } else {
      // Manual-add path: refresh the agent's embedding (lazy), look up
      // the candidate embedding from skill_embeddings via the persisted
      // candidateContentHash, compute live cosine similarity, append a
      // fully-scored proposal with selected=true. Re-sort by score desc.
      // See spec §6.2 manual-add flow.
      const { agentEmbeddingService } = await import('./agentEmbeddingService.js');
      const { skillEmbeddingService } = await import('./skillEmbeddingService.js');
      const { systemAgentService } = await import('./systemAgentService.js');
      const { skillAnalyzerServicePure } = await import('./skillAnalyzerServicePure.js');

      const agent = await systemAgentService.getAgent(systemAgentId);
      const agentEmbedding = await agentEmbeddingService.refreshSystemAgentEmbedding(systemAgentId);
      const candidateEmbedding = await skillEmbeddingService.getByContentHash(row.candidateContentHash);
      if (!candidateEmbedding) {
        throw {
          statusCode: 409,
          message: `candidate embedding not found for hash ${row.candidateContentHash}; re-run the analysis to repopulate`,
        };
      }
      const score = skillAnalyzerServicePure.cosineSimilarity(
        candidateEmbedding.embedding,
        agentEmbedding.embedding,
      );
      const newProposal: ProposalRow = {
        systemAgentId,
        slugSnapshot: agent.slug,
        nameSnapshot: agent.name,
        score,
        selected: true,
      };
      nextProposals = [...proposals, newProposal].sort((a, b) => b.score - a.score);
    }
  }

  await db
    .update(skillAnalyzerResults)
    .set({ agentProposals: nextProposals })
    .where(eq(skillAnalyzerResults.id, resultId));

  // Return the freshly enriched result via getJob (so the response shape
  // matches the GET endpoint). For efficiency we re-fetch only this row's
  // join data rather than re-running the full job lookup.
  const updatedRows = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    // Race condition — extremely unlikely. Surface as 500.
    throw { statusCode: 500, message: 'updateAgentProposal: row vanished after update' };
  }

  let enriched: EnrichedResult = updated;
  if (updated.matchedSkillId) {
    try {
      const matched = await systemSkillService.getSkill(updated.matchedSkillId);
      enriched = {
        ...updated,
        matchedSkillContent: {
          id: matched.id,
          slug: matched.slug,
          name: matched.name,
          description: matched.description,
          definition: matched.definition as object,
          instructions: matched.instructions,
        },
      };
    } catch {
      // Library skill deleted — leave matchedSkillContent omitted.
    }
  }
  return enriched;
}

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
}> {
  const { jobId, organisationId } = params;

  const { job, results } = await getJob(jobId, organisationId);

  const approved = results.filter(
    (r) => r.actionTaken === 'approved' && (!r.executionResult || r.executionResult === 'failed'),
  );
  const parsedCandidates = (job.parsedCandidates as unknown[]) || [];

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
      let matchedRow: SystemSkill | null = null;
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
      // Apply the merge inside a transaction. In Phase 1 this is a single-
      // statement transaction; the wrapping is in place for Phase 2's
      // multi-statement extensions.
      try {
        await db.transaction(async (tx) => {
          await systemSkillService.updateSystemSkill(
            result.matchedSkillId!,
            {
              name: merge.name,
              description: merge.description,
              definition: merge.definition as never,
              instructions: merge.instructions,
            },
            { tx },
          );
        });
        await db
          .update(skillAnalyzerResults)
          .set({ executionResult: 'updated', resultingSkillId: result.matchedSkillId })
          .where(eq(skillAnalyzerResults.id, result.id));
        updated++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await failResult(result.id, errMsg);
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // DISTINCT: create a new system skill (+ agent attach in Phase 2)
    // -----------------------------------------------------------------------
    if (result.classification === 'DISTINCT') {
      // Guard 1: handler must already be registered. The analyzer can stage
      // an unpaired skill in the DB row but execute will refuse — engineers
      // must add the handler to skillExecutor.ts SKILL_HANDLERS first.
      if (!(candidate.slug in SKILL_HANDLERS)) {
        await failResult(
          result.id,
          `No handler registered for skill '${candidate.slug}'. An engineer must add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts before this skill can be imported.`,
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
      const existing = await systemSkillService.getSkillBySlug(candidate.slug);
      if (existing) {
        await failResult(
          result.id,
          `slug '${candidate.slug}' already exists in system_skills — pick a different slug or update the existing row instead`,
        );
        continue;
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
          const created = await systemSkillService.createSystemSkill(
            {
              slug: candidate.slug,
              handlerKey: candidate.slug,
              name: candidate.name,
              description: candidate.description,
              definition: candidate.definition as never,
              instructions: candidate.instructions,
            },
            { tx },
          );

          // Phase 2: read agentProposals off the result row, filter to
          // the selected ones, and attach the new skill's slug to each
          // chosen agent's defaultSystemSkillSlugs array. Missing agents
          // are logged and skipped (not a hard failure — see spec §9
          // edge case "system agent is deleted between analysis and
          // execute").
          const proposals = (result.agentProposals as Array<{
            systemAgentId: string;
            slugSnapshot: string;
            nameSnapshot: string;
            score: number;
            selected: boolean;
          }> | null) ?? [];

          for (const proposal of proposals) {
            if (!proposal.selected) continue;

            let agent;
            try {
              agent = await systemAgentService.getAgent(proposal.systemAgentId, { tx });
            } catch {
              // 404 — agent was deleted between analysis and execute.
              console.info('[skillAnalyzer] agent attach skipped — missing', {
                resultId: result.id,
                systemAgentId: proposal.systemAgentId,
                outcome: 'skipped-missing',
              });
              continue;
            }

            const currentSlugs: string[] = Array.isArray(agent.defaultSystemSkillSlugs)
              ? (agent.defaultSystemSkillSlugs as string[])
              : [];
            if (currentSlugs.includes(created.slug)) {
              // Already attached — idempotent no-op.
              console.info('[skillAnalyzer] agent attach already-present', {
                resultId: result.id,
                systemAgentId: proposal.systemAgentId,
                outcome: 'attached',
              });
              continue;
            }
            const nextSlugs = [...currentSlugs, created.slug];
            await systemAgentService.updateAgent(
              proposal.systemAgentId,
              { defaultSystemSkillSlugs: nextSlugs },
              { tx },
            );
            console.info('[skillAnalyzer] agent attach succeeded', {
              resultId: result.id,
              systemAgentId: proposal.systemAgentId,
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
        const errMsg = err instanceof Error ? err.message : String(err);
        await failResult(result.id, errMsg);
      }
      continue;
    }
  }

  return { created, updated, failed, errors };
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

  await db
    .update(skillAnalyzerJobs)
    .set(values)
    .where(eq(skillAnalyzerJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Internal functions for job handler use (no org-scoping — admin bypass path)
// ---------------------------------------------------------------------------

/** Load a job by ID without org validation (for internal job processing only). */
export async function getJobById(
  jobId: string
): Promise<typeof skillAnalyzerJobs.$inferSelect | null> {
  const rows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(eq(skillAnalyzerJobs.id, jobId))
    .limit(1);
  return rows[0] ?? null;
}

/** Delete all results for a job (idempotent retry support). */
export async function clearResultsForJob(jobId: string): Promise<void> {
  await db.delete(skillAnalyzerResults).where(eq(skillAnalyzerResults.jobId, jobId));
}

/** Batch insert results for a job. Splits into 100-row batches. */
export async function insertResults(
  rows: (typeof skillAnalyzerResults.$inferInsert)[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
  }
}

export const skillAnalyzerService = {
  createJob,
  getJob,
  listJobs,
  setResultAction,
  bulkSetResultAction,
  updateAgentProposal,
  executeApproved,
  updateJobProgress,
  // Internal — used by job handler only
  getJobById,
  clearResultsForJob,
  insertResults,
};
