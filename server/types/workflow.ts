// ---------------------------------------------------------------------------
// Workflow types — Flows-before-Crew pattern (LangGraph checkpoint model).
//
// A WorkflowDefinition is a frozen JSONB snapshot stored on workflow_runs.
// Steps execute sequentially; the executor writes a checkpoint after each
// step so runs can resume deterministically after a process restart.
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  /** Unique within the workflow. Used as a stable resume cursor. */
  stepId: string;
  /** Action type slug (must exist in ACTION_REGISTRY). */
  actionType: string;
  /** Static payload merged with runtime context at execution time. */
  payload: Record<string, unknown>;
  /** If true this step is skipped when resuming from a later checkpoint. */
  skippable?: boolean;
}

export interface WorkflowDefinition {
  workflowType: string;
  version: number;
  steps: WorkflowStep[];
  /** Human-readable label shown in the inbox/review queue. */
  label?: string;
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'        // waiting for human approval on a review-gated step
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Runtime checkpoint written after each completed step.
 * The executor reads this to resume after a restart.
 */
export interface WorkflowCheckpoint {
  /** Index of the last successfully completed step. -1 = none yet. */
  lastCompletedStepIndex: number;
  /** ISO timestamp of the most recent checkpoint write. */
  checkpointedAt: string;
}
