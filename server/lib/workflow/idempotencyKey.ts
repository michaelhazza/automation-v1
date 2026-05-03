/**
 * idempotencyKey.ts — canonical idempotency key builder for external calls.
 *
 * Spec §3.6: every outbound HTTP / webhook / integration call MUST carry an
 * idempotency key derived from `(run_id, step_id, task_sequence)` so that
 * retried steps hit the same key and the receiver dedups correctly.
 *
 * Format: `${runId}:${stepId}:${taskSequence}`
 */

export function buildIdempotencyKey(
  runId: string,
  stepId: string,
  taskSequence: number
): string {
  return `${runId}:${stepId}:${taskSequence}`;
}
