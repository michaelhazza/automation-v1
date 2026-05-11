/**
 * sandboxRetentionPure.ts — Pure cutoff-date helpers for sandbox retention jobs.
 *
 * Spec B §17.3, §22.1.
 *
 * No imports — pure functions only, no DB, no network, no side effects.
 * Consumed by sandboxTelemetryPruneJob.ts, sandboxLogsPruneJob.ts,
 * and sandboxEgressAuditPruneJob.ts.
 */

/**
 * Compute the retention cutoff date: the point in time before which rows
 * should be physically deleted.
 *
 * @param now           Current wall-clock time; injectable for deterministic testing.
 * @param retentionDays Number of days to retain rows (e.g. 90 or 180).
 * @returns             Date object representing the oldest row to keep (exclusive boundary).
 *                      Rows with a timestamp strictly before this value are eligible for deletion.
 */
export function computeRetentionCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff;
}
