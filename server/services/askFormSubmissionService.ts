/**
 * AskFormSubmissionService — submit / skip an Ask gate for a task.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 *
 * Routes are task-scoped (/api/tasks/:taskId/ask/:stepId/...). The service
 * resolves taskId → active runId via resolveActiveRunForTask, then locates
 * the step run and open gate before delegating to WorkflowRunService.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowStepRuns } from '../db/schema/workflowRuns.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { WorkflowRunService } from './workflowRunService.js';
import { resolveActiveRunForTask } from './workflowRunResolverService.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';
import type { AskParams } from '../../shared/types/askForm.js';

export class NotInSubmitterPoolError extends Error {
  readonly code = 'not_in_submitter_pool' as const;
  constructor() {
    super('Caller is not in the submitter pool for this Ask gate');
    this.name = 'NotInSubmitterPoolError';
  }
}

export class AskAlreadyResolvedError extends Error {
  readonly code = 'already_resolved' as const;
  constructor(public readonly currentStatus: string) {
    super(`Ask gate is already resolved (status: ${currentStatus})`);
    this.name = 'AskAlreadyResolvedError';
  }
}

export class SkipNotAllowedError extends Error {
  readonly code = 'skip_not_allowed' as const;
  constructor() {
    super('Skip is not allowed for this Ask step');
    this.name = 'SkipNotAllowedError';
  }
}

async function resolveAskContext(
  taskId: string,
  stepId: string,
  organisationId: string,
) {
  const runId = await resolveActiveRunForTask(taskId, organisationId);
  if (!runId) {
    throw { statusCode: 404, message: 'no_active_run_for_task' };
  }

  const [stepRun] = await db
    .select()
    .from(workflowStepRuns)
    .where(and(eq(workflowStepRuns.runId, runId), eq(workflowStepRuns.stepId, stepId)));
  if (!stepRun) {
    throw { statusCode: 404, message: 'step_not_found' };
  }

  const gate = await WorkflowStepGateService.getOpenGate(runId, stepId, organisationId);
  if (!gate) {
    throw new AskAlreadyResolvedError(stepRun.status);
  }

  if (gate.gateKind !== 'ask') {
    throw { statusCode: 400, message: 'wrong_gate_type' };
  }

  return { runId, stepRun, gate };
}

function checkPoolMembership(
  gate: { approverPoolSnapshot: string[] | null | undefined },
  callerUserId: string,
): void {
  if (
    gate.approverPoolSnapshot != null &&
    !gate.approverPoolSnapshot.includes(callerUserId)
  ) {
    throw new NotInSubmitterPoolError();
  }
}

export const askFormSubmissionService = {
  async submit(
    taskId: string,
    stepId: string,
    callerUserId: string,
    values: Record<string, unknown>,
    organisationId: string,
  ): Promise<{ ok: true }> {
    const { runId, stepRun, gate } = await resolveAskContext(taskId, stepId, organisationId);

    checkPoolMembership(gate, callerUserId);

    const outputJson: Record<string, unknown> = {
      submitted_by: callerUserId,
      submitted_at: new Date().toISOString(),
      values,
      skipped: false,
    };

    await WorkflowRunService.submitStepInput(
      organisationId,
      runId,
      stepRun.id,
      outputJson,
      callerUserId,
    );

    void appendAndEmitTaskEvent(taskId, Date.now(), 0, 'user', {
      kind: 'ask.submitted',
      payload: { gateId: gate.id, submittedBy: callerUserId, values },
    });

    return { ok: true as const };
  },

  async skip(
    taskId: string,
    stepId: string,
    callerUserId: string,
    organisationId: string,
  ): Promise<{ ok: true }> {
    const { runId, stepRun, gate } = await resolveAskContext(taskId, stepId, organisationId);

    checkPoolMembership(gate, callerUserId);

    const params = stepRun.inputJson as (AskParams & Record<string, unknown>) | null;
    if (!params || params.allowSkip !== true) {
      throw new SkipNotAllowedError();
    }

    const outputJson: Record<string, unknown> = {
      submitted_by: callerUserId,
      submitted_at: new Date().toISOString(),
      values: {},
      skipped: true,
      _skip: true,
    };

    await WorkflowRunService.submitStepInput(
      organisationId,
      runId,
      stepRun.id,
      outputJson,
      callerUserId,
    );

    void appendAndEmitTaskEvent(taskId, Date.now(), 0, 'user', {
      kind: 'ask.skipped',
      payload: { gateId: gate.id, submittedBy: callerUserId, stepId },
    });

    return { ok: true as const };
  },
};
