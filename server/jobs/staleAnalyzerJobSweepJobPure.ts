// ---------------------------------------------------------------------------
// Pure cutoff math for `maintenance:stale-analyzer-job-sweep`.
//
// A skill_analyzer_jobs row that sits in a mid-flight status with no
// `updated_at` progress for STALE_THRESHOLD_MS is reaped: marked failed and
// its pg-boss `active` lock expired, so pg-boss retry (retryLimit: 1,
// retryDelay: 300s) can pick it up and the v5 resume seeding completes the
// run.
//
// The 15-minute threshold is intentionally generous. Stage 7b's "Refining
// agent assignments with AI…" update fires once at the start (line ~1726
// in skillAnalyzerJob.ts) and the stage stays silent until completion.
// With concurrency=3 Haiku calls and a worst-case 60s per-call timeout, a
// 30-skill batch can legitimately spend ~10 minutes in that silent window.
// 15 minutes preserves margin without leaving truly-stuck jobs visible to
// the user for a punitive amount of time.
//
// Statuses considered "mid-flight" for sweep purposes match the set the job
// pipeline writes: parsing, hashing, embedding, comparing, classifying.
// `pending` is excluded — a row that hasn't been picked up yet doesn't
// have a worker to die. The `comparing` status covers Stage 4 (similarity
// computation, 40%→60%) — a substantial compute window where worker death
// must still be reaped. Earlier drafts of this file mistakenly listed
// `matching` (a name the pipeline never writes); see PR review log
// pr-review-log-skill-analyzer-resilience-2026-04-24T08-50-00Z.md (B1).
// ---------------------------------------------------------------------------

/** Threshold (ms) of `updated_at` silence after which a mid-flight job is
 *  considered stuck. See file header for derivation. */
export const STALE_ANALYZER_JOB_THRESHOLD_MS = 15 * 60_000;

/** Mid-flight statuses that the sweep can act on. MUST stay in sync with
 *  the `status` column enum in `server/db/schema/skillAnalyzerJobs.ts` and
 *  the `SkillAnalyzerJobStatus` type in `server/services/skillAnalyzerService.ts`.
 *  Drift here = silent failure to reap stuck jobs in the missing stage. */
export const STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES = [
  'parsing',
  'hashing',
  'embedding',
  'comparing',
  'classifying',
] as const;

export type StaleAnalyzerJobStatus =
  typeof STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES[number];

/** Compute the `updated_at` cutoff before which a mid-flight job counts as
 *  stuck. Pure for testability. */
export function computeStaleAnalyzerJobCutoff(params: {
  nowMs: number;
  thresholdMs?: number;
}): Date {
  const ttl = params.thresholdMs ?? STALE_ANALYZER_JOB_THRESHOLD_MS;
  return new Date(params.nowMs - ttl);
}
