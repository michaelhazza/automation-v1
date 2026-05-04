// ---------------------------------------------------------------------------
// Agent run status — canonical enumeration
// ---------------------------------------------------------------------------
//
// Single source of truth for agent run status values so the database schema,
// server services, and client UI stay in lock-step. Add a new status here
// first, then extend the schema/type in `server/db/schema/agentRuns.ts` and
// any UI rendering that cares about the new state.
//
// Buckets:
//   - IN_FLIGHT: the run is either queued or actively executing.
//   - AWAITING:  the run has paused, expecting external input.
//   - TERMINAL:  the run will not transition again without manual intervention.
// ---------------------------------------------------------------------------

export const AGENT_RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  // IEE Phase 0 (docs/iee-delegation-lifecycle-spec.md): parent run has
  // been handed off to a delegated execution backend (IEE worker today,
  // OpenClaw in future). Non-terminal. Detail lives on the backend row.
  DELEGATED: 'delegated',
  // User-requested cancel has been observed; the run loop / IEE worker
  // will exit at the next safe checkpoint and finalise as 'cancelled'.
  // Non-terminal — exists only briefly.
  CANCELLING: 'cancelling',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
  LOOP_DETECTED: 'loop_detected',
  COMPUTE_BUDGET_EXCEEDED: 'budget_exceeded',
  AWAITING_CLARIFICATION: 'awaiting_clarification',
  WAITING_ON_CLARIFICATION: 'waiting_on_clarification',
  COMPLETED_WITH_UNCERTAINTY: 'completed_with_uncertainty',
} as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUS)[keyof typeof AGENT_RUN_STATUS];

export const IN_FLIGHT_RUN_STATUSES: readonly AgentRunStatus[] = [
  AGENT_RUN_STATUS.PENDING,
  AGENT_RUN_STATUS.RUNNING,
  AGENT_RUN_STATUS.DELEGATED,
  AGENT_RUN_STATUS.CANCELLING,
];

export const AWAITING_RUN_STATUSES: readonly AgentRunStatus[] = [
  AGENT_RUN_STATUS.AWAITING_CLARIFICATION,
  AGENT_RUN_STATUS.WAITING_ON_CLARIFICATION,
];

export const TERMINAL_RUN_STATUSES: readonly AgentRunStatus[] = [
  AGENT_RUN_STATUS.COMPLETED,
  AGENT_RUN_STATUS.FAILED,
  AGENT_RUN_STATUS.TIMEOUT,
  AGENT_RUN_STATUS.CANCELLED,
  AGENT_RUN_STATUS.LOOP_DETECTED,
  AGENT_RUN_STATUS.COMPUTE_BUDGET_EXCEEDED,
  AGENT_RUN_STATUS.COMPLETED_WITH_UNCERTAINTY,
];

/** Set-backed lookup for hot-path checks. */
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_SET.has(status);
}

export function isInFlightRunStatus(status: string): boolean {
  return (IN_FLIGHT_RUN_STATUSES as readonly string[]).includes(status);
}

export function isAwaitingRunStatus(status: string): boolean {
  return (AWAITING_RUN_STATUSES as readonly string[]).includes(status);
}
