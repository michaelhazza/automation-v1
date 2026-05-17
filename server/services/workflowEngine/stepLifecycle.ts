import { eq, and, sql, isNull, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import type { DB } from '../../db/index.js';
import {
  workflowRuns,
  workflowStepRuns,
  subaccounts,
  organisations,
} from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { hashValue } from '../../lib/workflow/hash.js';
import { emitOrgUpdate, emitWorkflowRunUpdate } from '../../websocket/emitters.js';
import { insertRunRowWithUniqueGuard } from '../workflowRunInsertHelper.js';
import { taskService } from '../taskService.js';
import { WorkflowRunCostLedgerService } from '../workflowRunCostLedgerService.js';
import { getStepCostEstimate } from '../../lib/workflow/costEstimationDefaults.js';
import { assertValidTransition } from '../../../shared/stateMachineGuards.js';
import { invokeAutomationStep } from '../invokeAutomationStepService.js';
import { upsertSubaccountOnboardingState } from '../../lib/workflow/onboardingStateHelpers.js';
import { writeReferenceFromBinding } from '../knowledgeService.js';
import { enqueueTick, MAX_PARALLEL_STEPS_DEFAULT } from './constants.js';
import {
  withInvalidationGuard,
  assertContextSize,
  mergeStepOutputIntoContext,
  shouldSuppressWebSocket,
} from './contextHelpers.js';
import {
  loadDefinitionForRun,
  findStepInDefinition,
  createStepRunsForNewRun,
} from './definitionHelpers.js';
import { emitWorkflowEvent } from './readySet.js';
import type {
  WorkflowRun,
  WorkflowStepRun,
  WorkflowDefinition,
  WorkflowStep,
  RunContext,
  InvokeAutomationStep,
} from './types.js';
import { requireSubaccountId } from './types.js';

export async function failStepRunInternal(sr: WorkflowStepRun, reason: string): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.failStepRunInternal');
  await scopedDb
    .update(workflowStepRuns)
    .set({
      status: 'failed',
      error: reason,
      completedAt: new Date(),
      version: sr.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(workflowStepRuns.id, sr.id));
  await enqueueTick(sr.runId);
}

/**
 * Computes the transitive downstream set of step ids that depend on the
 * given seed step. BFS over dependsOn edges. Returns step ids in
 * topological order (closest first).
 */
export function computeDownstreamSet(def: WorkflowDefinition, seedStepId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const s of def.steps) childrenOf.set(s.id, []);
  for (const s of def.steps) {
    for (const dep of s.dependsOn) {
      if (childrenOf.has(dep)) childrenOf.get(dep)!.push(s.id);
    }
  }
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: string[] = [...(childrenOf.get(seedStepId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (!visited.has(child)) queue.push(child);
    }
  }
  return result;
}

/**
 * Handles the bulk fan-out for a parent run. Reads `bulkTargets` from
 * contextJson and creates one child run per target subaccount. Each child
 * shares the same templateVersionId and runs in `auto` mode. Returns true
 * if fan-out was performed (or already done), false if no bulkTargets.
 */
export async function handleBulkFanOut(run: WorkflowRun, _def: WorkflowDefinition): Promise<boolean> {
  const scopedDb = getOrgScopedDb('workflowEngineService.handleBulkFanOut');
  const ctx = run.contextJson as Record<string, unknown>;
  const bulkTargets = ctx.bulkTargets as string[] | undefined;
  if (!bulkTargets || !Array.isArray(bulkTargets) || bulkTargets.length === 0) {
    logger.warn('workflow_bulk_no_targets', { runId: run.id });
    return false;
  }

  const existingChildren = await scopedDb
    .select({ id: workflowRuns.id, targetSubaccountId: workflowRuns.targetSubaccountId })
    .from(workflowRuns)
    .where(eq(workflowRuns.parentRunId, run.id));

  if (existingChildren.length >= bulkTargets.length) {
    return true;
  }

  const existingTargets = new Set(
    existingChildren.map((c) => c.targetSubaccountId).filter(Boolean)
  );

  const validSubs = await scopedDb
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(
      and(
        inArray(subaccounts.id, bulkTargets),
        eq(subaccounts.organisationId, run.organisationId),
        isNull(subaccounts.deletedAt),
      ),
    );
  const validSubIds = new Set(validSubs.map((s) => s.id));
  const invalidTargets = bulkTargets.filter((t) => !validSubIds.has(t));
  if (invalidTargets.length > 0) {
    logger.warn('workflow_bulk_invalid_targets', {
      runId: run.id,
      invalidTargets,
      orgId: run.organisationId,
    });
  }

  if (run.status === 'pending') {
    await scopedDb
      .update(workflowRuns)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));
  }

  const [org] = await scopedDb
    .select({ ghlConcurrencyCap: organisations.ghlConcurrencyCap })
    .from(organisations)
    .where(eq(organisations.id, run.organisationId));
  const concurrencyCap = org?.ghlConcurrencyCap ?? MAX_PARALLEL_STEPS_DEFAULT;

  const childStatuses = await scopedDb
    .select({ id: workflowRuns.id, status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.parentRunId, run.id));
  const activeChildCount = childStatuses.filter(
    (c) => !['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status)
  ).length;
  const slotsAvailable = Math.max(0, concurrencyCap - activeChildCount);

  let created = 0;
  for (const targetId of bulkTargets) {
    if (existingTargets.has(targetId)) continue;
    if (!validSubIds.has(targetId)) continue;
    if (created >= slotsAvailable) break;

    try {
      const childTask = await taskService.createTask(run.organisationId, targetId, {
        title: `Workflow run`,
        status: 'inbox',
      }, run.startedByUserId ?? undefined);
      const childRun = await insertRunRowWithUniqueGuard(
        scopedDb as unknown as DB,
        {
          organisationId: run.organisationId,
          subaccountId: targetId,
          templateVersionId: run.templateVersionId,
          runMode: 'auto',
          status: 'pending',
          contextJson: ctx,
          parentRunId: run.id,
          targetSubaccountId: targetId,
          startedByUserId: run.startedByUserId,
          taskId: childTask.id,
        },
        childTask.id,
      );

      if (childRun) {
        const def = await loadDefinitionForRun(childRun);
        if (def) {
          await createStepRunsForNewRun(childRun.id, def);
        }
        await enqueueTick(childRun.id);
      }

      created++;
      logger.info('workflow_bulk_child_created', {
        event: 'bulk.child_created',
        parentRunId: run.id,
        childRunId: childRun?.id,
        targetSubaccountId: targetId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('workflow_runs_bulk_child_unique_idx')) {
        logger.debug('workflow_bulk_child_already_exists', {
          parentRunId: run.id,
          targetSubaccountId: targetId,
        });
      } else {
        throw err;
      }
    }
  }

  if (!shouldSuppressWebSocket(run.runMode)) {
    emitWorkflowRunUpdate(run.id, 'Workflow:run:bulk_fanout', {
      parentRunId: run.id,
      childCount: bulkTargets.length,
    });
  }

  return true;
}

/**
 * Checks whether all children of a bulk parent have completed. If so,
 * finalises the parent. Mixed success/failure → 'partial' status.
 */
export async function checkBulkParentCompletion(run: WorkflowRun): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.checkBulkParentCompletion');
  const children = await scopedDb
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.parentRunId, run.id));

  if (children.length === 0) return;

  const terminal = children.filter((c) =>
    ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status)
  );

  if (terminal.length < children.length) return;

  const allCompleted = children.every((c) => c.status === 'completed');
  const allFailed = children.every((c) => c.status === 'failed');
  let parentStatus: string;
  if (allCompleted) {
    parentStatus = 'completed';
  } else if (allFailed) {
    parentStatus = 'failed';
  } else {
    parentStatus = 'partial';
  }

  const bulkResults = children.map((c) => ({
    childRunId: c.id,
    targetSubaccountId: c.targetSubaccountId,
    status: c.status,
  }));

  const existingContext = run.contextJson as Record<string, unknown>;
  const bulkCompletedAt = new Date();

  await scopedDb
    .update(workflowRuns)
    .set({
      status: parentStatus as WorkflowRun['status'],
      contextJson: { ...existingContext, bulkResults } as Record<string, unknown>,
      completedAt: bulkCompletedAt,
      updatedAt: bulkCompletedAt,
    })
    .where(eq(workflowRuns.id, run.id));

  await upsertSubaccountOnboardingState({
    runId: run.id,
    organisationId: run.organisationId,
    subaccountId: run.subaccountId,
    workflowSlug: run.workflowSlug,
    isOnboardingRun: run.isOnboardingRun,
    runStatus: parentStatus as WorkflowRun['status'],
    startedAt: run.startedAt,
    completedAt: bulkCompletedAt,
  });

  logger.info('workflow_bulk_parent_completed', {
    event: 'bulk.parent_completed',
    runId: run.id,
    status: parentStatus,
    totalChildren: children.length,
    completedChildren: children.filter((c) => c.status === 'completed').length,
    failedChildren: children.filter((c) => c.status === 'failed').length,
  });

  if (!shouldSuppressWebSocket(run.runMode)) {
    emitWorkflowRunUpdate(run.id, 'Workflow:run:status', {
      status: parentStatus,
      bulkResults,
    });
  }
}

/**
 * Replay dispatch — looks up the same step in the source run and copies
 * its output verbatim to the replay step run, wrapped in a `_meta`
 * envelope marking it as replay data.
 */
export async function replayDispatch(
  run: WorkflowRun,
  sr: WorkflowStepRun,
  _step: WorkflowStep
): Promise<void> {
  const meta = (run.contextJson as unknown as RunContext)?._meta ?? {};
  const sourceRunId = (meta as { replaySourceRunId?: string }).replaySourceRunId;
  if (!sourceRunId) {
    await failStepRunInternal(sr, 'replay_missing_source_run_id');
    return;
  }

  const scopedDb = getOrgScopedDb('workflowEngineService.replayDispatch');
  const [sourceSr] = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.runId, sourceRunId),
        eq(workflowStepRuns.stepId, sr.stepId),
        eq(workflowStepRuns.status, 'completed')
      )
    );
  if (!sourceSr || sourceSr.outputJson === null) {
    await failStepRunInternal(sr, `replay_source_step_not_completed:${sr.stepId}`);
    return;
  }

  const replayOutput = {
    ...(sourceSr.outputJson as Record<string, unknown>),
    _meta: {
      isReplay: true,
      replaySourceRunId: sourceRunId,
      replayedAt: new Date().toISOString(),
      sourceStepRunId: sourceSr.id,
    },
  };

  const replayHash = hashValue(replayOutput);
  await completeStepRunInternal(sr, replayOutput, replayHash, 'replay');
}

/**
 * Creates a new replay run from a source run. Clones the source run's
 * organisationId / subaccountId / templateVersionId / context (sans steps)
 * and inserts pending step rows for every entry step.
 */
export async function createReplayRun(
  organisationId: string,
  sourceRunId: string,
  userId: string
): Promise<{ runId: string }> {
  const scopedDb = getOrgScopedDb('workflowEngineService.createReplayRun');
  const [source] = await scopedDb
    .select()
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.id, sourceRunId), eq(workflowRuns.organisationId, organisationId))
    );
  if (!source) throw { statusCode: 404, message: 'Source Workflow run not found' };

  const def = await loadDefinitionForRun(source);
  if (!def) {
    throw { statusCode: 422, message: 'Source run definition not loadable' };
  }

  const startedAt = new Date();
  const sourceCtx = source.contextJson as unknown as RunContext;
  const replayContext: RunContext = {
    input: sourceCtx.input,
    subaccount: sourceCtx.subaccount,
    org: sourceCtx.org,
    steps: {},
    _meta: {
      runId: '',
      templateVersionId: source.templateVersionId,
      startedAt: startedAt.toISOString(),
      resolvedAgents: sourceCtx._meta?.resolvedAgents,
      isReplay: true,
      replaySourceRunId: sourceRunId,
    },
  };

  const replayTask = await taskService.createTask(
    organisationId,
    source.subaccountId ?? organisationId,
    { title: `Workflow run`, status: 'inbox' },
    userId,
  );

  let runId!: string;
  await scopedDb.transaction(async (tx) => {
    const created = await insertRunRowWithUniqueGuard(
      tx as unknown as DB,
      {
        organisationId,
        subaccountId: source.subaccountId,
        scope: source.scope,
        templateVersionId: source.templateVersionId,
        status: 'pending',
        contextJson: replayContext as unknown as Record<string, unknown>,
        contextSizeBytes: Buffer.byteLength(JSON.stringify(replayContext), 'utf8'),
        replayMode: true,
        startedByUserId: userId,
        taskId: replayTask.id,
        startedAt,
      },
      replayTask.id,
    );
    runId = created.id;
    await tx.execute(
      sql`UPDATE workflow_runs SET context_json = jsonb_set(context_json, '{_meta,runId}', to_jsonb(${runId}::text), true) WHERE id = ${runId}`
    );
    const entries = def.steps.filter((s) => s.dependsOn.length === 0);
    for (const step of entries) {
      await tx.insert(workflowStepRuns).values({
        runId,
        stepId: step.id,
        stepType: step.type,
        status: 'pending',
        sideEffectType: step.sideEffectType,
        dependsOn: step.dependsOn,
      });
    }
    await tx.execute(
      sql`INSERT INTO workflow_run_event_sequences (run_id, last_sequence) VALUES (${runId}, 0) ON CONFLICT DO NOTHING`
    );
  });

  logger.info('workflow_replay_run_started', {
    event: 'run.started',
    replay: true,
    runId,
    sourceRunId,
  });

  await enqueueTick(runId);
  return { runId };
}

/**
 * Coarse cascade cost estimate — sum of per-step heuristics.
 */
export function estimateCascadeCostCents(
  _def: WorkflowDefinition,
  downstreamLive: WorkflowStepRun[]
): number {
  const PER_STEP_PESSIMISTIC: Record<string, number> = {
    prompt: 20,
    agent_call: 60,
    agent_decision: 20,
    user_input: 0,
    approval: 0,
    conditional: 0,
  };
  let total = 0;
  for (const row of downstreamLive) {
    total += PER_STEP_PESSIMISTIC[row.stepType] ?? 0;
  }
  return total;
}

/**
 * Computes the longest path through a subset of steps. Used for the
 * cascade.criticalPathLength field surfaced in the mid-run-edit response.
 */
export function computeCriticalPath(def: WorkflowDefinition, stepIds: string[]): number {
  const subset = new Set(stepIds);
  const stepById = new Map<string, WorkflowStep>();
  for (const s of def.steps) if (subset.has(s.id)) stepById.set(s.id, s);
  const longest = new Map<string, number>();
  function visit(id: string): number {
    if (longest.has(id)) return longest.get(id)!;
    const step = stepById.get(id);
    if (!step) return 0;
    let maxDep = 0;
    for (const dep of step.dependsOn) {
      if (subset.has(dep)) {
        maxDep = Math.max(maxDep, visit(dep));
      }
    }
    const v = 1 + maxDep;
    longest.set(id, v);
    return v;
  }
  let result = 0;
  for (const id of stepIds) result = Math.max(result, visit(id));
  return result;
}

/**
 * Common completion path used by user_input submission, approval decision,
 * conditional dispatch, and agent_run completion. Merges the step's output
 * into the run context, computes the new context size, updates the row,
 * and re-ticks the run.
 */
export async function completeStepRunInternal(
  sr: WorkflowStepRun,
  output: unknown,
  outputHash: string,
  via: string
): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.completeStepRunInternal');
  const [run] = await scopedDb.select().from(workflowRuns).where(eq(workflowRuns.id, sr.runId));
  if (!run) return;

  const ctx = run.contextJson as unknown as RunContext;
  const nextCtx = mergeStepOutputIntoContext(ctx, sr.stepId, output);
  const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');

  try {
    assertContextSize(nextBytes, run.id);
  } catch (err) {
    logger.error('workflow_context_overflow', { runId: run.id, bytes: nextBytes });
    const failedAt = new Date();
    assertValidTransition({
      kind: 'workflow_run',
      recordId: run.id,
      from: run.status,
      to: 'failed',
    });
    await scopedDb
      .update(workflowRuns)
      .set({
        status: 'failed',
        error: 'context_overflow',
        failedDueToStepId: sr.stepId,
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(workflowRuns.id, run.id));
    await upsertSubaccountOnboardingState({
      runId: run.id,
      organisationId: run.organisationId,
      subaccountId: run.subaccountId,
      workflowSlug: run.workflowSlug,
      isOnboardingRun: run.isOnboardingRun,
      runStatus: 'failed',
      startedAt: run.startedAt,
      completedAt: failedAt,
    });
    emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
      source: 'workflow_run',
      runId: run.id,
      status: 'failed',
    });
    return;
  }

  assertValidTransition({
    kind: 'workflow_step_run',
    recordId: sr.id,
    from: sr.status,
    to: 'completed',
  });

  const costDelta = getStepCostEstimate(sr.stepType ?? '');

  await scopedDb.transaction(async (tx) => {
    await tx
      .update(workflowStepRuns)
      .set({
        status: 'completed',
        outputJson: output as unknown as Record<string, unknown>,
        outputHash,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, sr.id));

    await tx
      .update(workflowRuns)
      .set({
        contextJson: nextCtx as unknown as Record<string, unknown>,
        contextSizeBytes: nextBytes,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, run.id));

    await WorkflowRunCostLedgerService.incrementAccumulator(run.id, costDelta, tx);
  });

  logger.info('workflow_step_completed', {
    event: 'step.completed',
    runId: run.id,
    stepRunId: sr.id,
    stepId: sr.stepId,
    via,
  });

  await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:completed', {
    stepRunId: sr.id,
    stepId: sr.stepId,
    output,
    via,
  });

  // §G8 / §7.4 — user_input steps with a referenceBinding write the bound
  // form field to a Reference note on the sub-account.
  try {
    const def = await loadDefinitionForRun(run);
    if (def) {
      const step = findStepInDefinition(def, sr.stepId);
      if (step?.type === 'user_input' && step.referenceBinding) {
        const outputObj = (output ?? {}) as Record<string, unknown>;
        const fieldValue = outputObj[step.referenceBinding.field];
        if (fieldValue !== undefined && fieldValue !== null && `${fieldValue}`.trim().length > 0) {
          const created = await writeReferenceFromBinding({
            subaccountId: requireSubaccountId(run),
            organisationId: run.organisationId,
            name: step.referenceBinding.name,
            value: String(fieldValue),
          });
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:reference_binding:created', {
            stepRunId: sr.id,
            stepId: sr.stepId,
            referenceId: created.id,
            name: step.referenceBinding.name,
          });
        } else {
          await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:reference_binding:missing_field', {
            stepRunId: sr.id,
            stepId: sr.stepId,
            field: step.referenceBinding.field,
            name: step.referenceBinding.name,
          });
        }
      }
    }
  } catch (err) {
    logger.error('workflow_reference_binding_error', {
      runId: run.id,
      stepRunId: sr.id,
      stepId: sr.stepId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await enqueueTick(run.id);
}

/**
 * Completion entry used by the HITL resumption path (§4.7). Accepts the
 * already-loaded step run row to avoid a redundant SELECT at the callsite.
 */
export async function completeStepRunFromReview(
  sr: WorkflowStepRun,
  output: unknown,
  via: string,
  _decidedByUserId?: string,
): Promise<void> {
  if (sr.status === 'invalidated') {
    logger.warn('workflow_step_result_discarded_invalidated', {
      event: 'step.result_discarded_invalidated',
      runId: sr.runId,
      stepRunId: sr.id,
      stepId: sr.stepId,
    });
    return;
  }
  const outputHash = hashValue(output);
  await completeStepRunInternal(sr, output, outputHash, via);
}

/** Public completion entry — used by run service. */
export async function completeStepRun(
  stepRunId: string,
  args: { output: unknown; via: string; decidedByUserId?: string }
): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.completeStepRun');
  const [sr] = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId));
  if (!sr) return;
  if (sr.status === 'invalidated') {
    logger.warn('workflow_step_result_discarded_invalidated', {
      event: 'step.result_discarded_invalidated',
      runId: sr.runId,
      stepRunId,
      stepId: sr.stepId,
    });
    return;
  }
  const outputHash = hashValue(args.output);
  await completeStepRunInternal(sr, args.output, outputHash, args.via);
}

export async function failStepRun(stepRunId: string, reason: string, _userId?: string): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.failStepRun');
  const [sr] = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId));
  if (!sr) return;
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
      error: reason,
      completedAt: new Date(),
      version: sr.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(workflowStepRuns.id, stepRunId));
  logger.info('workflow_step_failed', {
    event: 'step.failed',
    runId: sr.runId,
    stepRunId,
    stepId: sr.stepId,
    reason,
  });

  const [parentRun] = await scopedDb
    .select({ subaccountId: workflowRuns.subaccountId })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, sr.runId));
  if (parentRun) {
    await emitWorkflowEvent(sr.runId, parentRun.subaccountId, 'Workflow:step:failed', {
      stepRunId,
      stepId: sr.stepId,
      reason,
    });
  }

  await enqueueTick(sr.runId);
}

/**
 * Resumes an `invoke_automation` step that was held at `review_required`.
 * Guard: `UPDATE WHERE status = 'review_required' RETURNING *` — if zero
 * rows returned, a concurrent approval already won; return `alreadyResumed: true`.
 * Per pre-launch-hardening-spec §4.4 (Option A) and §4.5.2.
 */
export async function resumeInvokeAutomationStep(
  stepRunId: string,
): Promise<{ alreadyResumed: boolean; stepOutcome: 'completed' | 'failed' }> {
  const scopedDb = getOrgScopedDb('workflowEngineService.resumeInvokeAutomationStep');
  const [updated] = await scopedDb
    .update(workflowStepRuns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(workflowStepRuns.id, stepRunId),
      eq(workflowStepRuns.status, 'awaiting_approval'),
    ))
    .returning();

  if (!updated) {
    logger.info('step.resume.guard_blocked', {
      event: 'step.resume.guard_blocked',
      stepRunId,
      status: 'success',
      alreadyResumed: true,
    });
    return { alreadyResumed: true, stepOutcome: 'completed' };
  }

  const sr = updated;
  logger.info('step.resume.started', {
    event: 'step.resume.started',
    stepRunId,
    runId: sr.runId,
    automationId: sr.stepId,
    dispatch_source: 'approval_resume',
  });

  const [run] = await scopedDb
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, sr.runId))
    .limit(1);
  if (!run) {
    await failStepRunInternal(sr, 'resume_run_not_found');
    return { alreadyResumed: false, stepOutcome: 'failed' };
  }

  const definition = await loadDefinitionForRun(run);
  if (!definition) {
    await failStepRunInternal(sr, 'resume_definition_not_found');
    return { alreadyResumed: false, stepOutcome: 'failed' };
  }

  const step = findStepInDefinition(definition, sr.stepId) as InvokeAutomationStep | undefined;
  if (!step || step.type !== 'invoke_automation') {
    await failStepRunInternal(sr, 'resume_step_not_invoke_automation');
    return { alreadyResumed: false, stepOutcome: 'failed' };
  }

  const startMs = Date.now();
  const ctx = run.contextJson as unknown as RunContext;

  const invokeGuardResult = await withInvalidationGuard(sr.id, () =>
    invokeAutomationStep({
      step,
      runId: run.id,
      stepRunId: sr.id,
      run: { organisationId: run.organisationId, subaccountId: run.subaccountId },
      templateCtx: ctx as unknown as Record<string, unknown>,
      bypassGate: true,
    }),
  );

  if ('discarded' in invokeGuardResult) {
    logger.info('step.resume.invalidation_discarded', {
      event: 'step.resume.invalidation_discarded',
      stepRunId,
      runId: run.id,
      status: 'success',
    });
    return { alreadyResumed: false, stepOutcome: 'completed' };
  }

  const result = invokeGuardResult;
  const latencyMs = Date.now() - startMs;

  if (result.status === 'ok') {
    const output = result.output ?? {};
    await completeStepRunInternal(sr, output, hashValue(output), 'invoke_automation');
    logger.info('step.resume.completed', {
      event: 'step.resume.completed',
      stepRunId,
      runId: run.id,
      executionStatus: 'completed',
      latencyMs,
      status: 'success',
    });
    return { alreadyResumed: false, stepOutcome: 'completed' };
  }

  if (result.status === 'review_required') {
    const reason = 'resume_review_required_after_bypass: gate returned review despite bypass';
    logger.error('step.resume.review_required_unexpected', {
      event: 'step.resume.review_required_unexpected',
      stepRunId,
      runId: run.id,
      latencyMs,
      status: 'failed',
    });
    await failStepRunInternal(sr, reason);
    return { alreadyResumed: false, stepOutcome: 'failed' };
  }

  const errorReason = `invoke_automation_error: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`;
  if (step.failurePolicy === 'continue') {
    await completeStepRunInternal(sr, { error: result.error }, hashValue(result.error), 'invoke_automation_continue');
    logger.error('step.resume.failed', {
      event: 'step.resume.failed',
      stepRunId,
      runId: run.id,
      error: errorReason,
      latencyMs,
      status: 'failed',
    });
    return { alreadyResumed: false, stepOutcome: 'completed' };
  } else {
    await failStepRunInternal(sr, errorReason);
    logger.error('step.resume.failed', {
      event: 'step.resume.failed',
      stepRunId,
      runId: run.id,
      error: errorReason,
      latencyMs,
      status: 'failed',
    });
    return { alreadyResumed: false, stepOutcome: 'failed' };
  }
}
