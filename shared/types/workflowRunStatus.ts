// Canonical terminal-status set. Used in:
// - Drizzle partial-unique-index predicate (workflowRuns.ts)
// - resolveActiveRunForTask lookups (P3)
// Unit test asserts this set matches the index predicate exactly.
export const WORKFLOW_RUN_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'partial',
] as const);

export type WorkflowRunTerminalStatus = typeof WORKFLOW_RUN_TERMINAL_STATUSES extends Set<infer T> ? T : never;
