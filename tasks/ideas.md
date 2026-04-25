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

## [IDEA-2] Video post-production skill — prior art reference (video-use)
**Date:** 2026-04-25
**Area:** Skill system / video processing

**Problem / Opportunity:**
No current agency workflow produces a rendered video deliverable (final.mp4). If a client-deliverable video-editing capability ever lands on the roadmap, a reference architecture already exists in the open-source `browser-use/video-use` repo. Capturing the prior art now avoids rediscovery later; the patterns are worth borrowing even if the library itself is not vendored.

**Rough shape (optional):**
- Do not integrate video-use directly: execution-model mismatch (Python local-shell vs our TS multi-tenant worker), stack mismatch (ElevenLabs Scribe vs our Whisper), early-stage / unclear license, and product mismatch (Automation OS ingests video for analysis; it does not produce video today).
- Pattern worth borrowing — transcript-first reasoning: use word-level timestamps from Whisper (our existing transcription primitive) instead of frame-by-frame analysis — token-cheap.
- Pattern worth borrowing — on-demand visual context: generate filmstrip + waveform PNG composites only at LLM decision points, not upfront.
- Pattern worth borrowing — EDL output loop: LLM emits an edit decision list (EDL), FFmpeg renders, a self-eval loop runs with a max-iterations cap (video-use uses 3 re-render iterations).
- Pattern worth borrowing — persistent project memory: a `project.md` file maintains session continuity across long editing jobs.
- If we build this: implement as a TypeScript skill in the worker runtime, using Whisper for transcription, our existing skill/job runtime, and our storage layer. Do not vendor the Python repo.
- Reference: https://github.com/browser-use/video-use

**Status:** Captured
