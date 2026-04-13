import { eq, desc, inArray, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemSkills } from '../db/schema/systemSkills.js';
import { withBackoff } from '../lib/withBackoff.js';
import anthropicAdapter from './providers/anthropicAdapter.js';
import { skillAnalyzerServicePure } from './skillAnalyzerServicePure.js';
import type { ParsedSkill } from './skillParserServicePure.js';
import type { LibrarySkillSummary } from './skillAnalyzerServicePure.js';

/** Best-effort string extraction for thrown values. Services in this codebase
 *  throw plain objects of shape `{ statusCode, message }` (not Error
 *  instances), so the standard `err instanceof Error ? err.message : String(err)`
 *  pattern produces "[object Object]" for service errors. Try the message
 *  field first, fall back to Error.message, then String coercion. */
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return String(err);
}
import { skillAnalyzerJobs, skillAnalyzerResults } from '../db/schema/index.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { skillParserService } from './skillParserService.js';
// Phase 1 of skill-analyzer-v2: the analyzer is system-only. The
// org-skill skillService import was removed; executeApproved now writes
// to system_skills via systemSkillService. DISTINCT results use the
// generic_methodology handler; SKILL_HANDLERS is checked for IMPROVEMENT
// / PARTIAL_OVERLAP paths only (existing skills must remain paired).
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
  /** Per spec §7.4: live snapshot of all system agents for the
   *  "Add another system agent..." combobox in Phase 4. */
  availableSystemAgents: AvailableSystemAgent[];
}

/** Get job status and results. Validates that job belongs to the org.
 *  Phase 1 of skill-analyzer-v2 extends the response with two new fields:
 *  - matchedSkillContent on each result with a non-null matchedSkillId
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
  // Single batched query — avoid N+1 over getSkill().
  const matchedSkillIds = Array.from(
    new Set(
      rawResults
        .map((r) => r.matchedSkillId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  );
  const matchedSkillsById = new Map<string, SystemSkill>();
  if (matchedSkillIds.length > 0) {
    const rows = await db
      .select()
      .from(systemSkills)
      .where(inArray(systemSkills.id, matchedSkillIds));
    for (const row of rows) {
      const visibility =
        row.visibility === 'none' || row.visibility === 'basic' || row.visibility === 'full'
          ? row.visibility
          : 'none';
      matchedSkillsById.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? '',
        isActive: row.isActive,
        visibility,
        definition: row.definition as SystemSkill['definition'],
        instructions: row.instructions ?? null,
      });
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

  // Live read of system_agents for the "Add another system agent" combobox.
  // Full inventory at request time — not cached.
  const allAgents = await systemAgentService.listAgents();
  const availableSystemAgents: AvailableSystemAgent[] = allAgents.map((a) => ({
    systemAgentId: a.id,
    slug: a.slug,
    name: a.name,
  }));

  return { job, results, availableSystemAgents };
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

      const agent = await systemAgentService.getAgent(systemAgentId);
      const agentEmbedding = await agentEmbeddingService.refreshSystemAgentEmbedding(systemAgentId);
      // Hash-only lookup is intentional. Per skill_embeddings.ts schema
      // comment, sourceType reflects the LAST writer for a content hash and
      // is provenance-only — filtering by sourceType here would be wrong
      // because the same hash may have been re-written by a system or org
      // path before the candidate path. Spec §5.2 candidateContentHash.
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

/** Body for the PATCH /merge endpoint. Per spec §7.3 the four merge fields
 *  are individually patchable; any omitted field is left untouched.
 *  `instructions` may be explicitly null to clear the field.
 *  `ifUnmodifiedSince` is an optional ISO timestamp for optimistic concurrency:
 *  if the stored mergeUpdatedAt is newer than this value the endpoint returns 409. */
export interface PatchMergeFieldsParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  ifUnmodifiedSince?: string;
  patch: {
    name?: string;
    description?: string;
    definition?: object;
    instructions?: string | null;
  };
}

/** Patch one or more fields of a result row's proposedMergedContent jsonb.
 *  Used by the Phase 5 PATCH /merge endpoint. Validates classification
 *  (PARTIAL_OVERLAP / IMPROVEMENT only), validates the existing
 *  proposedMergedContent is non-null, validates the definition shape if
 *  it's being patched. Sets userEditedMerge=true on success. Per spec §7.3. */
export async function patchMergeFields(
  params: PatchMergeFieldsParams,
): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId, patch } = params;

  // Validate the definition shape early so we don't have to do it inside
  // the merge logic. The shared predicate is the single source of truth
  // for "what counts as a valid Anthropic tool definition".
  if (patch.definition !== undefined) {
    const { isValidToolDefinitionShape } = await import('../../shared/skillParameters.js');
    if (!isValidToolDefinitionShape(patch.definition)) {
      throw {
        statusCode: 400,
        message: 'definition must be an Anthropic tool-definition object with name, description, and input_schema',
      };
    }
  }

  // Job ownership
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

  // Optimistic concurrency: if the client sent ifUnmodifiedSince and the row
  // has already been written after that point, reject to avoid overwriting a
  // concurrent edit.
  if (params.ifUnmodifiedSince && row.mergeUpdatedAt) {
    if (new Date(row.mergeUpdatedAt) > new Date(params.ifUnmodifiedSince)) {
      throw {
        statusCode: 409,
        message: 'merge content was modified by another session — reload and retry',
      };
    }
  }

  // Per spec §7.3: merge edits only valid for PARTIAL_OVERLAP / IMPROVEMENT.
  if (row.classification !== 'PARTIAL_OVERLAP' && row.classification !== 'IMPROVEMENT') {
    throw {
      statusCode: 409,
      message: 'merge edits are only valid on PARTIAL_OVERLAP / IMPROVEMENT results',
    };
  }

  // Per spec §7.3: cannot patch a null merge — the LLM hasn't produced one.
  const current = row.proposedMergedContent as
    | { name: string; description: string; definition: object; instructions: string | null }
    | null;
  if (!current) {
    throw {
      statusCode: 409,
      message: 'merge proposal unavailable — re-run analysis',
    };
  }

  // Apply the partial patch.
  const next = {
    name: patch.name !== undefined ? patch.name : current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    definition: patch.definition !== undefined ? patch.definition : current.definition,
    instructions: patch.instructions !== undefined ? patch.instructions : current.instructions,
  };

  await db
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: next,
      userEditedMerge: true,
      mergeUpdatedAt: new Date(),
    })
    .where(eq(skillAnalyzerResults.id, resultId));

  // Return the freshly enriched row.
  const updatedRows = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    throw { statusCode: 500, message: 'patchMergeFields: row vanished after update' };
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

/** Reset proposedMergedContent back to the LLM's original (untouched) merge.
 *  Used by the Phase 5 POST /merge/reset endpoint. Per spec §7.3 returns
 *  409 if originalProposedMerge is null on an eligible row. */
export async function resetMergeToOriginal(params: {
  resultId: string;
  jobId: string;
  organisationId: string;
}): Promise<EnrichedResult> {
  const { resultId, jobId, organisationId } = params;

  // Job ownership
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

  if (row.classification !== 'PARTIAL_OVERLAP' && row.classification !== 'IMPROVEMENT') {
    throw {
      statusCode: 409,
      message: 'merge reset is only valid on PARTIAL_OVERLAP / IMPROVEMENT results',
    };
  }

  if (!row.originalProposedMerge) {
    throw { statusCode: 409, message: 'no original merge proposal to reset from' };
  }

  await db
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: row.originalProposedMerge,
      userEditedMerge: false,
      mergeUpdatedAt: new Date(),
    })
    .where(eq(skillAnalyzerResults.id, resultId));

  // Return enriched row (matchedSkillContent included)
  const updatedRows = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.id, resultId))
    .limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    throw { statusCode: 500, message: 'resetMergeToOriginal: row vanished after update' };
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
      const existingRows = await db
        .select({ id: systemSkills.id, isActive: systemSkills.isActive })
        .from(systemSkills)
        .where(eq(systemSkills.slug, candidate.slug))
        .limit(1);
      if (existingRows[0]) {
        const msg = existingRows[0].isActive
          ? `slug '${candidate.slug}' already exists in system_skills — pick a different slug or update the existing row instead`
          : `slug '${candidate.slug}' already exists in system_skills as a retired (inactive) row — reactivate it or pick a different slug`;
        await failResult(result.id, msg);
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
              handlerKey: 'generic_methodology',
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
        const errMsg = toErrorMessage(err);
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

// ---------------------------------------------------------------------------
// Classification retry helpers
// ---------------------------------------------------------------------------

/** Classification outcome returned by the LLM classify stage. */
type ClassificationOutcome = {
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  reasoning: string;
  proposedMerge: object | null;
};

/** Run LLM classification for a single candidate/library pair.
 *  Reuses the same model, backoff, and prompt as skillAnalyzerJob.ts Stage 5.
 *  Returns the classification result plus failure metadata. */
async function classifySingleCandidate(
  candidate: ParsedSkill,
  matchedLib: LibrarySkillSummary,
  similarityScore: number,
  jobId: string,
): Promise<{
  result: ClassificationOutcome;
  classificationFailed: boolean;
  classificationFailureReason: 'rate_limit' | 'timeout' | 'parse_error' | 'unknown' | null;
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
    const response = await withBackoff(
      () =>
        anthropicAdapter.call({
          model: 'claude-haiku-4-5-20251001',
          system,
          messages: [{ role: 'user', content: userMessage }],
          maxTokens: 512,
          temperature: 0.1,
        }),
      {
        label: 'skill-classify-retry',
        maxAttempts: 3,
        correlationId: jobId,
        runId: jobId,
        isRetryable: (err: unknown) => {
          const e = err as { statusCode?: number; code?: string };
          if (e?.code === 'PROVIDER_NOT_CONFIGURED') return false;
          return (
            e?.statusCode === 429 ||
            e?.statusCode === 503 ||
            e?.statusCode === 529 ||
            e?.code === 'PROVIDER_UNAVAILABLE'
          );
        },
      },
    );
    parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
  } catch (err) {
    parsed = null;
    apiError = err;
  }

  const classificationFailed = parsed === null;
  return {
    result: parsed ?? {
      classification: 'PARTIAL_OVERLAP',
      confidence: 0.3,
      reasoning: 'LLM classification failed - defaulting to PARTIAL_OVERLAP for human review.',
      proposedMerge: null,
    },
    classificationFailed,
    classificationFailureReason: classificationFailed
      ? skillAnalyzerServicePure.deriveClassificationFailureReason(apiError ?? null)
      : null,
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

  const { result: classification, classificationFailed, classificationFailureReason } =
    await classifySingleCandidate(candidate, matchedLib, result.similarityScore, jobId);

  const diffSummary = skillAnalyzerServicePure.generateDiffSummary(candidate, matchedLib);

  await db
    .update(skillAnalyzerResults)
    .set({
      classification: classification.classification,
      confidence: classification.confidence,
      classificationReasoning: classification.reasoning,
      diffSummary,
      proposedMergedContent: classification.proposedMerge ?? null,
      originalProposedMerge: classification.proposedMerge ?? null,
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

  let retried = 0;

  for (let i = 0; i < failedResults.length; i++) {
    await retryClassification(jobId, failedResults[i].id, organisationId);
    retried++;
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

  return { retried, stillFailed: remaining.length };
}

export const skillAnalyzerService = {
  createJob,
  getJob,
  listJobs,
  setResultAction,
  bulkSetResultAction,
  updateAgentProposal,
  patchMergeFields,
  resetMergeToOriginal,
  executeApproved,
  updateJobProgress,
  retryClassification,
  bulkRetryFailedClassifications,
  // Internal — used by job handler only
  getJobById,
  clearResultsForJob,
  insertResults,
};
