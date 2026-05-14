// Shared row-level types and state-machine helpers for operator_runs.
// Re-exports the Drizzle inferred types and adds type guards + helpers.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.3, §3.4

export type OperatorRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export const OPERATOR_RUN_STATUSES: ReadonlyArray<OperatorRunStatus> = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const OPERATOR_RUN_TERMINAL_STATUSES: ReadonlyArray<OperatorRunStatus> = [
  'completed',
  'failed',
  'cancelled',
] as const;

export type CredentialMode = 'operator_session' | 'api_key';

export const CREDENTIAL_MODES: ReadonlyArray<CredentialMode> = [
  'operator_session',
  'api_key',
] as const;

/** The six settings captured in operator_runs.settings_snapshot at dispatch time. */
export interface OperatorRunSettingsSnapshot {
  session_soft_cap_minutes: number;
  auto_extend_grace_minutes: number;
  max_chain_length: number;
  max_wall_clock_per_task_days: number;
  per_task_budget_cap_minutes: number;
  concurrent_operator_sessions_cap: number;
}

export function isOperatorRunTerminal(status: OperatorRunStatus): boolean {
  return OPERATOR_RUN_TERMINAL_STATUSES.includes(status);
}

export function isOperatorRunActive(status: OperatorRunStatus): boolean {
  return status === 'pending' || status === 'running';
}

/** Agent-run task-level status values introduced by the operator backend. */
export type AgentRunPausedStatus =
  | 'paused_for_chain_continuation'
  | 'paused_chain_failure'
  | 'paused_budget_exceeded'
  | 'paused_wall_clock_exceeded';

export const AGENT_RUN_PAUSED_STATUSES: ReadonlyArray<AgentRunPausedStatus> = [
  'paused_for_chain_continuation',
  'paused_chain_failure',
  'paused_budget_exceeded',
  'paused_wall_clock_exceeded',
] as const;

/** Resumable paused states (have a defined transition back to delegated). */
export const AGENT_RUN_RESUMABLE_PAUSED_STATUSES: ReadonlyArray<AgentRunPausedStatus> = [
  'paused_for_chain_continuation',
  'paused_chain_failure',
  'paused_budget_exceeded',
] as const;

export function isAgentRunPaused(status: string): status is AgentRunPausedStatus {
  return AGENT_RUN_PAUSED_STATUSES.includes(status as AgentRunPausedStatus);
}

export function isAgentRunResumable(status: string): boolean {
  return AGENT_RUN_RESUMABLE_PAUSED_STATUSES.includes(status as AgentRunPausedStatus);
}
