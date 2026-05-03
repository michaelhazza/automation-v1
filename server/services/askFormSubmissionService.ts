/**
 * askFormSubmissionService.ts — handles Ask form submit and skip.
 *
 * submit:
 *   1. Load open gate (ask kind) via taskId + stepId.
 *   2. Verify caller is in approver_pool_snapshot.
 *   3. Optimistic UPDATE: step_run status awaiting_input → submitted.
 *   4. Resolve the gate (reason: submitted).
 *   5. Emit ask.submitted task event.
 *
 * skip:
 *   1. Load open gate.
 *   2. Verify caller is in pool.
 *   3. Verify allowSkip === true (from step params).
 *   4. Optimistic UPDATE: step_run → skipped.
 *   5. Resolve gate (reason: skipped).
 *   6. Emit ask.skipped.
 *
 * All writes are inside a single transaction; emit deferred until after commit.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workflowStepGates,
  workflowStepRuns,
  workflowRuns,
  workflowTemplateVersions,
  systemWorkflowTemplateVersions,
} from '../db/schema/index.js';
import type { AskFormValues } from '../../../shared/types/askForm.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { TaskEventService } from './taskEventService.js';
import { logger } from '../lib/logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: 'already_submitted'; submitted_by: string | null; submitted_at: string };

export type SkipResult =
  | { ok: true }
  | { ok: false; reason: 'already_resolved'; current_status: string; submitted_by?: string; submitted_at?: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function callerInPool(pool: string[] | null, userId: string): boolean {
  if (!pool || pool.length === 0) return false;
  return pool.includes(userId);
}

/**
 * Resolve the task ID for a gate via its workflow run.
 * Returns null if not found.
 */
async function getTaskIdForGate(workflowRunId: string): Promise<string | null> {
  const [run] = await db
    .select({ taskId: workflowRuns.taskId })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, workflowRunId));
  return (run as { taskId?: string | null } | undefined)?.taskId ?? null;
}

/**
 * Load the step params for a gate (to check allowSkip / schema).
 * Returns null if the definition cannot be found.
 */
async function loadStepParams(
  workflowRunId: string,
  stepId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [run] = await db
      .select({ templateVersionId: workflowRuns.templateVersionId })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId));
    if (!run) return null;

    // Try org template version first
    const [orgVer] = await db
      .select({ definitionJson: workflowTemplateVersions.definitionJson })
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.id, run.templateVersionId));

    const defJson = orgVer?.definitionJson
      ?? (await (async () => {
        const [sysVer] = await db
          .select({ definitionJson: systemWorkflowTemplateVersions.definitionJson })
          .from(systemWorkflowTemplateVersions)
          .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
        return sysVer?.definitionJson ?? null;
      })());

    if (!defJson) return null;

    const def = defJson as { steps?: Array<{ id: string; params?: Record<string, unknown> }> };
    const step = def.steps?.find((s) => s.id === stepId);
    return step?.params ?? null;
  } catch {
    return null;
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

export const AskFormSubmissionService = {
  async submit(
    taskId: string,
    stepId: string,
    organisationId: string,
    callerUserId: string,
    values: AskFormValues,
  ): Promise<SubmitResult> {
    // Load the gate (read outside tx)
    const [gate] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.stepId, stepId),
          eq(workflowStepGates.organisationId, organisationId),
          eq(workflowStepGates.gateKind, 'ask'),
          isNull(workflowStepGates.resolvedAt),
        ),
      )
      .limit(1);

    if (!gate) {
      throw {
        statusCode: 404,
        message: 'Ask gate not found',
        errorCode: 'ask_not_found',
      };
    }

    // Verify run belongs to this task
    const taskIdForGate = await getTaskIdForGate(gate.workflowRunId);
    if (taskIdForGate && taskIdForGate !== taskId) {
      throw { statusCode: 404, message: 'Ask gate not found', errorCode: 'ask_not_found' };
    }

    const pool = gate.approverPoolSnapshot as string[] | null;
    if (!callerInPool(pool, callerUserId)) {
      throw {
        statusCode: 403,
        message: 'Not in submitter pool',
        errorCode: 'not_in_submitter_pool',
      };
    }

    let gateResolveEmit: (() => Promise<void>) | undefined;
    let askSubmittedEmit: (() => Promise<void>) | undefined;

    await db.transaction(async (tx) => {
      // Load the step run for this gate's run + stepId
      const [stepRun] = await tx
        .select()
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.runId, gate.workflowRunId),
            eq(workflowStepRuns.stepId, stepId),
          ),
        )
        .limit(1);

      if (!stepRun) {
        throw { statusCode: 404, message: 'Step run not found', errorCode: 'ask_not_found' };
      }

      const now = new Date();
      const outputJson = {
        submitted_by: callerUserId,
        submitted_at: now.toISOString(),
        values,
        skipped: false,
      };

      // Optimistic UPDATE: only succeeds if still awaiting_input
      const updated = await tx
        .update(workflowStepRuns)
        .set({
          status: 'completed',
          outputJson: outputJson as unknown as Record<string, unknown>,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowStepRuns.id, stepRun.id),
            eq(workflowStepRuns.status, 'awaiting_input'),
          ),
        )
        .returning({ id: workflowStepRuns.id });

      if (updated.length === 0) {
        // Lost race — re-read current state
        const [current] = await tx
          .select({ status: workflowStepRuns.status, outputJson: workflowStepRuns.outputJson })
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.id, stepRun.id));

        const priorOutput = current?.outputJson as Record<string, unknown> | null | undefined;
        throw {
          statusCode: 409,
          message: 'Already submitted',
          errorCode: 'already_submitted',
          submitted_by: (priorOutput?.submitted_by as string | undefined) ?? null,
          submitted_at: (priorOutput?.submitted_at as string | undefined) ?? now.toISOString(),
        };
      }

      // Resolve the gate
      const resolveResult = await WorkflowStepGateService.resolveGate(
        gate.id,
        'submitted',
        organisationId,
        tx,
      );
      gateResolveEmit = resolveResult.emitAfterCommit;

      // Stash ask.submitted emit for after commit
      if (taskId) {
        askSubmittedEmit = async () => {
          await TaskEventService.appendAndEmit({
            taskId,
            runId: null,
            organisationId,
            eventOrigin: 'gate',
            event: {
              kind: 'ask.submitted',
              payload: {
                gateId: gate.id,
                submittedBy: callerUserId,
                values: values as Record<string, unknown>,
              },
            },
          }).catch((err) => {
            logger.warn('ask_submitted_event_emit_failed', {
              event: 'task_event.ask_submitted_emit_failed',
              gateId: gate.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        };
      }
    });

    // Emit after commit
    if (gateResolveEmit) await gateResolveEmit();
    if (askSubmittedEmit) await askSubmittedEmit();

    return { ok: true };
  },

  async skip(
    taskId: string,
    stepId: string,
    organisationId: string,
    callerUserId: string,
  ): Promise<SkipResult> {
    // Load the gate (read outside tx)
    const [gate] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.stepId, stepId),
          eq(workflowStepGates.organisationId, organisationId),
          eq(workflowStepGates.gateKind, 'ask'),
          isNull(workflowStepGates.resolvedAt),
        ),
      )
      .limit(1);

    if (!gate) {
      throw {
        statusCode: 404,
        message: 'Ask gate not found',
        errorCode: 'ask_not_found',
      };
    }

    // Verify run belongs to this task
    const taskIdForGate = await getTaskIdForGate(gate.workflowRunId);
    if (taskIdForGate && taskIdForGate !== taskId) {
      throw { statusCode: 404, message: 'Ask gate not found', errorCode: 'ask_not_found' };
    }

    // Check allowSkip from step params
    const stepParams = await loadStepParams(gate.workflowRunId, stepId);
    const allowSkip = stepParams?.allowSkip === true || stepParams?.allow_skip === true;
    if (!allowSkip) {
      throw {
        statusCode: 400,
        message: 'Skip is not allowed for this step',
        errorCode: 'skip_not_allowed',
      };
    }

    const pool = gate.approverPoolSnapshot as string[] | null;
    if (!callerInPool(pool, callerUserId)) {
      throw {
        statusCode: 403,
        message: 'Not in submitter pool',
        errorCode: 'not_in_submitter_pool',
      };
    }

    let gateResolveEmit: (() => Promise<void>) | undefined;
    let askSkippedEmit: (() => Promise<void>) | undefined;

    await db.transaction(async (tx) => {
      // Load the step run for this gate's run + stepId
      const [stepRun] = await tx
        .select()
        .from(workflowStepRuns)
        .where(
          and(
            eq(workflowStepRuns.runId, gate.workflowRunId),
            eq(workflowStepRuns.stepId, stepId),
          ),
        )
        .limit(1);

      if (!stepRun) {
        throw { statusCode: 404, message: 'Step run not found', errorCode: 'ask_not_found' };
      }

      const now = new Date();
      const outputJson = {
        skipped: true,
        submitted_by: callerUserId,
        submitted_at: now.toISOString(),
        values: {},
      };

      // Optimistic UPDATE: only succeeds if still awaiting_input
      const updated = await tx
        .update(workflowStepRuns)
        .set({
          status: 'skipped',
          outputJson: outputJson as unknown as Record<string, unknown>,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowStepRuns.id, stepRun.id),
            eq(workflowStepRuns.status, 'awaiting_input'),
          ),
        )
        .returning({ id: workflowStepRuns.id });

      if (updated.length === 0) {
        const [current] = await tx
          .select({ status: workflowStepRuns.status, outputJson: workflowStepRuns.outputJson })
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.id, stepRun.id));

        const priorOutput = current?.outputJson as Record<string, unknown> | null | undefined;
        throw {
          statusCode: 409,
          message: 'Already resolved',
          errorCode: 'already_resolved',
          current_status: current?.status ?? 'unknown',
          submitted_by: (priorOutput?.submitted_by as string | undefined) ?? null,
          submitted_at: (priorOutput?.submitted_at as string | undefined) ?? now.toISOString(),
        };
      }

      // Resolve the gate
      const resolveResult = await WorkflowStepGateService.resolveGate(
        gate.id,
        'skipped',
        organisationId,
        tx,
      );
      gateResolveEmit = resolveResult.emitAfterCommit;

      // Stash ask.skipped emit for after commit
      if (taskId) {
        askSkippedEmit = async () => {
          await TaskEventService.appendAndEmit({
            taskId,
            runId: null,
            organisationId,
            eventOrigin: 'gate',
            event: {
              kind: 'ask.skipped',
              payload: {
                gateId: gate.id,
                submittedBy: callerUserId,
                stepId,
              },
            },
          }).catch((err) => {
            logger.warn('ask_skipped_event_emit_failed', {
              event: 'task_event.ask_skipped_emit_failed',
              gateId: gate.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        };
      }
    });

    // Emit after commit
    if (gateResolveEmit) await gateResolveEmit();
    if (askSkippedEmit) await askSkippedEmit();

    return { ok: true };
  },
};
