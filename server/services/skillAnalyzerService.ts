import { eq, desc, inArray, and, sql, isNull } from 'drizzle-orm';
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
import type { LibrarySkillSummary, AgentRecommendation, MergeWarning, WarningResolution, WarningTier, MergeWarningCode, WarningResolutionKind, ProposedMerge, SkillAnalyzerJobStatus } from './skillAnalyzerServicePure.js';
import { evaluateApprovalState, checkConcurrencyStamp, buildClassifierFailureOutcome, CLASSIFIER_FALLBACK_WARNING, isSkillAnalyzerMidFlightStatus } from './skillAnalyzerServicePure.js';
import type { ClassifyState } from '../db/schema/skillAnalyzerJobs.js';
import * as skillAnalyzerConfigService from './skillAnalyzerConfigService.js';
import { createHash, randomUUID } from 'crypto';

/** Deterministic JSON stringify (sorted keys) for hashing. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const stringify = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (seen.has(v as object)) return '"[circular]"';
    seen.add(v as object);
    if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
    const keys = Object.keys(v as object).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stringify((v as Record<string, unknown>)[k])).join(',') + '}';
  };
  return stringify(value);
}

/** v2 §11.11.7 helper: deterministic hash of a skill's content fields so
 *  Execute can idempotent-skip a slug collision when the existing row was
 *  created by a prior (crashed) run. */
function hashSkillContent(s: {
  name: string;
  description: string | null;
  definition: object | null;
  instructions: string | null;
}): string {
  const payload = stableStringify({
    name: s.name,
    description: s.description ?? '',
    definition: s.definition ?? null,
    instructions: s.instructions ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

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
import { getJobConfig } from '../config/jobConfig.js';
import { skillParserService } from './skillParserService.js';
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

  // v2 §11.11.4: capture the full config row at job start so mid-job config
  // edits never apply to an in-flight run. Downstream stages (merge validation,
  // approval gate, Execute) read from `jobs.config_snapshot`, not the live
  // table.
  const configSnapshot = await skillAnalyzerConfigService.snapshotForJob();

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
      configSnapshot,
      configVersionUsed: configSnapshot.configVersion,
    })
    .returning({ id: skillAnalyzerJobs.id });

  const jobId = rows[0].id;

  // Enqueue pg-boss job. Passing getJobConfig so the queue actually
  // respects the retry/expire settings declared in jobConfig.ts; without
  // this, pg-boss defaults applied (notably a 15-min expireIn) which
  // killed otherwise-healthy long runs mid-Stage-5. singletonKey stays
  // undefined — one-shot enqueue per jobId.
  const boss = await getPgBoss();
  await boss.send('skill-analyzer', { jobId }, {
    ...getJobConfig('skill-analyzer'),
    singletonKey: undefined,
  });

  return { jobId };
}

/** Re-enqueue a previously-started analysis job that failed or stalled.
 *  The handler is crash-resumable: Stage 1 reuses stored parsedCandidates,
 *  Stage 5 skips already-classified candidateIndices, and Stage 6 hits
 *  the agent-embedding cache when content hashes match. So resuming is
 *  effectively free on LLM spend.
 *
 *  Safety guards:
 *    - Refuses if job.status === 'completed' (work already done)
 *    - Refuses if an alive pg-boss queue entry for this jobId still
 *      exists (would cause double-processing and Stage 8 race conditions)
 *
 *  Intermediate status (e.g. 'classifying') is accepted and reset — this
 *  is the common case where a worker was SIGKILL'd mid-pipeline and left
 *  the row in an in-flight state. */

/** How long a mid-flight row must be silent before resume will force-expire
 *  a lingering pg-boss `active` entry. 2× the stale-sweep threshold so
 *  this path only trips on jobs that are clearly dead but haven't yet been
 *  reaped by the periodic sweep. See Round 1 Finding 7. */
const RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS = 30 * 60_000;

export async function resumeJob(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}): Promise<{ ok: true }> {
  const { jobId, organisationId } = params;

  const [job] = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(
      eq(skillAnalyzerJobs.id, jobId),
      eq(skillAnalyzerJobs.organisationId, organisationId),
    ));

  if (!job) throw { statusCode: 404, message: 'Analysis job not found.' };
  if (job.status === 'completed') {
    throw { statusCode: 409, message: 'Analysis already completed — nothing to resume.' };
  }

  // Guard against double-enqueue: if pg-boss already has a live row for
  // this jobId, resuming would run the handler twice in parallel and both
  // copies would fight over the Stage-8 insert set.
  //
  // Exception: a lingering 'active' pg-boss entry combined with EITHER
  //   (a) our DB row is 'failed', or
  //   (b) our DB row is mid-flight but has been silent past the stale
  //       resume threshold (2× the sweep threshold = 30 min by default),
  // means the worker process died without pg-boss detecting it (pg-boss's
  // own lock only expires after expireInSeconds, which is 4 hours). Force-
  // expire the ghost so resume can proceed rather than blocking the user
  // for hours on a dead worker.
  //
  // Case (b) matters because the sweep runs periodically; between worker
  // death and the next sweep tick a user clicking Resume would otherwise
  // get "already queued or running" for up to 15 min despite nothing
  // actually running. See ChatGPT PR review Round 1 Finding 7.
  //
  // drizzle-orm/postgres-js returns db.execute() as the row array directly
  // (NOT { rows }) — see server/services/jobQueueHealthService.ts for the
  // established cast pattern.
  const aliveRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pgboss.job
    WHERE name = 'skill-analyzer'
      AND data->>'jobId' = ${jobId}
      AND state IN ('created', 'retry', 'active')
  `);
  const aliveCount = (aliveRows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  if (aliveCount > 0) {
    const jobUpdatedMs = job.updatedAt instanceof Date
      ? job.updatedAt.getTime()
      : new Date(job.updatedAt as unknown as string).getTime();
    const silenceMs = Date.now() - jobUpdatedMs;
    const midFlightStale = isSkillAnalyzerMidFlightStatus(job.status)
      && silenceMs > RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS;
    if (job.status === 'failed' || midFlightStale) {
      // Dead worker left a ghost active entry — expire it so we can re-enqueue.
      await db.execute(sql`
        UPDATE pgboss.job
        SET state = 'failed',
            completedon = NOW(),
            output = '{"error":"Expired by resume — worker process died"}'::jsonb
        WHERE name = 'skill-analyzer'
          AND data->>'jobId' = ${jobId}
          AND state = 'active'
      `);
      logger.info('skill_analyzer.resume_force_expired_ghost', {
        jobId,
        dbStatus: job.status,
        silenceMs,
        reason: job.status === 'failed' ? 'db_failed' : 'mid_flight_stale',
      });
    } else {
      throw { statusCode: 409, message: 'Analysis is already queued or running.' };
    }
  }

  // Reset the intermediate row state so the progress UI reflects the
  // resume and the handler's stage-entry updates don't look like regressions.
  // Everything the handler needs to resume (parsedCandidates, configSnapshot,
  // classifyState, existing skill_analyzer_results rows) is preserved —
  // those are the inputs to Stage 5's skip-already-classified logic.
  await db
    .update(skillAnalyzerJobs)
    .set({
      status: 'pending',
      errorMessage: null,
      progressMessage: 'Resuming analysis...',
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));

  const boss = await getPgBoss();
  await boss.send('skill-analyzer', { jobId }, {
    ...getJobConfig('skill-analyzer'),
    singletonKey: undefined,
  });

  logger.info('skill_analyzer.resume_enqueued', { jobId, organisationId });
  return { ok: true };
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
  /** v2 §11.12.5: true when the mutation cleared existing warning_resolutions
   *  so the UI can surface a "Review decisions reset" toast. */
  resolutionsCleared?: boolean;
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
  // action=null unapproves a previously-approved result (clears approved_at).
  action: 'approved' | 'rejected' | 'skipped' | null;
}): Promise<void> {
  const { resultId, jobId, organisationId, userId, action } = params;

  // Verify job belongs to org
  const jobRows = await db
    .select({ id: skillAnalyzerJobs.id, configSnapshot: skillAnalyzerJobs.configSnapshot })
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);

  if (!jobRows[0]) {
    throw { statusCode: 404, message: 'Job not found' };
  }

  // Server-side blocking enforcement via canonical evaluateApprovalState.
  // PARTIAL_OVERLAP / IMPROVEMENT results with unresolved decision_required
  // or critical warnings cannot transition to approved.
  if (action === 'approved') {
    const resultRows = await db
      .select()
      .from(skillAnalyzerResults)
      .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)))
      .limit(1);

    const resultRow = resultRows[0];
    if (!resultRow) {
      throw { statusCode: 404, message: 'Result not found' };
    }

    if (
      resultRow.classification === 'PARTIAL_OVERLAP' ||
      resultRow.classification === 'IMPROVEMENT'
    ) {
      const warnings = (resultRow.mergeWarnings ?? []) as MergeWarning[];
      const resolutions = (resultRow.warningResolutions ?? []) as WarningResolution[];
      const snapshot = jobRows[0].configSnapshot as { warningTierMap?: Record<string, WarningTier> } | null;
      const tierMap = skillAnalyzerConfigService.effectiveTierMap(
        snapshot as unknown as { warningTierMap: Record<string, WarningTier> } | null,
      );
      const state = evaluateApprovalState(warnings, resolutions, tierMap);
      if (state.blocked) {
        throw {
          statusCode: 422,
          message: 'Cannot approve: merge has unresolved blocking warnings.',
          errorCode: 'MERGE_CRITICAL_WARNINGS',
          reasons: state.reasons,
        };
      }

      // Approval snapshot + drift-detection hash (§11.11.12, §11.12.1).
      const approvalSnapshot = {
        warnings,
        resolutions,
        state,
        configVersion: (snapshot as { configVersion?: number } | null)?.configVersion ?? null,
        evaluatedAt: new Date().toISOString(),
      };
      const approvalHash = createHash('sha256')
        .update(stableStringify(approvalSnapshot))
        .digest('hex');

      await db
        .update(skillAnalyzerResults)
        .set({
          actionTaken: 'approved',
          actionTakenAt: new Date(),
          actionTakenBy: userId,
          approvedAt: new Date(),
          approvalDecisionSnapshot: approvalSnapshot,
          approvalHash,
          wasApprovedBefore: true,
        })
        .where(and(eq(skillAnalyzerResults.id, resultId), eq(skillAnalyzerResults.jobId, jobId)));
      return;
    }
  }

  // reject / skip / unapprove (null) path. For 'approved' on non-PARTIAL_OVERLAP
  // classifications (DISTINCT, DUPLICATE) we simply update actionTaken without
  // the approval gate — those don't have merge warnings to resolve.
  await db
    .update(skillAnalyzerResults)
    .set({
      actionTaken: action,
      actionTakenAt: action === null ? null : new Date(),
      actionTakenBy: action === null ? null : userId,
      // Unapprove clears approved_at so edits are permitted again.
      // was_approved_before stays true (§11.12.2 UX signal).
      approvedAt: action === 'approved' ? new Date() : null,
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

  // Delegate to the per-row setResultAction so approval snapshot + drift hash
  // + was_approved_before get written consistently for every row.
  if (action === 'approved') {
    for (const resultId of resultIds) {
      await setResultAction({ resultId, jobId, organisationId, userId, action });
    }
    return;
  }

  // reject / skip: bulk update without approval snapshot logic.
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

// ---------------------------------------------------------------------------
// Proposed new agents — v2 Fix 5 (confirm/reject)
// ---------------------------------------------------------------------------

export async function updateProposedAgent(params: {
  jobId: string;
  organisationId: string;
  proposedAgentIndex: number;
  action: 'confirm' | 'reject';
}): Promise<void> {
  const { jobId, organisationId, proposedAgentIndex, action } = params;

  const jobRows = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw { statusCode: 404, message: 'Job not found' };

  const current = Array.isArray(job.proposedNewAgents) ? (job.proposedNewAgents as Array<Record<string, unknown>>) : [];
  if (current.length === 0 || !current[proposedAgentIndex]) {
    throw { statusCode: 404, message: `Proposed agent index ${proposedAgentIndex} not found` };
  }

  const next = current.map((entry, i) => {
    if (i !== proposedAgentIndex) return entry;
    if (action === 'confirm') {
      return { ...entry, status: 'confirmed', confirmedAt: new Date().toISOString() };
    }
    return { ...entry, status: 'rejected', rejectedAt: new Date().toISOString() };
  });

  await db
    .update(skillAnalyzerJobs)
    .set({ proposedNewAgents: next })
    .where(eq(skillAnalyzerJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Warning resolution — v2 §11.2
// ---------------------------------------------------------------------------

export interface ResolveWarningParams {
  resultId: string;
  jobId: string;
  organisationId: string;
  userId: string;
  /** Required header; missing → 400, mismatch → 409. See §11.11.5. */
  ifUnmodifiedSince: string;
  warningCode: MergeWarningCode;
  resolution: WarningResolutionKind;
  details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string };
}

/** Append (or upsert-by-composite-key) a reviewer decision on a warning.
 *  Dedup key: (warningCode, details.field ?? null). Newer entry replaces
 *  the prior one for the same key.
 *
 *  Enforces: result is not locked (approvedAt null); If-Unmodified-Since
 *  matches the row's mergeUpdatedAt exactly (or is newer — we reject if the
 *  row was modified after the client's snapshot). */
export async function resolveWarning(params: ResolveWarningParams): Promise<void> {
  const { resultId, jobId, organisationId, userId, ifUnmodifiedSince, warningCode, resolution, details } = params;

  if (!ifUnmodifiedSince || typeof ifUnmodifiedSince !== 'string') {
    throw { statusCode: 400, message: 'If-Unmodified-Since is required for resolve-warning.' };
  }
  const clientStamp = new Date(ifUnmodifiedSince);
  if (Number.isNaN(clientStamp.getTime())) {
    throw { statusCode: 400, message: 'If-Unmodified-Since must be a valid ISO timestamp.' };
  }

  await db.transaction(async (tx) => {
    // Row-lock read to avoid concurrent resolve-warning overwrites.
    const rows = await tx
      .select()
      .from(skillAnalyzerResults)
      .where(and(
        eq(skillAnalyzerResults.id, resultId),
        eq(skillAnalyzerResults.jobId, jobId),
      ))
      .for('update')
      .limit(1);

    const row = rows[0];
    if (!row) throw { statusCode: 404, message: 'Result not found' };

    // Org ownership check via job.
    const jobRows = await tx
      .select({ id: skillAnalyzerJobs.id })
      .from(skillAnalyzerJobs)
      .where(and(eq(skillAnalyzerJobs.id, jobId), eq(skillAnalyzerJobs.organisationId, organisationId)))
      .limit(1);
    if (!jobRows[0]) throw { statusCode: 404, message: 'Job not found' };

    if (row.approvedAt) {
      throw {
        statusCode: 409,
        message: 'Result is locked — unapprove before resolving warnings.',
        errorCode: 'RESULT_LOCKED',
      };
    }

    const concurrencyResult = checkConcurrencyStamp(
      row.mergeUpdatedAt,
      row.createdAt,
      clientStamp,
    );
    if (concurrencyResult === 'missing') {
      throw {
        statusCode: 500,
        message: 'Result has no createdAt timestamp — cannot verify concurrency.',
      };
    }
    if (concurrencyResult === 'stale') {
      throw {
        statusCode: 409,
        message: 'Result was modified since you opened it, or the If-Unmodified-Since token does not match. Reload and retry.',
        errorCode: 'STALE_RESOLVE',
      };
    }

    const existing = Array.isArray(row.warningResolutions)
      ? (row.warningResolutions as WarningResolution[])
      : [];

    // Dedup by composite (warningCode, details.field ?? null). Newer wins.
    const fieldKey = details?.field ?? null;
    const filtered = existing.filter(r => {
      const rField = r.details?.field ?? null;
      return !(r.warningCode === warningCode && rField === fieldKey);
    });

    const entry: WarningResolution = {
      warningCode,
      resolution,
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId,
    };
    if (details && (details.field || details.disambiguationNote || details.collidingSkillId)) {
      entry.details = details;
    }
    filtered.push(entry);

    // Fix 7 cascade: NAME_MISMATCH resolutions cascade the chosen name into
    // proposedMergedContent and set execution_resolved_name atomically so
    // the merge preview matches what Execute will write.
    const updates: Record<string, unknown> = {
      warningResolutions: filtered,
      mergeUpdatedAt: new Date(),
    };
    if (warningCode === 'NAME_MISMATCH' && row.proposedMergedContent) {
      const merged = row.proposedMergedContent as { name: string; definition: object | null; description: string; instructions: string | null };
      const defName = (merged.definition as Record<string, unknown> | null | undefined)?.name;
      let chosen: string | null = null;
      if (resolution === 'use_library_name') {
        // Dominant source is the library by construction; use schema name if
        // present, else top-level name.
        chosen = typeof defName === 'string' && defName.trim().length > 0
          ? defName
          : (merged.name ?? '').trim() || null;
      } else if (resolution === 'use_incoming_name') {
        chosen = (merged.name ?? '').trim() || (typeof defName === 'string' ? defName : null);
      }
      if (chosen) {
        const newDefinition = {
          ...(merged.definition as Record<string, unknown> | null ?? {}),
          name: chosen,
        };
        updates.proposedMergedContent = { ...merged, name: chosen, definition: newDefinition };
        updates.executionResolvedName = chosen;
      }
    }

    await tx
      .update(skillAnalyzerResults)
      .set(updates)
      .where(eq(skillAnalyzerResults.id, resultId));
  });
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
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
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

  // v2 §11.11.2: a result locked by approval may not be edited. The reviewer
  // must first unapprove (PATCH action=null).
  if (row.approvedAt) {
    throw {
      statusCode: 409,
      message: 'Result is locked — unapprove before editing the merge.',
      errorCode: 'RESULT_LOCKED',
    };
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

  // v2 §11.11.1: any merge edit wipes warning_resolutions + approval state so
  // stale decisions can't satisfy a new merge's warnings.
  const hadResolutions = Array.isArray(row.warningResolutions) && (row.warningResolutions as unknown[]).length > 0;
  await db
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: next,
      userEditedMerge: true,
      mergeUpdatedAt: new Date(),
      warningResolutions: [],
      executionResolvedName: null,
      approvedAt: null,
      approvalDecisionSnapshot: null,
      approvalHash: null,
      actionTaken: row.actionTaken === 'approved' ? null : row.actionTaken,
      actionTakenAt: row.actionTaken === 'approved' ? null : row.actionTakenAt,
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
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
    }
  }
  if (hadResolutions) enriched.resolutionsCleared = true;
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

  // v2 §11.11.2: locked result can't be reset without first unapproving.
  if (row.approvedAt) {
    throw {
      statusCode: 409,
      message: 'Result is locked — unapprove before resetting the merge.',
      errorCode: 'RESULT_LOCKED',
    };
  }

  if (!row.originalProposedMerge) {
    throw { statusCode: 409, message: 'no original merge proposal to reset from' };
  }

  // v2 §11.11.1: reset wipes resolutions + approval state identically to
  // PATCH /merge to keep invariants consistent.
  await db
    .update(skillAnalyzerResults)
    .set({
      proposedMergedContent: row.originalProposedMerge,
      userEditedMerge: false,
      mergeUpdatedAt: new Date(),
      warningResolutions: [],
      executionResolvedName: null,
      approvedAt: null,
      approvalDecisionSnapshot: null,
      approvalHash: null,
      actionTaken: row.actionTaken === 'approved' ? null : row.actionTaken,
      actionTakenAt: row.actionTaken === 'approved' ? null : row.actionTakenAt,
    })
    .where(eq(skillAnalyzerResults.id, resultId));

  const hadResolutions = Array.isArray(row.warningResolutions) && (row.warningResolutions as unknown[]).length > 0;

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
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        // Library skill deleted — leave matchedSkillContent omitted.
      } else {
        logger.error('[skillAnalyzer] Unexpected error fetching matched skill', {
          matchedSkillId: updated.matchedSkillId,
          error: String(err),
        });
        throw err;
      }
    }
  }
  if (hadResolutions) enriched.resolutionsCleared = true;
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

/** Backfill agentProposals onto a result row that was written incrementally
 *  in Stage 5 (before Stage 7 computed proposals). Used in Stage 8 to
 *  patch classified-DISTINCT rows. No-op when proposals is empty. */
export async function updateResultAgentProposals(
  jobId: string,
  candidateIndex: number,
  agentProposals: unknown[],
): Promise<void> {
  if (agentProposals.length === 0) return;
  await db
    .update(skillAnalyzerResults)
    .set({ agentProposals })
    .where(
      and(
        eq(skillAnalyzerResults.jobId, jobId),
        eq(skillAnalyzerResults.candidateIndex, candidateIndex),
      ),
    );
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

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

/** Append SKILL_GRAPH_COLLISION warnings produced by the cross-batch collision
 *  pass (Stage 5b) to already-written result rows. Uses JSONB concatenation so
 *  the existing library-level warnings (from Stage 5) are preserved. */
export async function appendBatchCollisionWarnings(
  jobId: string,
  warningsBySlug: Map<string, MergeWarning[]>,
): Promise<void> {
  if (warningsBySlug.size === 0) return;

  for (const [candidateSlug, newWarnings] of warningsBySlug.entries()) {
    if (newWarnings.length === 0) continue;
    const newWarningsJson = JSON.stringify(newWarnings);
    await db
      .update(skillAnalyzerResults)
      .set({
        mergeWarnings: sql`
          CASE
            WHEN ${skillAnalyzerResults.mergeWarnings} IS NULL
            THEN ${newWarningsJson}::jsonb
            ELSE ${skillAnalyzerResults.mergeWarnings} || ${newWarningsJson}::jsonb
          END
        `,
      })
      .where(
        and(
          eq(skillAnalyzerResults.jobId, jobId),
          eq(skillAnalyzerResults.candidateSlug, candidateSlug),
        ),
      );
  }
}

/** v6 Fix 4 follow-up (Codex iter-2 review) — atomic deduction + warning append
 *  for the SOURCE_FORK case (extensible to CONTENT_OVERLAP / future batch
 *  signals). The per-candidate `adjustClassifierConfidence` runs before
 *  Stage 5c, so batch-level warnings never influence the originally-persisted
 *  confidence; this helper closes that gap by deducting and marking in one
 *  statement.
 *
 *  Idempotency across crash-resume: Stage 5c re-runs on every resume. One
 *  atomic UPDATE per slug sets `confidence` AND appends the marker warning
 *  to `mergeWarnings`. The WHERE clause rejects rows that already carry the
 *  marker, so re-runs over already-processed rows are no-ops. Because the
 *  two column writes commit together, a worker crash between them is
 *  impossible — the earlier non-atomic pair (separate deduct + append calls)
 *  left a narrow window where the deduction committed without the marker,
 *  causing a second deduction on resume. */
export async function applyBatchDeductionAndWarningAtomic(
  jobId: string,
  slugEntries: Array<{ slug: string; deduction: number; warning: MergeWarning }>,
  markerWarningCode: string,
): Promise<void> {
  if (slugEntries.length === 0) return;
  for (const { slug, deduction, warning } of slugEntries) {
    if (deduction <= 0) continue;
    const warningJson = JSON.stringify([warning]);
    await db
      .update(skillAnalyzerResults)
      .set({
        confidence: sql`GREATEST(0.20, COALESCE(${skillAnalyzerResults.confidence}, 0.5) - ${deduction})`,
        mergeWarnings: sql`
          CASE
            WHEN ${skillAnalyzerResults.mergeWarnings} IS NULL
            THEN ${warningJson}::jsonb
            ELSE ${skillAnalyzerResults.mergeWarnings} || ${warningJson}::jsonb
          END
        `,
      })
      .where(
        and(
          eq(skillAnalyzerResults.jobId, jobId),
          eq(skillAnalyzerResults.candidateSlug, slug),
          // Same marker-based idempotency guard — row must not already
          // carry the marker warning. Combined with the atomic UPDATE,
          // this eliminates the crash-between-two-statements window.
          sql`NOT COALESCE(${skillAnalyzerResults.mergeWarnings} @> ${JSON.stringify([{ code: markerWarningCode }])}::jsonb, false)`,
        ),
      );
  }
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
