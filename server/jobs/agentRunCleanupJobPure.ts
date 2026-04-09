/**
 * agentRunCleanupJobPure — Sprint 3 P2.1 Sprint 3A pure helpers.
 *
 * The impure sweep lives in `agentRunCleanupJob.ts`. This module holds
 * the decisions that don't touch the database so they can be unit tested
 * in the pure harness:
 *
 *   - `resolveRetentionDays(orgRetentionDays, defaultDays)` — picks the
 *     effective retention window for an organisation. `null` on the org
 *     column means "use the default". Values <= 0 are ignored and fall
 *     back to the default (zero / negative retention would purge
 *     everything, which is never what an operator meant — if they want
 *     to disable the sweep for an org, leave the column NULL).
 *
 *   - `computeCutoffDate(now, retentionDays)` — converts a retention
 *     window in days to an absolute timestamp. Rows with `created_at`
 *     strictly older than the returned Date are eligible for deletion.
 *
 * Both functions are total and deterministic — same inputs, same
 * outputs. Neither touches the clock directly; the caller supplies
 * `now` so tests can pin the reference time.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.1 (retention policy).
 */

/**
 * Resolve the effective retention window for an organisation. Returns
 * the per-org override when it is a positive integer, otherwise falls
 * back to the supplied default.
 *
 * Negative or zero overrides are treated as "no override" rather than
 * "delete everything" — that shape is almost always a data-entry bug
 * and the safe answer is to fall through to the default.
 */
export function resolveRetentionDays(
  orgRetentionDays: number | null | undefined,
  defaultDays: number,
): number {
  if (
    orgRetentionDays === null ||
    orgRetentionDays === undefined ||
    !Number.isFinite(orgRetentionDays) ||
    orgRetentionDays <= 0
  ) {
    return defaultDays;
  }
  return Math.floor(orgRetentionDays);
}

/**
 * Compute the cutoff Date: rows with `created_at < cutoff` are eligible
 * for deletion. `retentionDays` is interpreted as the minimum age (in
 * days) a run must reach before it can be pruned.
 *
 * Uses a millisecond offset rather than `setDate` so DST transitions do
 * not shift the cutoff by an hour.
 */
export function computeCutoffDate(now: Date, retentionDays: number): Date {
  const ms = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}
