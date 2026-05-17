import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs, skillAnalyzerResults } from '../../../db/schema/index.js';
import type { MergeWarning, WarningResolution } from '../../skillAnalyzerServicePure.js';
import { checkConcurrencyStamp } from '../../skillAnalyzerServicePure.js';
import type { ResolveWarningParams } from '../types.js';

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

  const orgTx = getOrgScopedDb('skillAnalyzerService.resolveWarning');

  // Row-lock read to avoid concurrent resolve-warning overwrites.
  const rows = await orgTx
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
  const jobRows = await orgTx
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

  await orgTx
    .update(skillAnalyzerResults)
    .set(updates)
    .where(eq(skillAnalyzerResults.id, resultId));
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
    await getOrgScopedDb('skillAnalyzerService.appendBatchCollisionWarnings')
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
    await getOrgScopedDb('skillAnalyzerService.applyBatchDeductionAndWarningAtomic')
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

