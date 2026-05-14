// operatorManagedBackendPure.ts — pure helpers for the operator_managed adapter.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md
//   §3.7 item 6 (stickiness derivation)
//   §3.14 item 4 (finaliser decision table)
//   §3.17 (concurrency-cap classifier)
//   §7.3 step 2 (predecessor allow-list)
//
// Pure module — no DB, no IO.

import type { CredentialMode, OperatorRunSettingsSnapshot } from '../../../shared/types/operatorRuns.js';
import type { RuntimeErrorClass } from '../operatorRuntimeErrors.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class OperatorPureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorPureValidationError';
  }
}

// ---------------------------------------------------------------------------
// classifyChainLinkFailure
// ---------------------------------------------------------------------------

export type ChainLinkFailureKind = 'start' | 'runtime' | 'hard_cap_unresumable';

export interface ChainLinkFailureClassification {
  kind: ChainLinkFailureKind;
  failure_class: 'transient' | 'permanent' | 'budget' | 'concurrency' | 'profile_corruption' | 'auth';
  failure_reason: string;
}

export interface ClassifyChainLinkFailureInput {
  /** Status of the operator_run row at the time of failure. */
  operatorRunStatus: 'pending' | 'running';
  /** Whether the chain link hit hard cap (soft + grace) without a checkpoint. */
  failedMidStep: boolean;
  /** The classified error type from operatorRuntimeErrors. */
  errorClass: RuntimeErrorClass;
  /** Human-readable failure reason string. */
  failureReason: string;
}

/**
 * Classifies a chain-link failure into a discriminated { kind, failure_class, failure_reason }.
 *
 * - 'start': failure occurred before the chain link began running (pending state).
 *   These increment operator_chain_failure_count via the dispatcher.
 * - 'hard_cap_unresumable': failure occurred in running state with failedMidStep=true.
 *   Transitions the task to paused_chain_failure DIRECTLY without counter increment.
 * - 'runtime': failure occurred in running state without failedMidStep=true.
 *   Terminates the task (agent_runs.status='failed').
 */
export function classifyChainLinkFailure(
  input: ClassifyChainLinkFailureInput,
): ChainLinkFailureClassification {
  const { operatorRunStatus, failedMidStep, errorClass, failureReason } = input;

  if (operatorRunStatus === 'pending') {
    // Start-phase failure — the chain link never began running.
    const failure_class = mapErrorClassToFailureClass(errorClass);
    return { kind: 'start', failure_class, failure_reason: failureReason };
  }

  // operatorRunStatus === 'running'
  if (failedMidStep) {
    // Hard cap unresumable — single-event pause, no counter increment.
    return {
      kind: 'hard_cap_unresumable',
      failure_class: 'permanent',
      failure_reason: failureReason,
    };
  }

  // Normal runtime failure — terminates the task.
  const failure_class = mapErrorClassToFailureClass(errorClass);
  return { kind: 'runtime', failure_class, failure_reason: failureReason };
}

function mapErrorClassToFailureClass(
  errorClass: RuntimeErrorClass,
): ChainLinkFailureClassification['failure_class'] {
  switch (errorClass) {
    case 'session_unavailable':
      return 'permanent';
    case 'transient':
      return 'transient';
    case 'permanent':
      return 'permanent';
    case 'auth':
      return 'auth';
    case 'profile_corruption':
      return 'profile_corruption';
    case 'concurrency':
      return 'concurrency';
    case 'budget':
      return 'budget';
  }
}

// ---------------------------------------------------------------------------
// decideChainResumeOutcome
// ---------------------------------------------------------------------------

export type ChainResumeAction =
  | 'task_terminal_completed'
  | 'task_terminal_failed'
  | 'task_paused_budget_exceeded'
  | 'task_paused_wall_clock_exceeded'
  | 'task_paused_chain_failure'
  | 'dispatch_next_chain_link'
  | 'task_terminal_cancelled';

export interface DecideChainResumeOutcomeInput {
  /** Terminal status of the completed chain link. */
  chainLinkStatus: 'completed' | 'failed' | 'cancelled';
  /** Whether the checkpoint_payload is non-null. */
  hasCheckpoint: boolean;
  /** Whether failed_mid_step=true on the chain link row. */
  failedMidStep: boolean;
  /** The chain_seq of this chain link (1-based). */
  chainSeq: number;
  /** Settings snapshot from the chain link (for cap enforcement). */
  settingsSnapshot: OperatorRunSettingsSnapshot;
  /** Total operator-session budget minutes consumed so far (across all chain links of this attempt). */
  consumedBudgetMinutes: number;
  /** Wall-clock elapsed since the first chain link's started_at, in days (fractional OK). */
  elapsedWallClockDays: number;
  /** Whether the operator runtime reported task_completed (genuine task done signal). */
  isTaskDone: boolean;
}

export interface DecideChainResumeOutcomeResult {
  action: ChainResumeAction;
  failureReason?: string;
}

/**
 * Implements the finaliser decision table per spec §3.14 item 4.
 * Branches evaluated in spec order; first match wins.
 */
export function decideChainResumeOutcome(
  input: DecideChainResumeOutcomeInput,
): DecideChainResumeOutcomeResult {
  const {
    chainLinkStatus,
    hasCheckpoint,
    failedMidStep,
    chainSeq,
    settingsSnapshot,
    consumedBudgetMinutes,
    elapsedWallClockDays,
    isTaskDone,
  } = input;

  // Branch: cancelled → propagate task-terminal 'cancelled'
  if (chainLinkStatus === 'cancelled') {
    return { action: 'task_terminal_cancelled' };
  }

  // Branch: failed with failed_mid_step=true → task paused_chain_failure
  if (chainLinkStatus === 'failed' && failedMidStep) {
    return { action: 'task_paused_chain_failure', failureReason: 'hard_cap_unresumable' };
  }

  // Branch: failed with failed_mid_step=false → task-terminal failed
  if (chainLinkStatus === 'failed' && !failedMidStep) {
    return { action: 'task_terminal_failed' };
  }

  // chainLinkStatus === 'completed' beyond this point

  if (hasCheckpoint) {
    // Branch 1: budget cap exceeded
    if (consumedBudgetMinutes >= settingsSnapshot.per_task_budget_cap_minutes) {
      return { action: 'task_paused_budget_exceeded', failureReason: 'budget_cap_exceeded' };
    }

    // Branch 2: wall-clock cap exceeded
    if (elapsedWallClockDays >= settingsSnapshot.max_wall_clock_per_task_days) {
      return { action: 'task_paused_wall_clock_exceeded', failureReason: 'max_wall_clock_exceeded' };
    }

    // Branch 3: max chain length reached
    if (chainSeq >= settingsSnapshot.max_chain_length) {
      return { action: 'task_terminal_failed', failureReason: 'max_chain_length_reached' };
    }

    // Branch 4: dispatch next chain link
    return { action: 'dispatch_next_chain_link' };
  }

  // completed with NULL checkpoint and task is done
  if (isTaskDone) {
    return { action: 'task_terminal_completed' };
  }

  // completed with NULL checkpoint but task NOT done — treat as failed
  return { action: 'task_terminal_failed', failureReason: 'checkpoint_signal_invalid' };
}

// ---------------------------------------------------------------------------
// deriveCredentialStartMode (stickiness derivation)
// ---------------------------------------------------------------------------

export interface PriorChainLinkSummary {
  /** The credential_mode column from the latest non-superseded prior operator_runs row. */
  credentialMode: CredentialMode;
  /**
   * The link-boundary timestamp for the prior row.
   * coalesce(event_emitted_at, completed_at, started_at)
   */
  linkBoundaryAt: Date;
}

export interface DeriveCredentialStartModeInput {
  /**
   * The latest non-superseded prior chain-link row summary.
   * NULL if this is the first chain link of the task.
   */
  priorChainLink: PriorChainLinkSummary | null;
  /**
   * Timestamps of usability_restored lifecycle events fired for this
   * agent_run_id since (and including) the link-boundary timestamp.
   * (See shared/types/operatorBackendEvents.ts for the event name constant.)
   */
  usabilityRestoredSince: Date[];
  /**
   * Timestamps of credential_refreshed audit events fired for this
   * agent_run_id since (and including) the link-boundary timestamp.
   */
  credentialRefreshedSince: Date[];
}

/**
 * Derives the credential_start_mode (immutable) for the next chain link.
 *
 * Stickiness rule (spec §3.7 item 6):
 * - If the prior chain link's credential_mode is 'api_key' AND no
 *   usability_restored event has fired since the link-boundary timestamp AND
 *   no credential_refreshed audit event has fired since the link-boundary
 *   timestamp → stickiness applies; next link starts with 'api_key'.
 * - Otherwise, stickiness clears; next link starts with 'operator_session'.
 * - If there is no prior chain link (first dispatch), always 'operator_session'.
 */
export function deriveCredentialStartMode(
  input: DeriveCredentialStartModeInput,
): CredentialMode {
  const { priorChainLink, usabilityRestoredSince, credentialRefreshedSince } = input;

  if (priorChainLink === null) {
    return 'operator_session';
  }

  if (priorChainLink.credentialMode !== 'api_key') {
    return 'operator_session';
  }

  // Prior link ended in api_key mode. Check clearing signals.
  const boundary = priorChainLink.linkBoundaryAt;

  const hasRestoredSignal = usabilityRestoredSince.some((t) => t >= boundary);
  const hasRefreshedSignal = credentialRefreshedSince.some((t) => t >= boundary);

  if (hasRestoredSignal || hasRefreshedSignal) {
    return 'operator_session';
  }

  return 'api_key';
}

// ---------------------------------------------------------------------------
// derivePredecessorAllowList
// ---------------------------------------------------------------------------

export type DispatchReason = 'continuation' | 'retry' | 'budget_extension' | 'bootstrap';

/**
 * Returns the closed predecessor set for agent_runs.status at dispatch time.
 *
 * Per spec §7.3 step 2. 'cancelled' is EXCLUDED from every set — this is the
 * cancel-vs-dispatch invariant.
 */
export function derivePredecessorAllowList(reason: DispatchReason): readonly string[] {
  switch (reason) {
    case 'bootstrap':
      // First chain link: task must be in pending state.
      return ['pending'] as const;

    case 'continuation':
      // Next chain link after a completed checkpoint: task parks in
      // paused_for_chain_continuation.
      return ['paused_for_chain_continuation'] as const;

    case 'retry':
      // User-initiated retry after paused_chain_failure.
      return ['paused_chain_failure'] as const;

    case 'budget_extension':
      // User extended budget after paused_budget_exceeded.
      return ['paused_budget_exceeded'] as const;
  }
}
