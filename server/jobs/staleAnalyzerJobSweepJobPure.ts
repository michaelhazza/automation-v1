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
// pipeline writes: parsing, hashing, embedding, matching, classifying.
// `pending` is excluded — a row that hasn't been picked up yet doesn't
// have a worker to die.
// ---------------------------------------------------------------------------

/** Threshold (ms) of `updated_at` silence after which a mid-flight job is
 *  considered stuck. See file header for derivation. */
export const STALE_ANALYZER_JOB_THRESHOLD_MS = 15 * 60_000;

/** Mid-flight statuses that the sweep can act on. Sourced from the
 *  skillAnalyzerJobs.status enum values that the pipeline writes. */
export const STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES = [
  'parsing',
  'hashing',
  'embedding',
  'matching',
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
