// ---------------------------------------------------------------------------
// Workflow Executor Service — Flows-before-Crew pattern.
//
// Executes a WorkflowDefinition step-by-step, writing a LangGraph-style
// checkpoint after each step so runs can resume deterministically after
// a process restart or a HITL pause.
//
// Key invariants:
//   - Steps execute in declaration order.
//   - currentStepIndex is the _next_ step to execute (not the last done).
//   - Outputs from completed steps are merged into stepOutputs on the run row.
//   - After each step a WorkflowStepOutput row is appended (audit trail).
//   - A HITL-gated step pauses execution (status = 'paused'); resume() picks up
//     from the checkpoint.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowRuns, workflowStepOutputs } from '../db/schema/workflowRuns.js';
import { skillExecutor } from './skillExecutor.js';
import type { WorkflowDefinition, WorkflowCheckpoint, WorkflowRunStatus } from '../types/workflow.js';

// ---------------------------------------------------------------------------
// Context passed to every workflow step execution
// ---------------------------------------------------------------------------

interface WorkflowExecutionContext {
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

  await executeFromCheckpoint(run.id, context);
  return run.id;
}

/**
 * Resume a paused or failed workflow run from its last checkpoint.
 */
export async function resumeWorkflow(
  workflowRunId: string,
  context: WorkflowExecutionContext,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(
      and(
        eq(workflowRuns.id, workflowRunId),
        eq(workflowRuns.organisationId, context.organisationId),
      ),
    );

  await executeFromCheckpoint(workflowRunId, context);
}

// ---------------------------------------------------------------------------
// Core execution loop
// ---------------------------------------------------------------------------

async function executeFromCheckpoint(
  workflowRunId: string,
  context: WorkflowExecutionContext,
): Promise<void> {
  const run = await db.query.workflowRuns.findFirst({
    where: and(
      eq(workflowRuns.id, workflowRunId),
      eq(workflowRuns.organisationId, context.organisationId),
    ),
  });

  if (!run) throw new Error(`Workflow run ${workflowRunId} not found`);

  const definition = run.workflowDefinition as WorkflowDefinition;
  const steps = definition.steps;
  let stepIndex = run.currentStepIndex;
  let accumulatedOutputs: Record<string, unknown> = (run.stepOutputs as Record<string, unknown>) ?? {};

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    let stepStatus: 'completed' | 'failed' | 'skipped' = 'completed';
    let output: unknown = null;
    let errorMessage: string | undefined;

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

      // If a HITL gate paused execution the output will signal pending_approval
      if (
        output !== null &&
        typeof output === 'object' &&
        (output as Record<string, unknown>).status === 'pending_approval'
      ) {
        // Write partial checkpoint and mark run as paused
        await writeCheckpoint(workflowRunId, stepIndex, accumulatedOutputs, 'paused');
        await appendStepOutput(workflowRunId, context.organisationId, step, stepIndex, output, 'completed');
        return;
      }

      accumulatedOutputs = { ...accumulatedOutputs, [step.stepId]: output };
    } catch (err) {
      stepStatus = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      output = { error: errorMessage };

      await appendStepOutput(workflowRunId, context.organisationId, step, stepIndex, output, 'failed', errorMessage);
      await writeCheckpoint(workflowRunId, stepIndex, accumulatedOutputs, 'failed', errorMessage);
      return;
    }

    await appendStepOutput(workflowRunId, context.organisationId, step, stepIndex, output, stepStatus);

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
// Helpers
// ---------------------------------------------------------------------------

async function writeCheckpoint(
  workflowRunId: string,
  nextStepIndex: number,
  stepOutputs: Record<string, unknown>,
  status: WorkflowRunStatus,
  errorMessage?: string,
): Promise<void> {
  const checkpoint: WorkflowCheckpoint = {
    lastCompletedStepIndex: nextStepIndex - 1,
    checkpointedAt: new Date().toISOString(),
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

async function appendStepOutput(
  workflowRunId: string,
  _organisationId: string,
  step: { stepId: string; actionType: string },
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
