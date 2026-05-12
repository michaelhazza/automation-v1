// Discriminated union for the operator-session.* lifecycle event family.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §4.7
//
// SINGLE SOURCE OF TRUTH for event-name literals.
// A CI gate (scripts/gates/verify-operator-event-registry.sh) checks for
// naked string literals matching the family pattern outside this file.
//
// Namespace discipline:
//   - operator-session.* — lifecycle events (this file)
//   - operator.*         — incident/system-monitoring events (NOT here)
//   - task.operator.*    — audit events for task-level actions (NOT here)
//   - subaccount.operator_settings.* — audit events for settings (NOT here)

export type OperatorSessionEventName =
  | 'operator-session.dispatched'
  | 'operator-session.credential_injected'
  | 'operator-session.progressed'
  | 'operator-session.fallback_engaged'
  | 'operator-session.refresh_failed'
  | 'operator-session.preparing_checkpoint'
  | 'operator-session.auto_extending'
  | 'operator-session.artefact_harvested'
  | 'operator-session.chain_link_completed'
  | 'operator-session.chain_link_failed'
  | 'operator-session.chain_link_cancelled'
  | 'operator-session.task_completed'
  | 'operator-session.task_failed'
  | 'operator-session.task_cancelled'
  | 'operator-session.task_paused_for_chain_continuation'
  | 'operator-session.task_paused_chain_failure'
  | 'operator-session.task_paused_budget_exceeded'
  | 'operator-session.task_paused_wall_clock_exceeded'
  | 'operator-session.fresh_profile_restart'
  | 'operator-session.usability_restored';

export const OPERATOR_SESSION_EVENT_NAMES: ReadonlyArray<OperatorSessionEventName> = [
  'operator-session.dispatched',
  'operator-session.credential_injected',
  'operator-session.progressed',
  'operator-session.fallback_engaged',
  'operator-session.refresh_failed',
  'operator-session.preparing_checkpoint',
  'operator-session.auto_extending',
  'operator-session.artefact_harvested',
  'operator-session.chain_link_completed',
  'operator-session.chain_link_failed',
  'operator-session.chain_link_cancelled',
  'operator-session.task_completed',
  'operator-session.task_failed',
  'operator-session.task_cancelled',
  'operator-session.task_paused_for_chain_continuation',
  'operator-session.task_paused_chain_failure',
  'operator-session.task_paused_budget_exceeded',
  'operator-session.task_paused_wall_clock_exceeded',
  'operator-session.fresh_profile_restart',
  'operator-session.usability_restored',
] as const;

// Typed per-event payload shapes (minimum fields per spec §4.7)

export interface OperatorSessionDispatchedEvent {
  event: 'operator-session.dispatched';
  chain_link_id: string;
  chain_seq: number;
  image_tag: string;
  credential_mode: 'operator_session' | 'api_key';
  started_at: string;
}

export interface OperatorSessionCredentialInjectedEvent {
  event: 'operator-session.credential_injected';
  chain_link_id: string;
  credential_mode: 'operator_session' | 'api_key';
  plan_tier: string | null;
}

export interface OperatorSessionProgressedEvent {
  event: 'operator-session.progressed';
  chain_link_id: string;
  step_index: number;
  summary: string;
  last_progress_at: string;
}

export interface OperatorSessionFallbackEngagedEvent {
  event: 'operator-session.fallback_engaged';
  chain_link_id: string;
  from_mode: 'operator_session';
  to_mode: 'api_key';
  reason: string;
  step_index: number;
}

export interface OperatorSessionRefreshFailedEvent {
  event: 'operator-session.refresh_failed';
  chain_link_id: string;
  reason: string;
}

export interface OperatorSessionPreparingCheckpointEvent {
  event: 'operator-session.preparing_checkpoint';
  chain_link_id: string;
  time_remaining_ms: number;
}

export interface OperatorSessionAutoExtendingEvent {
  event: 'operator-session.auto_extending';
  chain_link_id: string;
  grace_remaining_ms: number;
}

export interface OperatorSessionArtefactHarvestedEvent {
  event: 'operator-session.artefact_harvested';
  agent_run_id: string;
  chain_link_id?: string;
  artefact_ids: string[];
  harvest_reason: string;
}

export interface OperatorSessionChainLinkCompletedEvent {
  event: 'operator-session.chain_link_completed';
  chain_link_id: string;
  chain_seq: number;
  checkpoint_id: string;
  step_count: number;
}

export interface OperatorSessionChainLinkFailedEvent {
  event: 'operator-session.chain_link_failed';
  chain_link_id: string;
  failure_reason: string;
  failed_mid_step: boolean;
}

export interface OperatorSessionChainLinkCancelledEvent {
  event: 'operator-session.chain_link_cancelled';
  chain_link_id: string;
  cancelled_by_user_id: string | null;
}

export interface OperatorSessionTaskCompletedEvent {
  event: 'operator-session.task_completed';
  agent_run_id: string;
  total_chain_links: number;
  total_wall_clock_ms: number;
}

export interface OperatorSessionTaskFailedEvent {
  event: 'operator-session.task_failed';
  agent_run_id: string;
  failure_reason: string;
  last_chain_link_id: string;
}

export interface OperatorSessionTaskCancelledEvent {
  event: 'operator-session.task_cancelled';
  agent_run_id: string;
  cancelled_by_user_id: string | null;
}

export interface OperatorSessionTaskPausedForChainContinuationEvent {
  event: 'operator-session.task_paused_for_chain_continuation';
  agent_run_id: string;
  last_chain_link_id: string;
  reason: string;
}

export interface OperatorSessionTaskPausedChainFailureEvent {
  event: 'operator-session.task_paused_chain_failure';
  agent_run_id: string;
  last_chain_link_id: string;
  last_failure_class: string;
}

export interface OperatorSessionTaskPausedBudgetExceededEvent {
  event: 'operator-session.task_paused_budget_exceeded';
  agent_run_id: string;
  budget_cap_minutes: number;
  consumed_minutes: number;
}

export interface OperatorSessionTaskPausedWallClockExceededEvent {
  event: 'operator-session.task_paused_wall_clock_exceeded';
  agent_run_id: string;
  max_wall_clock_per_task_days: number;
  elapsed_days: number;
}

export interface OperatorSessionFreshProfileRestartEvent {
  event: 'operator-session.fresh_profile_restart';
  agent_run_id: string;
  prior_attempt_number: number;
  new_attempt_number: number;
  actor_user_id: string;
}

export interface OperatorSessionUsabilityRestoredEvent {
  event: 'operator-session.usability_restored';
  agent_run_id: string;
  credential_id: string;
}

/** Discriminated union of all operator-session lifecycle event payloads. */
export type OperatorBackendEvent =
  | OperatorSessionDispatchedEvent
  | OperatorSessionCredentialInjectedEvent
  | OperatorSessionProgressedEvent
  | OperatorSessionFallbackEngagedEvent
  | OperatorSessionRefreshFailedEvent
  | OperatorSessionPreparingCheckpointEvent
  | OperatorSessionAutoExtendingEvent
  | OperatorSessionArtefactHarvestedEvent
  | OperatorSessionChainLinkCompletedEvent
  | OperatorSessionChainLinkFailedEvent
  | OperatorSessionChainLinkCancelledEvent
  | OperatorSessionTaskCompletedEvent
  | OperatorSessionTaskFailedEvent
  | OperatorSessionTaskCancelledEvent
  | OperatorSessionTaskPausedForChainContinuationEvent
  | OperatorSessionTaskPausedChainFailureEvent
  | OperatorSessionTaskPausedBudgetExceededEvent
  | OperatorSessionTaskPausedWallClockExceededEvent
  | OperatorSessionFreshProfileRestartEvent
  | OperatorSessionUsabilityRestoredEvent;

/** Returns all registered event name literals. Used by the CI gate enumerator helper. */
export function enumerateOperatorEventNames(): ReadonlyArray<OperatorSessionEventName> {
  return OPERATOR_SESSION_EVENT_NAMES;
}
