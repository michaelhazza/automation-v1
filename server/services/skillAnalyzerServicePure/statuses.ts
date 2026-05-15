// ---------------------------------------------------------------------------
// Job status — single source of truth
// ---------------------------------------------------------------------------
// Canonical definition of skill_analyzer_jobs.status values. MUST stay in
// sync with the `$type<>` union in server/db/schema/skillAnalyzerJobs.ts.
// Prior to centralisation this list was redeclared in three places
// (service type alias, schema `$type<>`, sweep module) which let the sweep
// silently diverge — the original `matching` typo missed an entire stage.
// See tasks/review-logs/chatgpt-pr-review-bugfixes-april26-*.md Round 1
// Finding 2.

/** Statuses the pipeline writes while actively working a job. A worker
 *  crash in any of these states leaves a row that the stale-job sweep
 *  must reap. Excludes `pending` (queued, no worker to die) and the
 *  terminals (`completed`, `failed`). */
export const SKILL_ANALYZER_MID_FLIGHT_STATUSES = [
  'parsing',
  'hashing',
  'embedding',
  'comparing',
  'classifying',
] as const;

/** Terminal statuses — no further work will occur. */
export const SKILL_ANALYZER_TERMINAL_STATUSES = ['completed', 'failed'] as const;

/** All valid values of `skill_analyzer_jobs.status`. */
export const SKILL_ANALYZER_JOB_STATUSES = [
  'pending',
  ...SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  ...SKILL_ANALYZER_TERMINAL_STATUSES,
] as const;

export type SkillAnalyzerMidFlightStatus =
  typeof SKILL_ANALYZER_MID_FLIGHT_STATUSES[number];
export type SkillAnalyzerTerminalStatus =
  typeof SKILL_ANALYZER_TERMINAL_STATUSES[number];
export type SkillAnalyzerJobStatus = typeof SKILL_ANALYZER_JOB_STATUSES[number];

export function isSkillAnalyzerTerminalStatus(
  status: string,
): status is SkillAnalyzerTerminalStatus {
  return (SKILL_ANALYZER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isSkillAnalyzerMidFlightStatus(
  status: string,
): status is SkillAnalyzerMidFlightStatus {
  return (SKILL_ANALYZER_MID_FLIGHT_STATUSES as readonly string[]).includes(status);
}
