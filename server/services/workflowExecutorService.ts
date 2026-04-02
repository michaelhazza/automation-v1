// ---------------------------------------------------------------------------
// Workflow Executor Service — Flows-before-Crew pattern.
//
// Executes a WorkflowDefinition step-by-step, writing a LangGraph-style
// checkpoint after each step so runs can resume deterministically after a
// process restart or a HITL pause.
//
// Key invariants:
//   - Steps execute in declaration order.
//   - currentStepIndex is the _next_ step to execute (not the last done).
//   - Outputs from completed steps are accumulated in stepOutputs on the run row.
//   - After each step a WorkflowStepOutput row is appended (audit trail).
//
// HITL handling (two-path model):
//   - Review-gated steps: propose action → store workflowRunId in metadata
//     → write checkpoint → mark run as 'paused' → RETURN immediately.
//     The DB-backed resume worker (queueService) calls resumeWorkflow() after
//     the human approves the action in the review queue.
//   - Auto-gated / non-gated steps: execute inline via skillExecutor as usual.
//
// This keeps the two flows completely separate:
//   Direct agent path  → awaitDecision in-memory blocking (hitlService)
//   Workflow path      → checkpoint → pause → DB-backed resume
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { workflowRuns, workflowStepOutputs } from '../db/schema/workflowRuns.js';
import { skillExecutor } from './skillExecutor.js';
import { actionService } from './actionService.js';
import { reviewService } from './reviewService.js';
import { ACTION_REGISTRY } from '../config/actionRegistry.js';
import { logger } from '../lib/logger.js';
import type { WorkflowDefinition, WorkflowCheckpoint, WorkflowRunStatus, WorkflowStep } from '../types/workflow.js';

// HITL approval window — approvals arriving after this are rejected as stale
const HITL_TIMEOUT_HOURS = 24;

// ---------------------------------------------------------------------------
// Context passed to every workflow step execution
// ---------------------------------------------------------------------------

export interface WorkflowExecutionContext {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  agentRunId?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new workflow run and execute it until completion, pause, or failure.
 * Returns the workflow run ID.
 */
export async function startWorkflow(
  definition: WorkflowDefinition,
  context: WorkflowExecutionContext,
): Promise<string> {
  const [run] = await db
    .insert(workflowRuns)
    .values({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      workflowDefinition: definition,
      workflowName: definition.workflowType,
      workflowVersion: String(definition.version),
      status: 'running',
      currentStepIndex: 0,
      stepOutputs: {},
    })
    .returning({ id: workflowRuns.id });

  await executeFromCheckpoint(run.id, context, 0, {});
  return run.id;
}

/**
 * Resume a paused workflow run from its last checkpoint.
 *
 * If `approvedActionId` is provided the approved action's resultJson is
 * used as the output of the currently-paused step before advancing.
 */
export async function resumeWorkflow(
  workflowRunId: string,
  context: WorkflowExecutionContext,
  approvedActionId?: string,
): Promise<void> {
  const run = await db.query.workflowRuns.findFirst({
    where: and(
      eq(workflowRuns.id, workflowRunId),
      eq(workflowRuns.organisationId, context.organisationId),
    ),
  });

  if (!run) {
    logger.warn('workflow.resume_run_not_found', { workflowRunId, organisationId: context.organisationId });
    return;
  }

  // Only paused runs can be resumed (guard against duplicate resume jobs)
  if (run.status !== 'paused') {
    logger.warn('workflow.resume_wrong_status', { workflowRunId, status: run.status });
    return;
  }

  // ── Resume validation ────────────────────────────────────────────────────
  const checkpoint = run.checkpoint as WorkflowCheckpoint | null;

  if (checkpoint?.timeoutAt && new Date() > new Date(checkpoint.timeoutAt)) {
    const msg = `Resume rejected: approval window expired at ${checkpoint.timeoutAt}`;
    logger.warn('workflow.resume_expired', { workflowRunId, timeoutAt: checkpoint.timeoutAt });
    await markRunFailed(workflowRunId, msg);
    return;
  }

  // Pre-load the approved action once (used for both validation and result extraction)
  const approvedAction = approvedActionId
    ? await actionService.getAction(approvedActionId, context.organisationId)
    : null;

  if (approvedAction && checkpoint?.inputHash) {
    const currentHash = hashPayload(approvedAction.payloadJson as Record<string, unknown>);
    if (currentHash !== checkpoint.inputHash) {
      const msg = 'Resume rejected: action payload was modified after checkpoint was written';
      logger.warn('workflow.resume_payload_tampered', { workflowRunId });
      await markRunFailed(workflowRunId, msg);
      return;
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const definition = run.workflowDefinition as WorkflowDefinition;
  const accumulatedOutputs: Record<string, unknown> = (run.stepOutputs as Record<string, unknown>) ?? {};
  let stepIndex = run.currentStepIndex;

  // If an approved action is provided, record its result as the paused step's output
  // then advance to the next step before continuing execution.
  if (approvedAction) {
    const stepOutput = approvedAction.resultJson ?? { approved: true };
    const pausedStep = definition.steps[stepIndex];

    if (pausedStep) {
      accumulatedOutputs[pausedStep.stepId] = stepOutput;
      await appendStepOutput(workflowRunId, pausedStep, stepIndex, stepOutput, 'completed');
    }

    stepIndex += 1;
  }

  await db
    .update(workflowRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(workflowRuns.id, workflowRunId));

  await executeFromCheckpoint(workflowRunId, context, stepIndex, accumulatedOutputs);
}

// ---------------------------------------------------------------------------
// Core execution loop
// ---------------------------------------------------------------------------

async function executeFromCheckpoint(
  workflowRunId: string,
  context: WorkflowExecutionContext,
  startIndex: number,
  initialOutputs: Record<string, unknown>,
): Promise<void> {
  const run = await db.query.workflowRuns.findFirst({
    where: eq(workflowRuns.id, workflowRunId),
  });

  if (!run) return;

  const definition = run.workflowDefinition as WorkflowDefinition;
  const steps = definition.steps;
  let stepIndex = startIndex;
  let accumulatedOutputs: Record<string, unknown> = { ...initialOutputs };

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    // ── Idempotency guard: skip steps already recorded in step_outputs ─────
    // This makes resume provably safe under duplicate-job or partial-failure scenarios.
    const existingOutput = await db.query.workflowStepOutputs.findFirst({
      where: and(
        eq(workflowStepOutputs.workflowRunId, workflowRunId),
        eq(workflowStepOutputs.stepIndex, stepIndex),
      ),
    });
    if (existingOutput && existingOutput.status !== 'failed') {
      accumulatedOutputs[step.stepId] = existingOutput.output ?? {};
      stepIndex += 1;
      continue;
    }

    const gateLevel = getStepGateLevel(step);

    // ── Review-gated step: propose, checkpoint, pause. Do NOT block. ──────
    if (gateLevel === 'review') {
      await proposeWorkflowHitlStep(workflowRunId, step, stepIndex, accumulatedOutputs, context);
      return; // caller (resume worker) continues after human approves
    }

    // ── Auto-gated / direct step: execute inline ───────────────────────────
    let output: unknown = null;
    let errorMessage: string | undefined;
    let stepStatus: 'completed' | 'failed' = 'completed';

    try {
      const mergedPayload = { ...step.payload, ...accumulatedOutputs };

      output = await skillExecutor.execute({
        skillName: step.actionType,
        input: mergedPayload,
        context: {
          runId: context.agentRunId ?? workflowRunId,
          organisationId: context.organisationId,
          subaccountId: context.subaccountId,
          agentId: context.agentId,
          orgProcesses: [],
        },
      });

      accumulatedOutputs = { ...accumulatedOutputs, [step.stepId]: output };
    } catch (err) {
      stepStatus = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      output = { error: errorMessage };

      await appendStepOutput(workflowRunId, step, stepIndex, output, 'failed', errorMessage);
      await writeCheckpoint(workflowRunId, stepIndex, accumulatedOutputs, 'failed', errorMessage);
      return;
    }

    await appendStepOutput(workflowRunId, step, stepIndex, output, stepStatus);

    stepIndex += 1;
    await writeCheckpoint(workflowRunId, stepIndex, accumulatedOutputs, 'running');
  }

  // All steps completed
  await db
    .update(workflowRuns)
    .set({
      status: 'completed',
      currentStepIndex: steps.length,
      stepOutputs: accumulatedOutputs,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, workflowRunId));
}

// ---------------------------------------------------------------------------
// HITL step — propose + create review item + checkpoint + pause
// ---------------------------------------------------------------------------

async function proposeWorkflowHitlStep(
  workflowRunId: string,
  step: WorkflowStep,
  stepIndex: number,
  accumulatedOutputs: Record<string, unknown>,
  context: WorkflowExecutionContext,
): Promise<void> {
  const mergedPayload = { ...step.payload, ...accumulatedOutputs };

  // Idempotency key includes run + step so retried resume proposals don't duplicate
  const idempotencyKey = `workflow:${workflowRunId}:${step.stepId}`;

  const proposed = await actionService.proposeAction({
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    agentId: context.agentId,
    agentRunId: context.agentRunId,
    actionType: step.actionType,
    idempotencyKey,
    payload: mergedPayload,
    // Store workflow context in metadata so the approval handler can enqueue resume
    metadata: {
      workflowRunId,
      workflowStepId: step.stepId,
      workflowStepIndex: stepIndex,
    },
  });

  if (proposed.status === 'pending_approval' && proposed.isNew) {
    const action = await actionService.getAction(proposed.actionId, context.organisationId);
    await reviewService.createReviewItem(action, {
      actionType: step.actionType,
      reasoning: `Workflow step ${stepIndex + 1}: ${step.stepId}`,
      proposedPayload: mergedPayload,
    });
  }

  // Checkpoint with resume validation fields
  const timeoutAt = new Date(Date.now() + HITL_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString();
  const inputHash = hashPayload(mergedPayload);
  const def = ACTION_REGISTRY[step.actionType as keyof typeof ACTION_REGISTRY];
  const toolVersion = String((def as { version?: unknown } | undefined)?.version ?? '1');

  await writeCheckpoint(workflowRunId, stepIndex, accumulatedOutputs, 'paused', undefined, {
    timeoutAt,
    inputHash,
    toolVersion,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the effective gate level for a workflow step. */
function getStepGateLevel(step: WorkflowStep): 'auto' | 'review' | 'block' {
  const def = ACTION_REGISTRY[step.actionType as keyof typeof ACTION_REGISTRY];
  return (def?.defaultGateLevel ?? 'auto') as 'auto' | 'review' | 'block';
}

async function writeCheckpoint(
  workflowRunId: string,
  nextStepIndex: number,
  stepOutputs: Record<string, unknown>,
  status: WorkflowRunStatus,
  errorMessage?: string,
  extraCheckpointFields?: Pick<WorkflowCheckpoint, 'timeoutAt' | 'inputHash' | 'toolVersion'>,
): Promise<void> {
  const checkpoint: WorkflowCheckpoint = {
    lastCompletedStepIndex: nextStepIndex - 1,
    checkpointedAt: new Date().toISOString(),
    ...extraCheckpointFields,
  };

  await db
    .update(workflowRuns)
    .set({
      status,
      currentStepIndex: nextStepIndex,
      stepOutputs,
      checkpoint,
      errorMessage: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, workflowRunId));
}

/** SHA-256 of a deterministically-serialised payload object. */
function hashPayload(payload: Record<string, unknown>): string {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(sorted).digest('hex');
}

/** Mark a workflow run as failed with a message. */
async function markRunFailed(workflowRunId: string, message: string): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
    .where(eq(workflowRuns.id, workflowRunId));
}

async function appendStepOutput(
  workflowRunId: string,
  step: WorkflowStep,
  stepIndex: number,
  output: unknown,
  stepStatus: 'completed' | 'failed' | 'skipped',
  errorMessage?: string,
): Promise<void> {
  await db.insert(workflowStepOutputs).values({
    workflowRunId,
    stepId: step.stepId,
    stepIndex,
    output,
    status: stepStatus,
    errorMessage: errorMessage ?? null,
    completedAt: stepStatus === 'completed' ? new Date() : null,
  });
}
