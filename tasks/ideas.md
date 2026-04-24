# Ideas Backlog

## [IDEA-1] DB-level UNIQUE constraint on `skill_analyzer_results (job_id, candidate_index)`
**Date:** 2026-04-21
**Area:** Skill analyzer / database schema

**Problem / Opportunity:**
PR #159 (skill-analyzer crash-resume) relies on application-level filtering to prevent double-inserts when a pg-boss worker crash-retries mid-pipeline. The deterministic ORDER BY makes that dedupe safe today, but the table carries no DB-level uniqueness guarantee. Any future code path that bypasses the filter can silently duplicate rows — the contract is best-effort rather than structural.

**Rough shape:**
- **Cleanup pass first.** Before the index, collapse any existing dupes in prod: `SELECT job_id, candidate_index, COUNT(*) FROM skill_analyzer_results GROUP BY 1,2 HAVING COUNT(*) > 1` — keep the row with the latest `created_at` (ties broken by highest `id`), delete the rest. Local dev DB is already clean (verified 2026-04-21).
- **Migration** (`0191_skill_analyzer_results_unique_idx.sql`): `CREATE UNIQUE INDEX skill_analyzer_results_job_candidate_uniq ON skill_analyzer_results (job_id, candidate_index);` — no partial index needed; `classification` is NOT NULL so a `WHERE classification IS NOT NULL` clause would be a no-op.
- **Service callers.** Update `insertSingleResult` and `insertResults` in `server/services/skillAnalyzerService.ts` to use `.onConflictDoNothing({ target: [skillAnalyzerResults.jobId, skillAnalyzerResults.candidateIndex] })`. The existing application-level dedupe in Stage 8 of `skillAnalyzerJob.ts` and `listResultIndicesForJob` become defence-in-depth rather than the primary guarantee.
- **Test.** Add `server/services/__tests__/skillAnalyzerServiceIdempotency.test.ts` — call `insertSingleResult` twice with the same `(jobId, candidateIndex)`, assert exactly one row remains.
- Estimated effort: 1-2 hours. Low risk, high future-proofing.

**Reference:** External-reviewer feedback on PR #159, items #3 (idempotency gap at DB level) and #5 (ON CONFLICT DO NOTHING suggestion). Kept separate from PR #159 because the cleanup step carries prod-data risk and deserves its own review.

**Status:** Captured
