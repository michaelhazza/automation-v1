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
// Statuses considered "mid-flight" for sweep purposes are imported from the
// canonical SKILL_ANALYZER_MID_FLIGHT_STATUSES constant in
// `server/services/skillAnalyzerServicePure.ts` so they can never drift
// from the service / schema definitions. Earlier drafts of this file
// duplicated the list inline and introduced a `matching` typo (a name the
// pipeline never writes) that missed an entire stage — see PR review log
// pr-review-log-skill-analyzer-resilience-2026-04-24T08-50-00Z.md (B1) and
// tasks/review-logs/chatgpt-pr-review-bugfixes-april26-*.md Round 1 Finding 2.
// ---------------------------------------------------------------------------

import {
  SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  type SkillAnalyzerMidFlightStatus,
} from '../services/skillAnalyzerServicePure.js';

/** Threshold (ms) of `updated_at` silence after which a mid-flight job is
 *  considered stuck. See file header for derivation. */
export const STALE_ANALYZER_JOB_THRESHOLD_MS = 15 * 60_000;

/** Mid-flight statuses that the sweep can act on. Re-exported from the
 *  canonical definition so the old import path keeps working but there is
 *  only one list in the codebase. */
export const STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES =
  SKILL_ANALYZER_MID_FLIGHT_STATUSES;

export type StaleAnalyzerJobStatus = SkillAnalyzerMidFlightStatus;

/** Compute the `updated_at` cutoff before which a mid-flight job counts as
 *  stuck. Pure for testability. */
export function computeStaleAnalyzerJobCutoff(params: {
  nowMs: number;
  thresholdMs?: number;
}): Date {
  const ttl = params.thresholdMs ?? STALE_ANALYZER_JOB_THRESHOLD_MS;
  return new Date(params.nowMs - ttl);
}
