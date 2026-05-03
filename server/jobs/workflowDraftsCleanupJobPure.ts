// ---------------------------------------------------------------------------
// Pure helpers for `maintenance:workflow-drafts-cleanup`.
//
// Extracted so the SQL cutoff arithmetic can be tested without a DB
// connection. Mirrors the pattern in llmInflightHistoryCleanupJobPure.ts.
// ---------------------------------------------------------------------------

/** Compute the cutoff Date below which unconsumed drafts should be deleted. */
export function computeWorkflowDraftsCutoff(params: {
  nowMs: number;
  thresholdDays: number;
}): Date {
  const ttlMs = params.thresholdDays * 24 * 60 * 60 * 1000;
  return new Date(params.nowMs - ttlMs);
}
