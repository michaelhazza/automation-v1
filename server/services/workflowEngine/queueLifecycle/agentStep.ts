import { eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { workflowRuns, workflowStepRuns } from '../../../db/schema/index.js';
import { logger } from '../../../lib/logger.js';
import { emitOrgUpdate } from '../../../websocket/emitters.js';
import { upsertSubaccountOnboardingState } from '../../../lib/workflow/onboardingStateHelpers.js';
import { hashValue } from '../../../lib/workflow/hash.js';
import { renderString, resolveInputs as resolveTemplateInputs } from '../../../lib/workflow/templating.js';
import { computeSkipSet, parseDecisionOutput } from '../../../lib/workflow/agentDecisionPure.js';
import { renderAgentDecisionEnvelope } from '../../../lib/workflow/agentDecisionEnvelope.js';
import {
  MAX_DECISION_RETRIES,
  DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
  DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS,
} from '../../../config/limits.js';
import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { getJobConfig } from '../../../config/jobConfig.js';
import { WorkflowStepReviewService } from '../../workflowStepReviewService.js';
import { enqueueTick, AGENT_STEP_QUEUE } from '../constants.js';
import { assertContextSize, mergeStepOutputIntoContext } from '../contextHelpers.js';
import { loadDefinitionForRun, findStepInDefinition } from '../definitionHelpers.js';
import { emitWorkflowEvent } from '../readySet.js';
import {
  completeStepRun,
  failStepRun,
  failStepRunInternal,
} from '../stepLifecycle.js';
import { resolveAgentForStep } from './dispatch.js';
import type { WorkflowStepRun, WorkflowRun, WorkflowStep, WorkflowDefinition, RunContext, AgentDecisionStep } from '../types.js';
import { requireSubaccountId } from '../types.js';

async function applyDecisionStepResult(
  sr: WorkflowStepRun,
  step: WorkflowStep,
  run: WorkflowRun,
  ctx: RunContext,
  stepOutput: Record<string, unknown>,
  def: WorkflowDefinition,
  skipSet: ReadonlySet<string>,
): Promise<boolean> {
  const nextCtx = mergeStepOutputIntoContext(ctx, step.id, stepOutput);
  const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');
  try {
    assertContextSize(nextBytes, run.id);
  } catch {
    const failedAt = new Date();
    const scopedDb = getOrgScopedDb('workflowEngineService.applyDecisionStepResult');
    await scopedDb
      .update(workflowRuns)
      .set({
        status: 'failed',
        error: 'context_overflow',
        failedDueToStepId: step.id,
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
    return true;
  }
  const outputHash = hashValue(stepOutput);
  const scopedDb = getOrgScopedDb('workflowEngineService.applyDecisionStepResult');
  await scopedDb.transaction(async (tx) => {
    await tx
      .update(workflowStepRuns)
      .set({
        status: 'completed',
        outputJson: stepOutput as unknown as Record<string, unknown>,
        outputHash,
        completedAt: new Date(),
        version: sr.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, sr.id));
    for (const skippedStepId of skipSet) {
      const skippedStepDef = findStepInDefinition(def, skippedStepId);
      if (!skippedStepDef) continue;
      try {
        await tx.insert(workflowStepRuns).values({
          runId: run.id,
          stepId: skippedStepId,
          stepType: skippedStepDef.type,
          status: 'skipped',
          sideEffectType: skippedStepDef.sideEffectType,
          dependsOn: skippedStepDef.dependsOn,
          completedAt: new Date(),
        });
      } catch {
        await tx
          .update(workflowStepRuns)
          .set({ status: 'skipped', completedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(workflowStepRuns.runId, run.id),
              eq(workflowStepRuns.stepId, skippedStepId)
            )
          );
      }
    }
    await tx
      .update(workflowRuns)
      .set({
        contextJson: nextCtx as unknown as Record<string, unknown>,
        contextSizeBytes: nextBytes,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, run.id));
  });
  return false;
}

/**
 * Hook called by the agent run completion path. Routes decision steps through
 * handleDecisionStepCompletion; all other types go to completeStepRun/failStepRun.
 */
export async function onAgentRunCompleted(
  stepRunId: string,
  result: { ok: boolean; output?: unknown; error?: string },
  agentRunId: string
): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.onAgentRunCompleted');
  const [sr] = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId));
  if (!sr) return;
  if (sr.status === 'invalidated') {
    logger.warn('workflow_step_result_discarded_invalidated', {
      event: 'step.result_discarded_invalidated',
      runId: sr.runId,
      stepRunId: sr.id,
      stepId: sr.stepId,
      agentRunId,
    });
    return;
  }

  if (sr.stepType === 'agent_decision') {
    await handleDecisionStepCompletion(sr, result, agentRunId);
    return;
  }

  if (result.ok && result.output !== undefined) {
    await completeStepRun(sr.id, { output: result.output, via: 'agent_run' });
  } else {
    await failStepRun(sr.id, result.error ?? 'agent_run_failed');
  }
}

/**
 * Completion handler for `agent_decision` steps. Spec §6 algorithm:
 *   1. Load run + definition.
 *   2. Parse agent output as AgentDecisionOutput.
 *   3. On parse failure: retry (up to MAX_DECISION_RETRIES); on exhaustion, fail.
 *   4. On success: compute skip set, write completed row + skipped rows + context.
 */
export async function handleDecisionStepCompletion(
  sr: WorkflowStepRun,
  result: { ok: boolean; output?: unknown; error?: string },
  agentRunId: string
): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.handleDecisionStepCompletion');
  const [run] = await scopedDb.select().from(workflowRuns).where(eq(workflowRuns.id, sr.runId));
  if (!run) return;

  const def = await loadDefinitionForRun(run);
  if (!def) {
    await failStepRunInternal(sr, 'decision_replay_snapshot_missing');
    return;
  }

  const step = findStepInDefinition(def, sr.stepId);
  if (!step || step.type !== 'agent_decision') {
    await failStepRunInternal(sr, 'internal: decision step type mismatch');
    return;
  }
  const decisionStep = step as AgentDecisionStep;

  if (!result.ok) {
    await failStepRunInternal(sr, result.error ?? 'decision_agent_run_failed');
    return;
  }

  const rawOutput =
    typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output ?? '');
  const parseResult = parseDecisionOutput(rawOutput, decisionStep);
  const inputJson = (sr.inputJson ?? {}) as Record<string, unknown>;
  const retryCount = typeof inputJson.retryCount === 'number' ? inputJson.retryCount : 0;

  if (!parseResult.ok) {
    // Retry path.
    if (retryCount < MAX_DECISION_RETRIES) {
      const ctx = run.contextJson as unknown as RunContext;
      let resolvedDecisionPrompt = decisionStep.decisionPrompt ?? '';
      try {
        resolvedDecisionPrompt = renderString(resolvedDecisionPrompt, ctx);
      } catch {
        // Use the raw template on render failure.
      }

      const truncatedRaw = rawOutput.slice(0, DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS);
      const envelope = renderAgentDecisionEnvelope({
        decisionPrompt: resolvedDecisionPrompt,
        branches: decisionStep.branches,
        minConfidence: decisionStep.minConfidence,
        priorAttempt: {
          errorMessage: parseResult.error.message,
          rawOutput: truncatedRaw,
        },
      });

      const resolvedAgentId = await resolveAgentForStep(run, step);
      if (!resolvedAgentId) {
        await failStepRunInternal(sr, 'decision_agent_run_failed: agent disappeared on retry');
        return;
      }

      let resolvedAgentInputs: Record<string, unknown> = {};
      try {
        if (step.agentInputs) {
          resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
        }
      } catch {
        // Use empty on error.
      }

      await scopedDb
        .update(workflowStepRuns)
        .set({
          inputJson: { ...inputJson, retryCount: retryCount + 1 } as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      const idempotencyKey = `Workflow:${run.id}:${step.id}:${sr.attempt}:retry${retryCount + 1}`;
      const pgboss = (await getPgBoss()) as unknown as {
        send: (name: string, data: object, options?: Record<string, unknown>) => Promise<string | null>;
      };
      await pgboss.send(
        AGENT_STEP_QUEUE,
        {
          WorkflowStepRunId: sr.id,
          WorkflowRunId: run.id,
          organisationId: run.organisationId,
          subaccountId: requireSubaccountId(run),
          agentId: resolvedAgentId,
          stepId: step.id,
          attempt: sr.attempt,
          renderedPrompt: null,
          resolvedAgentInputs,
          sideEffectType: 'none' as const,
          systemPromptAddendum: envelope,
          allowedToolSlugs: [] as string[],
          timeoutSeconds: step.timeoutSeconds ?? DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
          isDecisionRun: true,
          triggerContext: {
            source: 'Workflow',
            WorkflowRunId: run.id,
            WorkflowStepRunId: sr.id,
            stepId: step.id,
            attempt: sr.attempt,
            agentInputs: resolvedAgentInputs,
            isDecisionRun: true,
            retryCount: retryCount + 1,
          },
        },
        {
          ...getJobConfig('workflow-agent-step'),
          singletonKey: idempotencyKey,
          useSingletonQueue: true,
        }
      );

      logger.info('workflow_decision_step_retrying', {
        event: 'decision.retry',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        retryCount: retryCount + 1,
        parseErrorCode: parseResult.error.code,
      });
      return;
    }

    // Max retries exceeded — fall back to defaultBranchId if set, else fail.
    if (decisionStep.defaultBranchId) {
      logger.info('workflow_decision_step_default_branch_fallback', {
        event: 'decision.default_branch_fallback',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        defaultBranchId: decisionStep.defaultBranchId,
        retryCount,
        parseErrorCode: parseResult.error.code,
      });

      const ctx = run.contextJson as unknown as RunContext;
      const skipSet = computeSkipSet(def, step.id, decisionStep.defaultBranchId);
      const stepOutput: Record<string, unknown> = {
        chosenBranchId: decisionStep.defaultBranchId,
        rationale: `default_branch_fallback: parse failed after ${retryCount} retries`,
        skippedStepIds: [...skipSet],
        retryCount,
        chosenByAgent: false,
      };
      const overflowed = await applyDecisionStepResult(sr, step, run, ctx, stepOutput, def, skipSet);
      if (overflowed) return;

      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:default_branch_applied', {
        stepRunId: sr.id,
        stepId: step.id,
        chosenBranchId: decisionStep.defaultBranchId,
        skippedStepIds: [...skipSet],
      });

      await enqueueTick(run.id);
      return;
    }

    await failStepRunInternal(
      sr,
      `decision_parse_failure: ${parseResult.error.code}: ${parseResult.error.message}`
    );
    return;
  }

  // 4. Parse succeeded — apply the decision.
  const { chosenBranchId, rationale, confidence } = parseResult.output;

  // 4a. minConfidence HITL escalation (spec §7).
  if (
    decisionStep.minConfidence !== undefined &&
    confidence !== undefined &&
    confidence < decisionStep.minConfidence
  ) {
    await scopedDb
      .update(workflowStepRuns)
      .set({
        inputJson: {
          ...(inputJson ?? {}),
          tentativeDecision: { chosenBranchId, rationale, confidence },
        } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, sr.id));

    await WorkflowStepReviewService.requireApproval(sr, {
      reviewKind: 'decision_confidence_escalation',
      organisationId: run.organisationId,
      stepDefinition: {
        id: step.id,
        type: step.type,
        name: step.name,
        params: step.params as Record<string, unknown> | undefined,
        isCritical: step.params?.is_critical === true,
        sideEffectClass: typeof step.params?.side_effect_class === 'string'
          ? step.params.side_effect_class
          : undefined,
      },
      templateVersionId: run.templateVersionId,
      subaccountId: run.subaccountId,
      agentReasoning: typeof rationale === 'string' ? rationale : null,
      upstreamConfidence: typeof confidence === 'number'
        ? (confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low')
        : null,
    });

    logger.info('workflow_decision_low_confidence_escalated', {
      event: 'decision.low_confidence_escalation',
      runId: run.id,
      stepRunId: sr.id,
      stepId: step.id,
      chosenBranchId,
      confidence,
      minConfidence: decisionStep.minConfidence,
      agentRunId,
    });

    await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:low_confidence', {
      stepRunId: sr.id,
      stepId: step.id,
      chosenBranchId,
      confidence,
      minConfidence: decisionStep.minConfidence,
    });
    return;
  }

  const skipSet = computeSkipSet(def, step.id, chosenBranchId);
  const stepOutput: Record<string, unknown> = {
    chosenBranchId,
    rationale,
    skippedStepIds: [...skipSet],
    retryCount,
    chosenByAgent: true,
  };
  if (confidence !== undefined) stepOutput.confidence = confidence;

  const ctx = run.contextJson as unknown as RunContext;
  const overflowed = await applyDecisionStepResult(sr, step, run, ctx, stepOutput, def, skipSet);
  if (overflowed) return;

  logger.info('workflow_decision_step_completed', {
    event: 'decision.completed',
    runId: run.id,
    stepRunId: sr.id,
    stepId: step.id,
    chosenBranchId,
    skippedCount: skipSet.size,
    retryCount,
  });

  await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:completed', {
    stepRunId: sr.id,
    stepId: step.id,
    chosenBranchId,
    skippedStepIds: [...skipSet],
    rationale,
  });

  await enqueueTick(run.id);
}
