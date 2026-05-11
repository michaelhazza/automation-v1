/**
 * sandboxHarvestReconciliationPure.ts — Pure helpers for the harvest reconciliation job.
 *
 * Spec B §8.4 (reconciliation path), §22.
 *
 * No imports — pure functions only, no DB, no network, no side effects.
 * Consumed by sandboxHarvestReconciliationJob.ts.
 */

/** Minimal row shape the eligibility check needs — a subset of sandbox_executions columns. */
export interface ReconciliationEligibilityRow {
  status: string;
  /** Timestamp string (ISO 8601) or Date — when the sandbox started. */
  startedAt: Date | string | null;
  /** The wall-clock ceiling in milliseconds from the task policy snapshot. */
  wallClockMs: number;
}

/**
 * Buffer added on top of the wall-clock ceiling before declaring a non-terminal
 * execution eligible for reconciliation. Gives the monitor job time to fire first
 * and avoids racing the normal terminal path.
 *
 * Default: 60 seconds.
 */
export const RECONCILIATION_BUFFER_MS = 60_000;

/**
 * States that are considered stuck (non-terminal but should have completed).
 * Spec §8.4: reconciliation targets `pending`, `running`, and `harvesting`.
 * The reconciliation job re-enqueues harvest for executions in these states
 * that have passed their deadline.
 */
const STUCK_STATES = new Set(['pending', 'running', 'harvesting']);

/**
 * Decide whether a sandbox_executions row is eligible for harvest reconciliation.
 *
 * A row is eligible when:
 *   - It is in a non-terminal (stuck) state.
 *   - Its `startedAt` timestamp exists (it was actually started).
 *   - The wall-clock deadline + buffer has elapsed since `startedAt`.
 *
 * @param row  Subset of the sandbox_executions row.
 * @param now  Current wall-clock time; injectable for deterministic testing.
 */
export function isExecutionEligibleForReconciliation(
  row: ReconciliationEligibilityRow,
  now: Date,
): boolean {
  if (!STUCK_STATES.has(row.status)) return false;
  if (row.startedAt === null) return false;

  const startedAtMs =
    row.startedAt instanceof Date
      ? row.startedAt.getTime()
      : new Date(row.startedAt).getTime();

  if (Number.isNaN(startedAtMs)) return false;

  const deadlineMs = startedAtMs + row.wallClockMs + RECONCILIATION_BUFFER_MS;
  return now.getTime() >= deadlineMs;
}

/**
 * Determine the next reconciliation attempt number given a current attempt count.
 *
 * Returns `currentAttempt + 1`, clamped so callers cannot accidentally pass
 * a negative starting point.
 */
export function nextReconciliationAttempt(currentAttempt: number): number {
  return Math.max(0, currentAttempt) + 1;
}
