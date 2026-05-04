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

## [IDEA-2] Spec-authoring checklist: verify cited deferred items are still open before spec lock
**Date:** 2026-04-26
**Area:** Spec authoring workflow / process tooling

**Problem / Opportunity:**
When a sprint spec cites items from a deferred-items list (e.g. `tasks/todo.md`) as inputs to scope, those items may have already been resolved by a migration or prior PR by the time spec authoring begins. The current workflow catches this only at draft time via the global stop condition (item ID cannot be reconciled), not at spec-input lock time — meaning the author may already have written scope against stale inputs. Surfaced 2026-04-26 during Chunk 1 of the pre-launch hardening spec sprint: ~12 of 14 cited items had been closed by migration 0227 before authoring started.

**Rough shape:**
- Extend `docs/spec-authoring-checklist.md` with a "Section 0 — Verify cited deferred items are still open" step.
- Step runs before the author commits to scope: grep each cited item ID in `tasks/todo.md`, then cross-check against `git log` to confirm no migration or PR closed it after the backlog snapshot used for citation.
- If any cited item is already closed, the author must reconcile scope before proceeding — not after draft is written.
- Optionally: a small shell helper (`scripts/verify-deferred-items.sh`) that accepts a list of item IDs and outputs open/closed status with the closing commit reference.
- Estimated effort: low (checklist prose update) to medium (if shell helper is built). No code changes required for the checklist-only version.

**Branch context at capture:** `spec/pre-launch-hardening` (Chunk 1 RLS spec). Out of scope for that branch — captured for separate consideration.

**Status:** Captured
