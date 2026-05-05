// ---------------------------------------------------------------------------
// Flow types — Flows-before-Crew pattern (LangGraph checkpoint model).
//
// A FlowDefinition is a frozen JSONB snapshot stored on flow_runs.
// Steps execute sequentially; the executor writes a checkpoint after each
// step so runs can resume deterministically after a process restart.
// Renamed from workflow.ts via M1 (migration 0219).
// ---------------------------------------------------------------------------

export interface FlowStep {
  /** Unique within the workflow. Used as a stable resume cursor. */
  stepId: string;
  /** Action type slug (must exist in ACTION_REGISTRY). */
  actionType: string;
  /** Static payload merged with runtime context at execution time. */
  payload: Record<string, unknown>;
  /** If true this step is skipped when resuming from a later checkpoint. */
  skippable?: boolean;
}

export interface FlowDefinition {
  workflowType: string;
  version: number;
  steps: FlowStep[];
  /** Human-readable label shown in the inbox/review queue. */
  label?: string;
}

export type FlowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'        // waiting for human approval on a review-gated step
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Runtime checkpoint written after each completed step.
 * The executor reads this to resume after a restart.
 *
 * For HITL pauses, the checkpoint also includes resume validation fields
 * that are checked before execution continues after approval:
 *   - timeoutAt:  ISO timestamp after which the approval is stale and resume is rejected.
 *   - inputHash:  SHA-256(JSON.stringify(sortedPayload)) of the paused step's input.
 *                 Compared against the approved action's payload at resume time to detect
 *                 mutations after the checkpoint was written.
 *   - toolVersion: ACTION_REGISTRY version string at checkpoint time (for future compat).
 */
export interface FlowCheckpoint {
  /** Index of the last successfully completed step. -1 = none yet. */
  lastCompletedStepIndex: number;
  /** ISO timestamp of the most recent checkpoint write. */
  checkpointedAt: string;
  /** ISO timestamp — approval must arrive before this time. Only set on HITL pauses. */
  timeoutAt?: string;
  /** SHA-256 hex of the paused step's merged payload. Only set on HITL pauses. */
  inputHash?: string;
  /** ACTION_REGISTRY version at checkpoint time. */
  toolVersion?: string;
}
