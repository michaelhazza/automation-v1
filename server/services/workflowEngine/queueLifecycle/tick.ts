import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { workflowRuns, workflowStepRuns } from '../../../db/schema/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { logger } from '../../../lib/logger.js';
import { emitOrgUpdate } from '../../../websocket/emitters.js';
import { upsertSubaccountOnboardingState } from '../../../lib/workflow/onboardingStateHelpers.js';
import { decideRunNextState } from '../../workflowRunPauseStopServicePure.js';
import { WorkflowRunPauseStopService } from '../../workflowRunPauseStopService.js';
import {
  assertValidTransition,
  InvalidTransitionError,
} from '../../../../shared/stateMachineGuards.js';
import { getStepCostEstimate } from '../../../lib/workflow/costEstimationDefaults.js';
import { enqueueTick, MAX_PARALLEL_STEPS_DEFAULT } from '../constants.js';
import { shouldSuppressWebSocket } from '../contextHelpers.js';
import { findStepInDefinition, loadDefinitionForRun } from '../definitionHelpers.js';
import {
  computeReadySet,
  materialisePendingStepRuns,
  emitWorkflowEvent,
  finaliseRunKnowledgeBindings,
  finaliseBaselineArtefactCapture,
} from '../readySet.js';
import {
  handleBulkFanOut,
  checkBulkParentCompletion,
} from '../stepLifecycle.js';
import { dispatchStep } from './dispatch.js';
import type { WorkflowRun } from '../types.js';
import type { HandlerContext } from '../../handlerContextTypes.js';

export async function tick(runId: string, handlerContext: HandlerContext): Promise<void> {
  // Layer 2 — non-blocking advisory lock (contention detection only).
  // pg_try_advisory_xact_lock runs in auto-commit mode so the lock releases
  // at statement end. pg-boss singletonKey is the load-bearing serialisation
  // defence; the advisory lock is an early-exit only.
  // guard-ignore: with-org-tx-or-scoped-db reason="advisory-lock — session-scope requires bare db handle; pg_advisory_lock cannot run inside a scoped transaction"
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${'workflow-run:' + runId})::bigint) AS got`
  );
  const lockRow = (lockResult as unknown as { rows?: Array<{ got: boolean }> }).rows?.[0];
  if (lockRow && lockRow.got === false) {
    logger.debug('workflow_tick_lock_contended', { runId });
    return;
  }

  // guard-ignore: with-org-tx-or-scoped-db reason="cross-org run lookup by ID before organisationId is known — entrypoint for WF4 re-wire"
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run) return;
  if (
    run.status === 'completed' ||
    run.status === 'completed_with_errors' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  ) {
    return;
  }

  // All subsequent DB operations use the org-scoped connection now that
  // run.organisationId is available (WF4 pattern).
  const scopedDb = getOrgScopedDb('workflowEngine.tick');

  // §5.11 kill switch: allow cancellation to settle once no steps are running.
  if (run.status === 'cancelling') {
    const stillRunning = await scopedDb
      .select({ id: workflowStepRuns.id })
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.runId, runId), eq(workflowStepRuns.status, 'running')));
    if (stillRunning.length === 0) {
      const cancelledAt = new Date();
      await scopedDb
        .update(workflowRuns)
        .set({ status: 'cancelled', completedAt: cancelledAt, updatedAt: cancelledAt })
        .where(eq(workflowRuns.id, runId));
      await upsertSubaccountOnboardingState({
        runId,
        organisationId: run.organisationId,
        subaccountId: run.subaccountId,
        workflowSlug: run.workflowSlug,
        isOnboardingRun: run.isOnboardingRun,
        runStatus: 'cancelled',
        startedAt: run.startedAt,
        completedAt: cancelledAt,
      });
      logger.info('workflow_run_cancelled', { event: 'run.cancelled', runId });
      await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
        status: 'cancelled',
      });
      emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
        source: 'workflow_run',
        runId,
        status: 'cancelled',
      });
    }
    return;
  }

  const def = await loadDefinitionForRun(run);
  if (!def) {
    logger.error('workflow_definition_missing', { runId });
    return;
  }

  // Sprint 4 P3.1: bulk mode fan-out
  if (run.runMode === 'bulk' && !run.parentRunId) {
    const handled = await handleBulkFanOut(run, def);
    if (handled) return;
  }

  // Sprint 4 P3.1: bulk parent completion check
  if (run.runMode === 'bulk' && !run.parentRunId) {
    await checkBulkParentCompletion(run);
    return;
  }

  let stepRunRows = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.runId, runId));

  let liveStepRuns = stepRunRows.filter(
    (s) => s.status !== 'invalidated' && s.status !== 'failed'
  );

  const materialised = await materialisePendingStepRuns(runId, def, liveStepRuns);
  if (materialised > 0) {
    stepRunRows = await scopedDb
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.runId, runId));
    liveStepRuns = stepRunRows.filter(
      (s) => s.status !== 'invalidated' && s.status !== 'failed'
    );
  }

  const ready = computeReadySet(def, liveStepRuns);
  const currentlyRunning = liveStepRuns.filter((s) => s.status === 'running').length;

  if (ready.length === 0) {
    const completedSteps = liveStepRuns.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );
    const allDone = completedSteps.length === def.steps.length;
    const anyAwaiting = liveStepRuns.some(
      (s) => s.status === 'awaiting_input' || s.status === 'awaiting_approval'
    );
    const anyRunning = currentlyRunning > 0;

    if (allDone) {
      const anyContinueFailures = stepRunRows.some(
        (s) =>
          s.status === 'failed' &&
          findStepInDefinition(def, s.stepId)?.failurePolicy === 'continue'
      );
      const finalStatus: WorkflowRun['status'] = anyContinueFailures
        ? 'completed_with_errors'
        : 'completed';

      // §8 — fire knowledgeBindings[] BEFORE the terminal status write.
      try {
        await finaliseRunKnowledgeBindings(run, def, liveStepRuns);
      } catch (err) {
        logger.error('workflow_knowledge_bindings_finalise_failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // F1 §3 — per-step artefact status update for baseline-artefacts-capture.
      if (
        run.workflowSlug === 'baseline-artefacts-capture' &&
        run.subaccountId !== null &&
        run.startedByUserId !== null
      ) {
        await finaliseBaselineArtefactCapture(
          runId,
          run.subaccountId,
          run.organisationId,
          run.startedByUserId,
          liveStepRuns,
        );
      }

      const completedAt = new Date();
      await scopedDb
        .update(workflowRuns)
        .set({ status: finalStatus, completedAt, updatedAt: completedAt })
        .where(eq(workflowRuns.id, runId));
      await upsertSubaccountOnboardingState({
        runId,
        organisationId: run.organisationId,
        subaccountId: run.subaccountId,
        workflowSlug: run.workflowSlug,
        isOnboardingRun: run.isOnboardingRun,
        runStatus: finalStatus,
        startedAt: run.startedAt,
        completedAt,
      });
      logger.info('workflow_run_completed', {
        event: finalStatus === 'completed' ? 'run.completed' : 'run.completed_with_errors',
        runId,
        totalSteps: def.steps.length,
      });
      await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
        status: finalStatus,
        completedSteps: completedSteps.length,
        totalSteps: def.steps.length,
      }, { suppressWebSocket: shouldSuppressWebSocket(run.runMode) });

      if (['completed', 'completed_with_errors'].includes(finalStatus)) {
        emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
          source: 'workflow_run',
          runId,
          status: finalStatus,
        });
      }

      // Sprint 4 P3.1: if this is a bulk child, re-tick the parent
      if (run.parentRunId) {
        await enqueueTick(run.parentRunId);
      }
      return;
    }

    if (!anyRunning && !anyAwaiting) {
      const blockingStep = liveStepRuns.find(
        (s) => s.status !== 'completed' && s.status !== 'skipped'
      );
      if (blockingStep) {
        logger.info('run_completion_blocked_by_open_step', {
          runId,
          organisationId: run.organisationId,
          blockingStepId: blockingStep.stepId,
          blockingStepStatus: blockingStep.status,
        });
      }
    }
    let aggregate: WorkflowRun['status'] = run.status;
    if (anyRunning) aggregate = 'running';
    else if (anyAwaiting) {
      const anyAwaitingInput = liveStepRuns.some((s) => s.status === 'awaiting_input');
      aggregate = anyAwaitingInput ? 'awaiting_input' : 'awaiting_approval';
    }
    if (aggregate !== run.status) {
      await scopedDb
        .update(workflowRuns)
        .set({ status: aggregate, updatedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    }
    return;
  }

  // §5.2 step 3: parallelism cap.
  const maxParallel = def.maxParallelSteps ?? MAX_PARALLEL_STEPS_DEFAULT;
  const capacity = Math.max(0, maxParallel - currentlyRunning);
  const toDispatch = ready.slice(0, capacity);

  if (run.status !== 'running') {
    await scopedDb
      .update(workflowRuns)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
      status: 'running',
      completedSteps: liveStepRuns.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
      totalSteps: def.steps.length,
    });
  }

  // §7 between-step runaway check — fires before dispatching any next step.
  if (toDispatch.length > 0) {
    const capCheckResult = await scopedDb.execute(
      sql`SELECT cost_accumulator_cents,
                 EXTRACT(EPOCH FROM (now() - started_at))::integer AS elapsed_seconds
          FROM workflow_runs
          WHERE id = ${runId}`,
    );
    const capRow = (capCheckResult as unknown as { rows?: Array<{ cost_accumulator_cents: number; elapsed_seconds: number }> }).rows?.[0];
    if (capRow) {
      const capDecision = decideRunNextState({
        currentStatus: 'running',
        currentCostCents: capRow.cost_accumulator_cents,
        currentElapsedSeconds: capRow.elapsed_seconds,
        effectiveCostCeilingCents: run.effectiveCostCeilingCents,
        effectiveWallClockCapSeconds: run.effectiveWallClockCapSeconds,
      });
      if (capDecision.shouldPause) {
        await WorkflowRunPauseStopService.pauseRun(
          runId,
          run.organisationId,
          'system',
          capDecision.reason as 'cost_ceiling' | 'wall_clock',
        );
        logger.info('workflow_engine_between_step_pause', {
          runId,
          reason: capDecision.reason,
          costCents: capRow.cost_accumulator_cents,
          elapsedSeconds: capRow.elapsed_seconds,
        });
        return;
      }
    }
  }

  for (const step of toDispatch) {
    // Pre-dispatch: re-read run status to catch external pause/cancel/fail.
    const [freshRun] = await scopedDb
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    if (
      freshRun &&
      (freshRun.status === 'cancelled' ||
        freshRun.status === 'failed' ||
        freshRun.status === 'paused')
    ) {
      logger.info('workflow_engine_dispatch_aborted', {
        runId,
        stepId: step.id,
        status: freshRun.status,
      });
      return;
    }

    // Pre-step cost-cap check.
    if (run.effectiveCostCeilingCents !== null) {
      const costEstimate = (step.params?.estimatedCostCents as number | undefined) ?? getStepCostEstimate(step.type ?? '');
      const latestCostResult = await scopedDb.execute(
        sql`SELECT cost_accumulator_cents FROM workflow_runs WHERE id = ${runId}`,
      );
      const latestCostRow = (latestCostResult as unknown as { rows?: Array<{ cost_accumulator_cents: number }> }).rows?.[0];
      const latestCost = latestCostRow?.cost_accumulator_cents ?? 0;
      if (latestCost + costEstimate >= run.effectiveCostCeilingCents) {
        await WorkflowRunPauseStopService.pauseRun(
          runId,
          run.organisationId,
          'system',
          'cost_ceiling',
        );
        logger.info('workflow_engine_pre_step_pause', {
          runId,
          stepId: step.id,
          stepType: step.type,
          costEstimate,
          latestCost,
          ceiling: run.effectiveCostCeilingCents,
        });
        return;
      }
    }

    try {
      await dispatchStep(run, def, step, liveStepRuns, handlerContext);
    } catch (err) {
      logger.error('workflow_dispatch_error', {
        runId,
        stepId: step.id,
        error: err instanceof Error ? err.message : String(err),
      });
      const sr = liveStepRuns.find((s) => s.stepId === step.id);
      if (sr) {
        try {
          assertValidTransition({
            kind: 'workflow_step_run',
            recordId: sr.id,
            from: sr.status,
            to: 'failed',
          });
          await scopedDb
            .update(workflowStepRuns)
            .set({
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              completedAt: new Date(),
              version: sr.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(workflowStepRuns.id, sr.id));
        } catch (assertErr) {
          if (assertErr instanceof InvalidTransitionError) {
            logger.warn('workflow_step_invalid_transition_skipped', {
              event: 'state_machine.invalid_transition',
              kind: assertErr.kind,
              recordId: assertErr.recordId,
              from: assertErr.from,
              to: assertErr.to,
              via: 'dispatch_error_path',
            });
          } else {
            throw assertErr;
          }
        }
      }
      await enqueueTick(runId);
    }
  }
}
