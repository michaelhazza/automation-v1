import { sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerResults } from '../../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Internal functions for job handler use. The job handler now opens an
// org-scoped transaction via createWorker (Chunk 13), so these writes
// flow through getOrgScopedDb to satisfy the RLS policy on
// skill_analyzer_results (migration 0359).
// ---------------------------------------------------------------------------

/** Batch insert results for a job. Splits into 100-row batches. */
export async function insertResults(
  rows: (typeof skillAnalyzerResults.$inferInsert)[]
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 100) {
    await getOrgScopedDb('skillAnalyzerService.insertResults').insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
  }
}

/** Insert a single result row for a job. */
export async function insertSingleResult(
  row: typeof skillAnalyzerResults.$inferInsert,
): Promise<void> {
  await getOrgScopedDb('skillAnalyzerService.insertSingleResult').insert(skillAnalyzerResults).values(row);
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
  const rawRows = await getOrgScopedDb('skillAnalyzerService.listResultIndicesForJob').execute(sql`
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
