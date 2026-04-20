// ---------------------------------------------------------------------------
// Pure helper for llmLedgerArchiveJob (spec §12.4).
//
// Extracted into its own file so it's testable without a DB. The only
// non-obvious detail: we use `setMonth` arithmetic, not a naive 30-day
// window, so the cutoff tracks calendar months (the thing the retention
// policy is expressed in) rather than approximate days.
// ---------------------------------------------------------------------------

/**
 * Cutoff for archive eligibility. Rows with created_at strictly before
 * the returned Date are moved to llm_requests_archive. `now` is an injected
 * clock for test determinism.
 */
export function computeArchiveCutoff(retentionMonths: number, now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  return cutoff;
}
