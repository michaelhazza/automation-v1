import { eq, desc, inArray, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../db/schema/index.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { skillParserService } from './skillParserService.js';
import { skillService } from './skillService.js';

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
  // For github, candidates are fetched during job processing

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
  await boss.send('skill-analyzer', { jobId, organisationId }, {
    singletonKey: undefined,
  });

  return { jobId };
}

/** Get job status and results. Validates that job belongs to the org. */
export async function getJob(
  jobId: string,
  organisationId: string
): Promise<{ job: typeof skillAnalyzerJobs.$inferSelect; results: typeof skillAnalyzerResults.$inferSelect[] }> {
  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  const job = jobRows[0];
  if (!job) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  const results = await db
    .select()
    .from(skillAnalyzerResults)
    .where(eq(skillAnalyzerResults.jobId, jobId))
    .orderBy(skillAnalyzerResults.candidateIndex);

  return { job, results };
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

/** Execute all approved actions (create/update skills in the library). */
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
    (r) => r.actionTaken === 'approved' && (!r.executionResult || r.executionResult === 'failed')
  );
  const parsedCandidates = (job.parsedCandidates as unknown[]) || [];

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: Array<{ resultId: string; error: string }> = [];

  for (const result of approved) {
    const candidate = parsedCandidates[result.candidateIndex] as {
      name: string;
      slug: string;
      description: string;
      definition: object | null;
      instructions: string | null;
      methodology: string | null;
    } | undefined;

    if (!candidate) {
      errors.push({ resultId: result.id, error: 'Candidate data not found in job' });
      failed++;
      await db
        .update(skillAnalyzerResults)
        .set({ executionResult: 'failed', executionError: 'Candidate data not found in job' })
        .where(eq(skillAnalyzerResults.id, result.id));
      continue;
    }

    try {
      if (result.classification === 'DUPLICATE') {
        // Approved duplicate = skip (no-op)
        await db
          .update(skillAnalyzerResults)
          .set({ executionResult: 'skipped' })
          .where(eq(skillAnalyzerResults.id, result.id));
        continue;
      }

      if (result.classification === 'IMPROVEMENT' && !result.matchedSkillId) {
        // System skill match — cannot update system skills (no DB id)
        errors.push({ resultId: result.id, error: 'Cannot update a system skill — approve as DISTINCT to create an org-level override instead.' });
        failed++;
        await db
          .update(skillAnalyzerResults)
          .set({ executionResult: 'failed', executionError: 'Cannot update system skills; re-approve as DISTINCT to create an org override.' })
          .where(eq(skillAnalyzerResults.id, result.id));
        continue;
      } else if (result.classification === 'IMPROVEMENT' && result.matchedSkillId) {
        // Update the matched org skill
        await skillService.updateSkill(result.matchedSkillId, organisationId, {
          name: candidate.name,
          description: candidate.description,
          definition: candidate.definition ?? {},
          instructions: candidate.instructions ?? undefined,
          methodology: candidate.methodology ?? undefined,
        });

        await db
          .update(skillAnalyzerResults)
          .set({ executionResult: 'updated', resultingSkillId: result.matchedSkillId })
          .where(eq(skillAnalyzerResults.id, result.id));
        updated++;
      } else {
        // DISTINCT or PARTIAL_OVERLAP — create new org skill
        const newSkill = await skillService.createSkill(organisationId, {
          name: candidate.name,
          slug: candidate.slug,
          description: candidate.description,
          definition: candidate.definition ?? {},
          instructions: candidate.instructions ?? undefined,
          methodology: candidate.methodology ?? undefined,
        });

        await db
          .update(skillAnalyzerResults)
          .set({ executionResult: 'created', resultingSkillId: newSkill.id })
          .where(eq(skillAnalyzerResults.id, result.id));
        created++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push({ resultId: result.id, error: errMsg });
      failed++;
      await db
        .update(skillAnalyzerResults)
        .set({ executionResult: 'failed', executionError: errMsg })
        .where(eq(skillAnalyzerResults.id, result.id));
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
  executeApproved,
  updateJobProgress,
  // Internal — used by job handler only
  getJobById,
  clearResultsForJob,
  insertResults,
};
