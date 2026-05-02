// Pure helpers for task-scoped event sequence allocation.
// No DB / IO / socket access — every function here takes inputs and returns outputs.
// Spec: tasks/workflows-v1-spec.md §task-event-log.
//
// Tested in server/services/__tests__/agentExecutionEventTaskSequencePure.test.ts.

// ---------------------------------------------------------------------------
// Task sequence allocation
// ---------------------------------------------------------------------------

/**
 * Allocates the next task sequence from the current counter value.
 *
 * Convention: `tasks.next_event_seq` starts at 0. The first allocation
 * increments it to 1, and the allocated value IS the new counter value,
 * meaning `allocated === newNextSeq` always holds.
 *
 * The UPDATE logic in the service layer mirrors this:
 *   UPDATE tasks SET next_event_seq = next_event_seq + 1 WHERE id = $taskId
 *   RETURNING next_event_seq   -- returned value is the allocated sequence
 *
 * This pure helper is the reference implementation for that invariant.
 */
export function allocateTaskSequence(currentNextSeq: number): {
  allocated: number;
  newNextSeq: number;
} {
  const allocated = currentNextSeq + 1;
  return { allocated, newNextSeq: allocated };
}
