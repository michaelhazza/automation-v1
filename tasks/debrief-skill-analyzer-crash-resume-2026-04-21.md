# Debrief — Skill-Analyzer Crash-Resume & Dev-Restart Hardening

**Date:** 2026-04-21
**Branch:** `bugfixes-april26`
**PR:** [#159](https://github.com/michaelhazza/automation-v1/pull/159)
**Commits on PR (in order):**
- `2f13c10` — initial fix: crash-resume + EADDRINUSE retry + timeout alignment
- `5f450cf` — LLM P&L admin_role grants *(from a parallel session, unrelated to skill-analyzer work — see "PR scope" below)*
- `042cc9b` — follow-up 1: deterministic dedupe + contract comment + drop `!` assertion
- `5de987b` — follow-up 2: distinguish empty `parsedCandidates` from corrupt row

---

## Starting symptom

Skill-analyser UI stalled at 60% mid-import. Anthropic dashboard showed two simultaneous 499 "Client disconnected" events at 08:57:32 GMT+10 with different latencies (15.8s and 83.5s), meaning both in-flight requests died at the same instant.

## Root cause

Not the timeout (the 180s cap hadn't been reached), not a logic bug in the classifier. **The Node dev-server process was being killed abruptly on Windows `node --watch` restarts.** Evidence:

- `/tmp/dev-server.log` contained **248 restart events** in ~19 hours.
- **Zero** `[SHUTDOWN]` log lines across all 248 restarts → the existing graceful-shutdown handler in [server/index.ts](../server/index.ts#L515) never fires on Windows `--watch` (which doesn't send SIGTERM/SIGINT — it just kills the process).
- Each abrupt kill left port 3000 in Windows TIME_WAIT for 2–3 minutes. The freshly-spawned `--watch` child then crashed on `EADDRINUSE` and looped until the kernel released the port.
- Every in-flight HTTP request (including LLM calls to Anthropic) was dropped mid-flight by the kill.
- pg-boss retry would then re-run the handler, and the existing `clearResultsForJob(jobId)` call at Stage 1 wiped `skill_analyzer_results` — so every skill already classified in the dying run got re-classified, doubling LLM spend on every restart.

The "simultaneous 499s with different start times" signature was the smoking gun — one event (process kill) killing two in-flight calls that had started independently.

## What shipped

Three changes, all gated on the same user-reported problem:

### 1. Timeout alignment ([server/config/limits.ts](../server/config/limits.ts#L389))
`SKILL_CLASSIFY_TIMEOUT_MS` 180s → 600s to match `PROVIDER_CALL_TIMEOUT_MS`. The prior 3-min cap was aborting slow-but-healthy classifications under peak API load, surfacing as unexplained 499s. 10 min is a genuine safety net, not a normal-operation ceiling.

### 2. EADDRINUSE retry ([server/index.ts](../server/index.ts#L505-L540))
30 × 2s retry loop on `httpServer.listen()` in non-prod. Explicit `process.exit(1)` on exhaustion (not `throw err` from the EventEmitter — safer contract). Dev-restart time drops from 3 min to ~seconds once TIME_WAIT clears.

### 3. Crash-resume in skill-analyzer ([server/jobs/skillAnalyzerJob.ts](../server/jobs/skillAnalyzerJob.ts), [server/services/skillAnalyzerService.ts](../server/services/skillAnalyzerService.ts))
- Removed the unconditional `clearResultsForJob(jobId)` at Stage 1.
- Stage 1 prefers `job.parsedCandidates` over re-parsing github/download sources → stable `candidateIndex` across retries.
- New `listResultIndicesForJob(jobId)` with `ORDER BY candidate_index, created_at DESC, id DESC` for deterministic latest-wins dedupe.
- Stage 5 filters `llmQueue` → `resumedLlmQueue` to skip slugs already paid for. `classifiedResults` seeded from DB so Stages 7/7b/8 still find DISTINCT-classified candidates for agent-propose/Haiku enrichment.
- Stage 8 filters `resultRows` against the same `completedCandidateIndices` set so Stage 2 exactDuplicate / Stage 4 distinct rows don't silently duplicate.
- Deleted unused `clearResultsForJob`.

## Review loops

- **Internal pr-reviewer** (round 1): flagged 2 blockers (non-deterministic dedupe, dead `=== undefined` guard) + 3 strong recommendations. All addressed in `2f13c10`. Log: [`tasks/pr-review-log-skill-analyzer-crash-resume-20260421T092100Z.md`](pr-review-log-skill-analyzer-crash-resume-20260421T092100Z.md).
- **External reviewer** (round 2, after push): re-flagged the dedupe as still non-deterministic (fair — my first fix walked results in undefined DB order), re-flagged the `!` assertion, asked for a resume-reconstruction contract comment, and recommended a DB-level UNIQUE constraint. First three addressed in `042cc9b`; fourth filed to triage ([`tasks/ideas.md`](ideas.md), IDEA-1) because it needs its own migration with a prod-data cleanup step.
- **External reviewer** (round 3, after `042cc9b`): declared the PR "production-grade" and flagged one real regression: my follow-up-1 paste/upload diagnostic incorrectly treated `parsedCandidates = []` (valid empty parse) as DB corruption. Split the check on `Array.isArray()` so empty arrays fall through to the normal "no valid skill definitions" UX path and only non-array values trip the corruption diagnostic. Addressed in `5de987b`. The round-3 reviewer also flagged a "double insert still present" (`insertResults(resultRows)` alongside `insertResults(resultRowsToWrite)`) — **verified not present**; there is a single call at [server/jobs/skillAnalyzerJob.ts:1369](../server/jobs/skillAnalyzerJob.ts#L1369). Likely a stale read of the diff. No action needed.

## Open follow-ups

- **IDEA-1 in `tasks/ideas.md`** — DB-level `UNIQUE(job_id, candidate_index)` + `onConflictDoNothing` in insert path. Converts best-effort application dedupe into a hard DB guarantee. Needs a cleanup migration for any prod rows left over from the pre-PR `clearResultsForJob` era. ~1-2hr work.
- **Test coverage gap** — pr-reviewer rec #5: no unit test for the mixed-classification resume scenario (index 0 = exact-dup, index 1 = distinct, index 2 = DISTINCT-classified, index 3 = PARTIAL_OVERLAP, crash between Stage 5 and Stage 8, retry asserts no re-classification, no duplicate Stage 8 writes, single `updateResultAgentProposals` call). Should live at `server/services/__tests__/skillAnalyzerJobResumePure.test.ts`.
- **Stage 7b Haiku enrichment** still re-runs on retry. Cheap (256-token Haiku calls) and low-frequency, so deliberately deferred. Worth revisiting only if the waste becomes visible in the P&L.
- **Root cause of the 248 restarts** — unclear what's triggering them. Files under `server/`/`shared/` seem to trigger `--watch` more often than file changes alone explain. Not in scope for this fix (graceful restart makes each one cheap), but worth a separate investigation if the cadence is annoying.

## PR scope notes

PR #159 ended up carrying one commit from a **parallel session** (`5f450cf`, LLM P&L admin_role grants) that landed on the same branch while this work was in flight. The two concerns are unrelated but both fixes are needed, and neither blocks the other. Reviewer should expect to see both in the diff. Future branches should be narrower to avoid this co-mingling.

## Key learnings worth keeping

1. **Windows `node --watch` doesn't deliver SIGTERM on restart.** Any graceful-shutdown handler you write for dev-time purposes is dead code. Prove it with a log count before relying on it. (Added to `KNOWLEDGE.md` candidate list.)
2. **Simultaneous provider disconnections with different latencies = one local event.** Don't look for patterns in the provider's behaviour — look for a single kill on your side.
3. **"Idempotent retry" that wipes state is not idempotent.** The `clearResultsForJob(jobId)` call was labelled "idempotent: clear any prior results (support for retries)" but was actively harmful — it reset the resume state on every retry. Idempotency means "same effect regardless of how many times it runs," not "wipes state to start fresh."
4. **Dedupe in application code is never safe without ORDER BY.** Postgres row return order is not stable across vacuum boundaries; "first row wins" gives non-deterministic replay. Either add a DB unique constraint, or order the query.
5. **Timeout alignment is a real concern.** When two layers have different caps for the same operation, the tighter cap surfaces as "mysterious provider errors" when it fires before the outer layer expects. Align or document explicitly.
