/**
 * Pure decision-table logic for the baseline subscriber.
 * No imports — safe to test without env or DB.
 */

/**
 * Returns true when a baseline row with the given status should be enqueued
 * for capture given the readiness evaluation result.
 */
export function shouldEnqueueCapture(
  ready: boolean,
  row: { status: string } | null,
): boolean {
  if (!ready) return false;
  if (!row) return false;
  return row.status === 'pending' || row.status === 'ready';
}
