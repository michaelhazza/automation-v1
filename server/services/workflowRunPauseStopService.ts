/**
 * WorkflowRunPauseStopService — impure service for operator-initiated pause/resume/stop
 * and system-initiated cap-triggered pauses.
 *
 * Spec: tasks/Workflows-spec.md §7 (pause card, between-step semantics, resume API
 * with extension, stop API, run-completion invariant). Decision 12 (cost_accumulator_cents).
 *
 * Thin DB-facing counterpart to workflowRunPauseStopServicePure.ts (pure logic).
 */

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { emitWorkflowRunUpdate } from '../websocket/emitters.js';
import { assertValidTransition } from '../../shared/stateMachineGuards.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { getStepCostEstimate } from '../lib/workflow/costEstimationDefaults.js';
import type { PauseReason } from './workflowRunPauseStopServicePure.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';

const TERMINAL_STATUSES = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'partial',
] as const;

type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

function isTerminal(status: string): status is TerminalStatus {
  return TERMINAL_STATUSES.includes(status as TerminalStatus);
}

export const WorkflowRunPauseStopService = {
  /**
   * Pause a running workflow run.
   *
   * Validates the running→paused transition, updates status in a transaction,
   * and emits a run-level update event.
   */
  async pauseRun(
    runId: string,
    organisationId: string,
    userId: string,
    reason: PauseReason,
  ): Promise<{ paused: boolean; reason?: string }> {
    // No assertValidTransition here: the WHERE status='running' guard in the
    // UPDATE below is the actual safety mechanism. A hardcoded 'running' assertion
    // before reading the DB provides no additional protection.
    let updated: (typeof workflowRuns.$inferSelect)[] = [];
    await db.transaction(async (tx) => {
      updated = await tx
        .update(workflowRuns)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.organisationId, organisationId),
            eq(workflowRuns.status, 'running'),
          ),
        )
        .returning();
    });

    if (updated.length === 0) {
      return { paused: false, reason: 'not_running' };
    }

    logger.info('workflow_run_paused', {
      event: 'run.paused',
      runId,
      organisationId,
      reason,
      actorId: userId,
    });

    emitWorkflowRunUpdate(runId, 'Workflow:run:paused', { reason, actorId: userId });

    // Chunk 9: emit to task event stream.
    const pausedRun = updated[0];
    if (pausedRun.taskId) {
      const taskEvent = reason === 'by_user'
        ? { kind: 'run.paused.by_user' as const, payload: { actorId: userId } }
        : reason === 'cost_ceiling'
        ? { kind: 'run.paused.cost_ceiling' as const, payload: { capValue: pausedRun.effectiveCostCeilingCents ?? 0, currentCost: pausedRun.costAccumulatorCents } }
        : { kind: 'run.paused.wall_clock' as const, payload: { capValue: pausedRun.effectiveWallClockCapSeconds ?? 0, currentElapsed: 0 } };
      void appendAndEmitTaskEvent(
        {
          taskId: pausedRun.taskId,
          organisationId: pausedRun.organisationId,
          subaccountId: pausedRun.subaccountId,
        },
        'user',
        taskEvent,
      );
    }

    return { paused: true };
  },

  /**
   * Resume a paused workflow run, optionally extending cost/wall-clock caps.
   *
   * Enforces:
   *   - Run must be paused
   *   - Extension required when pause was cap-triggered and no opts provided
   *   - Extension count cap (max 2)
   *   - Optimistic CAS: WHERE status='paused' (0 rows = race_with_other_action)
   */
  async resumeRun(
    runId: string,
    organisationId: string,
    userId: string,
    opts?: { extendCostCents?: number; extendSeconds?: number },
  ): Promise<{
    resumed: boolean;
    reason?: string;
    extensionCount?: number;
    currentStatus?: string;
    cap?: 'cost_ceiling' | 'wall_clock';
  }> {
    // Load run.
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(
        and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)),
      );

    if (!run) {
      throw { statusCode: 404, message: 'Workflow run not found' };
    }

    if (run.status !== 'paused') {
      return { resumed: false, reason: 'not_paused' };
    }

    // Compute elapsed seconds using DB clock — never Date.now().
    const elapsedResult = await db.execute(
      sql`SELECT EXTRACT(EPOCH FROM (now() - ${workflowRuns.startedAt}))::integer AS elapsed_seconds
          FROM ${workflowRuns}
          WHERE ${workflowRuns.id} = ${runId}`,
    );
    const elapsedRows = (elapsedResult as unknown as { rows?: Array<{ elapsed_seconds: number }> }).rows;
    const elapsedSeconds: number = elapsedRows?.[0]?.elapsed_seconds ?? 0;

    // Determine if the pause was cap-triggered.
    const costCeiling = run.effectiveCostCeilingCents;
    const wallClockCap = run.effectiveWallClockCapSeconds;
    const capTriggered =
      (costCeiling !== null && run.costAccumulatorCents >= costCeiling) ||
      (wallClockCap !== null && elapsedSeconds >= wallClockCap);

    // Extension count cap: check before capTriggered so client gets the terminal
    // error immediately without needing to first provide extension opts.
    // Returns a structured result (not a throw) so the route handler can render
    // the spec §7 flat-shape response without manual try/catch in the route layer.
    if (run.extensionCount >= 2) {
      return { resumed: false, reason: 'extension_cap_reached' };
    }

    if (capTriggered && !opts?.extendCostCents && !opts?.extendSeconds) {
      const capKind: 'cost_ceiling' | 'wall_clock' =
        costCeiling !== null && run.costAccumulatorCents >= costCeiling
          ? 'cost_ceiling'
          : 'wall_clock';
      return { resumed: false, reason: 'extension_required', cap: capKind };
    }

    // Pre-step cost-cap check: use conservative agent_call estimate (50 cents).
    const nextStepEstimate = getStepCostEstimate('agent_call');
    const newEffectiveCost = (costCeiling ?? Infinity) + (opts?.extendCostCents ?? 0);
    if (
      costCeiling !== null &&
      !opts?.extendCostCents &&
      run.costAccumulatorCents + nextStepEstimate >= newEffectiveCost
    ) {
      // Re-pause immediately — ceiling still exceeded after accounting for next step cost.
      return { resumed: false, reason: 'cost_ceiling_still_exceeded' };
    }

    // Determine if this resume includes an extension.
    const hasExtension = !!(opts?.extendCostCents || opts?.extendSeconds);

    // Validate transition before write.
    assertValidTransition({
      kind: 'workflow_run',
      recordId: runId,
      from: 'paused',
      to: 'running',
    });

    // Single transaction: update status + apply extensions.
    let updatedRows: (typeof workflowRuns.$inferSelect)[] = [];
    await db.transaction(async (tx) => {
      updatedRows = await tx
        .update(workflowRuns)
        .set({
          status: 'running',
          effectiveCostCeilingCents: costCeiling !== null
            ? costCeiling + (opts?.extendCostCents ?? 0)
            : null,
          effectiveWallClockCapSeconds: wallClockCap !== null
            ? wallClockCap + (opts?.extendSeconds ?? 0)
            : null,
          extensionCount: run.extensionCount + (hasExtension ? 1 : 0),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.status, 'paused'),
          ),
        )
        .returning();
    });

    if (updatedRows.length === 0) {
      // Race: another action transitioned the run out of 'paused'. Load fresh status.
      const [freshRun] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId));
      return { resumed: false, reason: 'race_with_other_action', currentStatus: freshRun?.status };
    }

    const finalRun = updatedRows[0];

    logger.info('workflow_run_resumed', {
      event: 'run.resumed',
      runId,
      organisationId,
      actorId: userId,
      extendCostCents: opts?.extendCostCents,
      extendSeconds: opts?.extendSeconds,
      extensionCount: finalRun.extensionCount,
    });

    emitWorkflowRunUpdate(runId, 'Workflow:run:resumed', {
      actorId: userId,
      extendCostCents: opts?.extendCostCents ?? null,
      extendSeconds: opts?.extendSeconds ?? null,
    });

    // Chunk 9: emit to task event stream.
    if (finalRun.taskId) {
      void appendAndEmitTaskEvent(
        {
          taskId: finalRun.taskId,
          organisationId: finalRun.organisationId,
          subaccountId: finalRun.subaccountId,
        },
        'user',
        {
          kind: 'run.resumed',
          payload: {
            actorId: userId,
            extensionCostCents: opts?.extendCostCents,
            extensionSeconds: opts?.extendSeconds,
          },
        },
      );
    }

    return { resumed: true, extensionCount: finalRun.extensionCount };
  },

  /**
   * Stop a workflow run (any non-terminal status → failed).
   *
   * Cascades orphaned gates inside the same transaction as the status update.
   */
  async stopRun(
    runId: string,
    organisationId: string,
    userId: string,
  ): Promise<{ stopped: boolean; reason?: string; currentStatus?: string }> {
    // Load run.
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(
        and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)),
      );

    if (!run) {
      throw { statusCode: 404, message: 'Workflow run not found' };
    }

    if (isTerminal(run.status)) {
      return { stopped: false, reason: 'already_terminal', currentStatus: run.status };
    }

    assertValidTransition({ kind: 'workflow_run', recordId: runId, from: run.status, to: 'failed' });

    let stoppedRows: (typeof workflowRuns.$inferSelect)[] = [];
    await db.transaction(async (tx) => {
      // Cascade orphaned gates before status update (invariant).
      const { resolved } = await WorkflowStepGateService.resolveOpenGatesForRun(
        runId,
        organisationId,
        tx,
      );
      if (resolved > 0) {
        logger.info('workflow_run_gates_cascaded', {
          runId,
          resolved,
          trigger: 'stopRun',
        });
      }

      stoppedRows = await tx
        .update(workflowRuns)
        .set({
          status: 'failed',
          error: 'stopped_by_user',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.organisationId, organisationId),
            // Optimistic guard: only update non-terminal rows.
            sql`${workflowRuns.status} NOT IN ('completed', 'completed_with_errors', 'failed', 'cancelled', 'partial')`,
          ),
        )
        .returning();
    });

    if (stoppedRows.length === 0) {
      // Race: run reached a terminal status between the pre-check and the write.
      const [freshRun] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId));
      return { stopped: false, reason: 'race_with_other_action', currentStatus: freshRun?.status };
    }

    logger.info('workflow_run_stopped', {
      event: 'run.stopped',
      runId,
      organisationId,
      actorId: userId,
    });

    emitWorkflowRunUpdate(runId, 'Workflow:run:stopped', { actorId: userId });

    // Chunk 9: emit to task event stream.
    const stoppedRun = stoppedRows[0];
    if (stoppedRun.taskId) {
      void appendAndEmitTaskEvent(
        {
          taskId: stoppedRun.taskId,
          organisationId: stoppedRun.organisationId,
          subaccountId: stoppedRun.subaccountId,
        },
        'user',
        {
          kind: 'run.stopped.by_user',
          payload: { actorId: userId },
        },
      );
    }

    return { stopped: true };
  },
};
