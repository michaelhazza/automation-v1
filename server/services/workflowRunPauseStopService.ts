/**
 * workflowRunPauseStopService.ts — impure pause / resume / stop operations.
 *
 * These methods write to `workflow_runs` via DB transactions. They call
 * WorkflowStepGateService and WorkflowEngineService where required but never
 * open their own transactions when called from within the engine (the `tx`
 * parameter lets the engine own the transaction boundary).
 *
 * Spec: tasks/Workflows-spec.md §5.7 (cost/wall-clock runaway protection).
 */

import { eq, and, sql, notInArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { OrgScopedTx } from '../db/index.js';
import { workflowRuns } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { assertValidTransition } from '../../shared/stateMachineGuards.js';
import type { PauseReason } from './workflowRunPauseStopServicePure.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PauseResult {
  paused: boolean;
  current_status?: string;
}

export interface ResumeOptions {
  extendCostCents?: number;
  extendSeconds?: number;
}

export interface StopResult {
  stopped: boolean;
  reason?: 'already_terminal';
  current_status?: string;
}

// Terminal statuses that block further transitions.
const TERMINAL_STATUSES = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'partial',
] as const;

// ─── Service ─────────────────────────────────────────────────────────────────

export const WorkflowRunPauseStopService = {
  /**
   * Pause an actively-running workflow run.
   *
   * - Transitions `running → paused` via an optimistic UPDATE WHERE status='running'.
   * - Pause does NOT cascade open gates — gates remain open so the operator can
   *   still act on them after resuming.
   * - Returns `{ paused: false, current_status }` if the run was not in
   *   `running` status (e.g. already paused or terminal).
   */
  async pauseRun(
    runId: string,
    organisationId: string,
    _userId: string,
    reason: PauseReason | 'operator'
  ): Promise<PauseResult> {
    const result = await db.transaction(async (tx) => {
      assertValidTransition({
        kind: 'workflow_run',
        recordId: runId,
        from: 'running',
        to: 'paused',
      });

      const updated = await tx
        .update(workflowRuns)
        .set({
          status: 'paused',
          degradationReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.organisationId, organisationId),
            eq(workflowRuns.status, 'running')
          )
        )
        .returning({ id: workflowRuns.id });

      if (updated.length === 0) {
        const [current] = await tx
          .select({ status: workflowRuns.status })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.id, runId),
              eq(workflowRuns.organisationId, organisationId)
            )
          );
        return { paused: false, current_status: current?.status ?? 'unknown' };
      }

      return { paused: true };
    });

    if (result.paused) {
      logger.info('workflow_run_paused', {
        event: 'run.paused',
        runId,
        organisationId,
        reason,
      });
    }

    return result;
  },

  /**
   * Resume a paused workflow run, optionally extending cost/time caps.
   *
   * Rules:
   * - If the run was paused due to `cost_ceiling` or `wall_clock`, an extension
   *   is required (throws 400 `extension_required` otherwise).
   * - At most 2 extensions are allowed per run (throws 400 `extension_cap_reached`).
   * - On race: throws 409 `race_with_other_action`.
   * - After transaction: enqueues a tick to restart execution.
   */
  async resumeRun(
    runId: string,
    organisationId: string,
    _userId: string,
    opts: ResumeOptions
  ): Promise<{ resumed: boolean }> {
    // Pre-flight: load run state outside the transaction.
    const [run] = await db
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        degradationReason: workflowRuns.degradationReason,
        extensionCount: workflowRuns.extensionCount,
        organisationId: workflowRuns.organisationId,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));

    if (!run) {
      throw { statusCode: 404, message: 'Workflow run not found' };
    }
    if (run.organisationId !== organisationId) {
      throw { statusCode: 404, message: 'Workflow run not found' };
    }
    if (run.status !== 'paused') {
      throw {
        statusCode: 409,
        message: `Run is not paused (current status: ${run.status})`,
        errorCode: 'run_not_paused',
        current_status: run.status,
      };
    }

    const capTriggered =
      run.degradationReason === 'cost_ceiling' || run.degradationReason === 'wall_clock';

    if (capTriggered && !opts.extendCostCents && !opts.extendSeconds) {
      throw {
        statusCode: 400,
        message: `Run was paused due to ${run.degradationReason}; an extension (extendCostCents or extendSeconds) is required to resume`,
        errorCode: 'extension_required',
        cap: run.degradationReason,
      };
    }

    if ((run.extensionCount ?? 0) >= 2) {
      throw {
        statusCode: 400,
        message: 'Maximum of 2 extensions per run has been reached',
        errorCode: 'extension_cap_reached',
      };
    }

    await db.transaction(async (tx) => {
      assertValidTransition({
        kind: 'workflow_run',
        recordId: runId,
        from: 'paused',
        to: 'running',
      });

      const costDelta = opts.extendCostCents ?? 0;
      const timeDelta = opts.extendSeconds ?? 0;

      const updated = await tx
        .update(workflowRuns)
        .set({
          status: 'running',
          degradationReason: null,
          extensionCount: sql`${workflowRuns.extensionCount} + 1`,
          effectiveCostCeilingCents:
            costDelta > 0
              ? sql`COALESCE(${workflowRuns.effectiveCostCeilingCents}, 0) + ${costDelta}`
              : workflowRuns.effectiveCostCeilingCents,
          effectiveWallClockCapSeconds:
            timeDelta > 0
              ? sql`COALESCE(${workflowRuns.effectiveWallClockCapSeconds}, 0) + ${timeDelta}`
              : workflowRuns.effectiveWallClockCapSeconds,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.organisationId, organisationId),
            eq(workflowRuns.status, 'paused')
          )
        )
        .returning({ id: workflowRuns.id });

      if (updated.length === 0) {
        const [current] = await tx
          .select({ status: workflowRuns.status })
          .from(workflowRuns)
          .where(eq(workflowRuns.id, runId));
        throw {
          statusCode: 409,
          message: 'Race with another action — run status changed',
          errorCode: 'race_with_other_action',
          current_status: current?.status ?? 'unknown',
        };
      }
    });

    logger.info('workflow_run_resumed', {
      event: 'run.resumed',
      runId,
      organisationId,
      extendCostCents: opts.extendCostCents,
      extendSeconds: opts.extendSeconds,
    });

    // Enqueue a tick to restart execution after the transaction has committed.
    // Lazy import to avoid a circular reference at module load time.
    const { WorkflowEngineService } = await import('./workflowEngineService.js');
    await WorkflowEngineService.enqueueTick(runId);

    return { resumed: true };
  },

  /**
   * Stop (hard-fail) a workflow run. Transitions to `failed` with
   * `degradation_reason = 'stopped_by_user'`.
   *
   * - Cascades open gates before the status write (run_terminated reason).
   * - Idempotent on already-terminal runs.
   */
  async stopRun(
    runId: string,
    organisationId: string,
    _userId: string
  ): Promise<StopResult> {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({
          id: workflowRuns.id,
          status: workflowRuns.status,
          organisationId: workflowRuns.organisationId,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, runId),
            eq(workflowRuns.organisationId, organisationId)
          )
        );

      if (!run) {
        throw { statusCode: 404, message: 'Workflow run not found' };
      }

      if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
        return {
          stopped: false,
          reason: 'already_terminal' as const,
          current_status: run.status,
        };
      }

      // Cascade open gates before transitioning to terminal.
      const { resolved } = await WorkflowStepGateService.resolveOpenGatesForRun(
        runId,
        'run_terminated',
        organisationId,
        tx
      );
      if (resolved > 0) {
        logger.info('workflow_step_gates_cascade_resolved', {
          event: 'gates.cascade_resolved',
          runId,
          resolved,
          reason: 'run_terminated',
        });
      }

      assertValidTransition({
        kind: 'workflow_run',
        recordId: runId,
        from: run.status,
        to: 'failed',
      });

      await tx
        .update(workflowRuns)
        .set({
          status: 'failed',
          degradationReason: 'stopped_by_user',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.id, runId),
            notInArray(workflowRuns.status, [
              'completed',
              'completed_with_errors',
              'failed',
              'cancelled',
              'partial',
            ])
          )
        );

      return { stopped: true };
    });

    if (result.stopped) {
      logger.info('workflow_run_stopped', {
        event: 'run.stopped',
        runId,
        organisationId,
      });
    }

    return result;
  },

  /**
   * Pause a run between steps due to an automated cap breach.
   *
   * Called from the engine tick loop. Accepts `tx` — the engine owns the
   * transaction boundary. Does NOT cascade gates (paused runs retain open
   * gates so the operator can act on them after resuming).
   */
  async pauseRunBetweenSteps(
    runId: string,
    _organisationId: string,
    capType: 'cost_ceiling' | 'wall_clock',
    tx: OrgScopedTx
  ): Promise<{ paused: boolean }> {
    assertValidTransition({
      kind: 'workflow_run',
      recordId: runId,
      from: 'running',
      to: 'paused',
    });

    const updated = await tx
      .update(workflowRuns)
      .set({
        status: 'paused',
        degradationReason: capType,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.status, 'running')
        )
      )
      .returning({ id: workflowRuns.id });

    const paused = updated.length > 0;

    if (paused) {
      logger.info('workflow_run_paused_by_cap', {
        event: 'run.paused_by_cap',
        runId,
        capType,
      });
    }

    return { paused };
  },
};
