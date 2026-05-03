// Pure helper for per-task event sequence allocation.
// No DB / IO — takes inputs, returns outputs.
// Tested in server/services/__tests__/agentExecutionEventTaskSequencePure.test.ts.
//
// Spec: Workflows V1 Chunk 3.

/**
 * Returns the next sequence value and the new counter value.
 * The caller stores newNextSeq back to tasks.next_event_seq.
 *
 * Sequences are 1-indexed, mirroring the agent_runs.next_event_seq pattern.
 */
export function allocateTaskSequence(currentNextSeq: number): {
  allocated: number;
  newNextSeq: number;
} {
  const allocated = currentNextSeq + 1;
  return { allocated, newNextSeq: allocated };
}
