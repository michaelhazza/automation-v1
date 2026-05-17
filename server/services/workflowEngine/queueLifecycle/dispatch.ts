import { eq, and, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import {
  workflowRuns,
  workflowStepRuns,
  agents,
  systemAgents,
} from '../../../db/schema/index.js';
import type {
  WorkflowRun,
  WorkflowStepRun,
  WorkflowDefinition,
  WorkflowStep,
  RunContext,
  AgentDecisionStep,
  ActionCallStep,
  InvokeAutomationStep,
} from '../types.js';
import { requireSubaccountId } from '../types.js';
import { hashValue } from '../../../lib/workflow/hash.js';
import {
  renderString,
  resolveInputs as resolveTemplateInputs,
  TemplatingError,
} from '../../../lib/workflow/templating.js';
import { renderAgentDecisionEnvelope } from '../../../lib/workflow/agentDecisionEnvelope.js';
import {
  DEFAULT_DECISION_STEP_TIMEOUT_SECONDS,
} from '../../../config/limits.js';
import { logger } from '../../../lib/logger.js';
import { appendAndEmitTaskEvent } from '../../taskEventService.js';
import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { getJobConfig } from '../../../config/jobConfig.js';
import { WorkflowStepReviewService } from '../../workflowStepReviewService.js';
import { WorkflowStepGateService } from '../../workflowStepGateService.js';
import {
  executeActionCall,
  resolveConfigurationAssistantAgentId,
  ActionTimeoutError,
} from '../../workflowActionCallExecutor.js';
import type { HandlerContext } from '../../handlerContextTypes.js';
import { SPEND_ACTION_ALLOWED_SLUGS } from '../../../config/actionRegistry.js';
import { invokeAutomationStep } from '../../invokeAutomationStepService.js';
import { shouldDiscardWriteForInvalidation } from '../../workflowEngineServicePure.js';
import { AGENT_STEP_QUEUE, enqueueTick } from '../constants.js';
import {
  computeDownstreamSet,
  computeCriticalPath,
  estimateCascadeCostCents,
  failStepRunInternal,
  replayDispatch,
  completeStepRunInternal,
} from '../stepLifecycle.js';
import { loadDefinitionForRun, findStepInDefinition } from '../definitionHelpers.js';
import { withInvalidationGuard } from '../contextHelpers.js';
import { emitWorkflowEvent } from '../readySet.js';

export async function dispatchStep(
  run: WorkflowRun,
  def: WorkflowDefinition,
  step: WorkflowStep,
  liveStepRuns: WorkflowStepRun[],
  handlerContext: HandlerContext,
): Promise<void> {
  const scopedDb = getOrgScopedDb('workflowEngineService.dispatchStep');
  const sr = liveStepRuns.find((s) => s.stepId === step.id);
  if (!sr) {
    throw new Error(`internal: no pending step run row for ${step.id}`);
  }

  // Resolve inputs (Phase 1: pass-through; full templating reuse landed
  // for prompt step types in step 6).
  const resolvedInputs = step.agentInputs ?? null;
  const inputHash = resolvedInputs ? hashValue(resolvedInputs) : null;

  // Replay mode early short-circuit for non-LLM step types — we read the
  // recorded output from the source run rather than re-running them.
  if (run.replayMode) {
    await replayDispatch(run, sr, step);
    return;
  }

  // ── Sprint 4 P3.1: supervised mode gate ──────────────────────────────
  // In supervised mode, every agent_call/prompt/action_call step requires
  // approval before dispatch. Conditional and user_input steps proceed
  // normally.
  if (
    run.runMode === 'supervised' &&
    (step.type === 'agent_call' || step.type === 'prompt' || step.type === 'action_call') &&
    sr.status === 'pending'
  ) {
    await WorkflowStepReviewService.requireApproval(sr, {
      reviewKind: 'supervised_mode',
      organisationId: run.organisationId,
      // B1 fix (spec §6.3): forward step + run context so the gate row
      // gets seen_payload + seen_confidence at open time.
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
    });
    // Step is now awaiting_approval; tick will re-check on next pass
    return;
  }

  // ── Workflows V1: isCritical synthesis gate ────────────────────────────
  // When a step declares `params.is_critical: true` and is one of the
  // side-effecting step types, synthesise an Approval gate before dispatch.
  // Guard: if a gate is already open for this step (re-entrant tick or race),
  // skip synthesis to avoid double-gating.
  const IS_CRITICAL_STEP_TYPES = [
    'agent_call', 'prompt', 'action_call', 'invoke_automation',
    'agent', 'action',
  ] as const;

  if (
    sr.status === 'pending' &&
    (step.params?.is_critical === true) &&
    (IS_CRITICAL_STEP_TYPES as readonly string[]).includes(step.type)
  ) {
    // Re-entrant guard: check if a gate is already open for this step.
    const existingGate = await WorkflowStepGateService.getOpenGate(
      sr.runId,
      sr.stepId,
      run.organisationId,
    );
    if (!existingGate) {
      // "No double-gate" rule: check if the immediately preceding step was
      // an Approval-type step. If so, skip synthesis.
      const prevStepIds = step.dependsOn ?? [];
      const prevIsApproval = prevStepIds.some((prevId) => {
        const prevDef = def.steps.find((s) => s.id === prevId);
        return prevDef?.type === 'approval';
      });

      if (!prevIsApproval) {
        await WorkflowStepReviewService.requireApproval(sr, {
          reviewKind: 'is_critical_synthesised',
          organisationId: run.organisationId,
          approverGroup: { kind: 'task_requester', quorum: 1 },
          isCriticalSynthesised: true,
          // B1 fix (spec §6.3): forward step + run context so the
          // synthesised gate row gets seen_payload + seen_confidence.
          stepDefinition: {
            id: step.id,
            type: step.type,
            name: step.name,
            params: step.params as Record<string, unknown> | undefined,
            isCritical: true,
            sideEffectClass: typeof step.params?.side_effect_class === 'string'
              ? step.params.side_effect_class
              : undefined,
          },
          templateVersionId: run.templateVersionId,
          subaccountId: run.subaccountId,
        });

        // Step is now awaiting_approval; tick will re-check on next pass
        return;
      }
    }
  }

  switch (step.type) {
    case 'user_input': {
      await scopedDb
        .update(workflowStepRuns)
        .set({
          status: 'awaiting_input',
          inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
          inputHash,
          startedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));
      logger.info('workflow_step_awaiting_input', {
        event: 'step.awaiting_input',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
      });
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:awaiting_input', {
        stepRunId: sr.id,
        stepId: step.id,
      });
      return;
    }

    case 'approval': {
      await scopedDb
        .update(workflowStepRuns)
        .set({
          status: 'awaiting_approval',
          inputJson: resolvedInputs as unknown as Record<string, unknown> | null,
          inputHash,
          startedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));
      logger.info('workflow_step_awaiting_approval', {
        event: 'step.awaiting_approval',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
      });
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:awaiting_approval', {
        stepRunId: sr.id,
        stepId: step.id,
      });
      return;
    }

    case 'conditional': {
      // Phase 1: a conditional with no expression is a constant true.
      // Full JSONLogic evaluation lands when conditions become first-class
      // in step 6 alongside the templating resolver integration.
      const result = step.condition !== undefined ? Boolean(step.condition) : true;
      const output = result ? step.trueOutput : step.falseOutput;
      const outputHash = hashValue(output);
      await completeStepRunInternal(sr, output, outputHash, 'conditional');
      return;
    }

    case 'agent_decision': {
      // Replay mode hard block for decision steps (spec §6, §8).
      if (run.replayMode) {
        await replayDispatch(run, sr, step);
        return;
      }

      // Supervised mode gate — decision steps in supervised mode require
      // approval after the agent completes (handled in the completion handler),
      // but the dispatch itself proceeds normally so the agent can make the call.
      // NOTE: Unlike agent_call, we do NOT gate dispatch for supervised mode here —
      // the reviewer sees the agent's tentative choice AFTER the agent runs,
      // not before. The completion handler routes to HITL when appropriate.

      const decisionStep = step as AgentDecisionStep;
      const ctx = run.contextJson as unknown as RunContext;

      // Resolve decisionPrompt via templating. The validator requires decisionPrompt
      // to be set on every agent_decision step, so the fallback is unreachable in
      // well-validated definitions. It is kept as a safety net against stale data.
      let resolvedDecisionPrompt: string;
      try {
        resolvedDecisionPrompt = renderString(step.decisionPrompt ?? '', ctx);
      } catch (err) {
        if (err instanceof TemplatingError) {
          await failStepRunInternal(
            sr,
            `templating_error: ${err.reason} ('${err.expression}')`
          );
          return;
        }
        throw err;
      }

      // Resolve agentInputs via templating (same as agent_call).
      let resolvedAgentInputs: Record<string, unknown> = {};
      try {
        if (step.agentInputs) {
          resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
        }
      } catch (err) {
        if (err instanceof TemplatingError) {
          await failStepRunInternal(
            sr,
            `templating_error: ${err.reason} ('${err.expression}')`
          );
          return;
        }
        throw err;
      }

      // Render the decision envelope (system prompt addendum).
      const envelope = renderAgentDecisionEnvelope({
        decisionPrompt: resolvedDecisionPrompt,
        branches: decisionStep.branches,
        minConfidence: decisionStep.minConfidence,
        // No priorAttempt on first dispatch — populated on retries.
      });

      // Resolve the agent.
      const resolvedAgentId = await resolveAgentForStep(run, step);
      if (!resolvedAgentId) {
        await failStepRunInternal(
          sr,
          `agent_not_found: ${step.agentRef?.kind ?? '?'}:${step.agentRef?.slug ?? '?'}`
        );
        return;
      }

      const dispatchInputHash = hashValue({
        decisionPrompt: resolvedDecisionPrompt,
        branches: decisionStep.branches,
        agentInputs: resolvedAgentInputs,
      });

      // Mark the step as running.
      await scopedDb
        .update(workflowStepRuns)
        .set({
          status: 'running',
          inputJson: {
            decisionPrompt: resolvedDecisionPrompt,
            agentInputs: resolvedAgentInputs,
          } as unknown as Record<string, unknown>,
          inputHash: dispatchInputHash,
          startedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      // Enqueue onto the Workflow-agent-step queue. The worker creates
      // the agent_runs row (with workflow_step_run_id) and runs executeRun.
      // The completion hook fires when done.
      //
      // Key decision-specific additions:
      //   - systemPromptAddendum: the rendered decision envelope
      //   - allowedToolSlugs: [] (empty — no tools in decision steps; §18)
      //   - timeoutSeconds: per-step override or DEFAULT_DECISION_STEP_TIMEOUT_SECONDS
      const timeoutSeconds =
        step.timeoutSeconds ?? DEFAULT_DECISION_STEP_TIMEOUT_SECONDS;
      const idempotencyKey = `Workflow:${run.id}:${step.id}:${sr.attempt}`;
      const triggerContext: Record<string, unknown> = {
        source: 'Workflow',
        WorkflowRunId: run.id,
        WorkflowStepRunId: sr.id,
        stepId: step.id,
        attempt: sr.attempt,
        agentInputs: resolvedAgentInputs,
        isDecisionRun: true,
      };

      const pgboss = (await getPgBoss()) as unknown as {
        send: (
          name: string,
          data: object,
          options?: Record<string, unknown>
        ) => Promise<string | null>;
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
          sideEffectType: 'none' as const, // decision steps are always 'none'
          systemPromptAddendum: envelope,
          allowedToolSlugs: [] as string[],
          timeoutSeconds,
          isDecisionRun: true,
          triggerContext,
        },
        {
          ...getJobConfig('workflow-agent-step'),
          singletonKey: idempotencyKey,
          useSingletonQueue: true,
        }
      );

      logger.info('workflow_decision_step_dispatched', {
        event: 'decision.dispatched',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        resolvedAgentId,
        branchesCount: decisionStep.branches.length,
      });
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:decision:dispatched', {
        stepRunId: sr.id,
        stepId: step.id,
        agentId: resolvedAgentId, // the agent entity; agentRunId is populated by agentExecutionService
        branchesCount: decisionStep.branches.length,
      });
      return;
    }

    case 'action_call': {
      // Replay mode short-circuits to the recorded output.
      if (run.replayMode) {
        await replayDispatch(run, sr, step);
        return;
      }

      const actionStep = step as ActionCallStep;
      const ctx = run.contextJson as unknown as RunContext;

      // Resolve templated inputs against run context.
      let resolvedActionInputs: Record<string, unknown>;
      try {
        resolvedActionInputs = actionStep.actionInputs
          ? resolveTemplateInputs(actionStep.actionInputs, ctx)
          : {};
      } catch (err) {
        if (err instanceof TemplatingError) {
          await failStepRunInternal(
            sr,
            `templating_error: ${err.reason} ('${err.expression}')`,
          );
          return;
        }
        throw err;
      }

      const dispatchInputHash = hashValue({
        actionSlug: actionStep.actionSlug,
        actionInputs: resolvedActionInputs,
      });

      // Input-hash reuse path — never for irreversible steps.
      if (step.sideEffectType !== 'irreversible') {
        const reuse = await findReusableOutputForStep(
          run.id,
          step.id,
          dispatchInputHash,
        );
        if (reuse) {
          logger.info('workflow_action_call_input_hash_reuse', {
            event: 'step.completed',
            runId: run.id,
            stepRunId: sr.id,
            stepId: step.id,
            reusedFromAttempt: reuse.attempt,
          });
          await completeStepRunInternal(
            sr,
            reuse.output,
            reuse.outputHash,
            `input_hash_reuse:from_attempt_${reuse.attempt}`,
          );
          return;
        }
      }

      // Resolve the Configuration Assistant agent id (cache → live).
      const meta = ctx?._meta ?? ({} as RunContext['_meta']);
      let configAgentId = meta.resolvedActionAgents?.configuration_assistant ?? null;
      if (!configAgentId) {
        configAgentId = await resolveConfigurationAssistantAgentId(run.organisationId);
      }
      if (!configAgentId) {
        await failStepRunInternal(sr, 'configuration_assistant_agent_not_found');
        return;
      }

      // Mark the step as running.
      await scopedDb
        .update(workflowStepRuns)
        .set({
          status: 'running',
          inputJson: {
            actionSlug: actionStep.actionSlug,
            actionInputs: resolvedActionInputs,
          } as unknown as Record<string, unknown>,
          inputHash: dispatchInputHash,
          startedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      // Idempotency key — entity-scoped for singleton resources, run-scoped otherwise.
      const idempotencyKey =
        actionStep.idempotencyScope === 'entity' && actionStep.entityKey
          ? `entity:${actionStep.entityKey}`
          : `Workflow:${run.id}:${step.id}:${sr.attempt}`;

      logger.info('workflow_action_call_dispatched', {
        event: 'step.dispatched',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        actionSlug: actionStep.actionSlug,
        idempotencyKey,
      });
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:dispatched', {
        stepRunId: sr.id,
        stepId: step.id,
        stepType: step.type,
        actionSlug: actionStep.actionSlug,
      });

      // Replay interaction with runNow — spec §5.9.
      // A replay must NOT enqueue a `runNow` immediate run, even if the
      // original run's action_call passed `runNow: true`. Strip the flag
      // before forwarding and emit a timeline event so the suppression
      // is visible on the replayed run.
      let dispatchedActionInputs: Record<string, unknown> = resolvedActionInputs;
      if (run.replayMode && 'runNow' in resolvedActionInputs) {
        const stripped = { ...resolvedActionInputs };
        delete stripped.runNow;
        dispatchedActionInputs = stripped;
        await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:run_now_skipped_replay', {
          stepRunId: sr.id,
          stepId: step.id,
        });
      }

      // Pre-call invalidation guard (C4b-INVAL-RACE): abort if the step was
      // invalidated or cancelled while we were setting up the dispatch.
      const [preActionCheck] = await scopedDb.select({ status: workflowStepRuns.status })
        .from(workflowStepRuns).where(eq(workflowStepRuns.id, sr.id)).limit(1);
      if (shouldDiscardWriteForInvalidation(preActionCheck?.status ?? '')) {
        logger.info('workflowEngine.invalidated_before_dispatch', { stepRunId: sr.id, guard: 'pre_call' });
        return;
      }

      // Execute synchronously via the action pipeline.
      try {
        const guardedResult = await withInvalidationGuard(sr.id, () => executeActionCall({
          organisationId: run.organisationId,
          subaccountId: requireSubaccountId(run),
          agentId: configAgentId,
          WorkflowStepRunId: sr.id,
          WorkflowRunId: run.id,
          actionSlug: actionStep.actionSlug,
          actionInputs: dispatchedActionInputs,
          idempotencyKey,
          timeoutMs: step.timeoutSeconds ? step.timeoutSeconds * 1000 : undefined,
        }, handlerContext));
        if ('discarded' in guardedResult) {
          logger.info('workflow_step_action_call_invalidation_discarded', {
            event: 'step.dispatch.invalidation_discarded',
            runId: run.id, stepRunId: sr.id, stepId: step.id,
            status: 'success', discarded: true,
          });
          return;
        }
        const result = guardedResult;

        if (result.status === 'blocked') {
          await failStepRunInternal(
            sr,
            `blocked_by_policy${result.reason ? `: ${result.reason}` : ''}`,
          );
          return;
        }
        if (result.status === 'pending_approval') {
          const reviewKind = (SPEND_ACTION_ALLOWED_SLUGS as readonly string[]).includes(actionStep.actionSlug ?? '')
            ? 'spend_approval'
            : 'action_call_approval';
          await scopedDb
            .update(workflowStepRuns)
            .set({
              status: 'awaiting_approval',
              updatedAt: new Date(),
            })
            .where(eq(workflowStepRuns.id, sr.id));
          await emitWorkflowEvent(
            run.id,
            run.subaccountId,
            'Workflow:step:awaiting_approval',
            { stepRunId: sr.id, stepId: step.id, actionId: result.actionId, reviewKind },
          );
          // Chunk 9: also emit step.awaiting_approval to the task event stream.
          if (run.taskId) {
            void appendAndEmitTaskEvent(
              {
                taskId: run.taskId,
                organisationId: run.organisationId,
                subaccountId: run.subaccountId,
              },
              'engine',
              { kind: 'step.awaiting_approval', payload: { stepId: step.id, reviewKind, actionId: result.actionId } },
            );
          }
          return;
        }
        if (result.status === 'failed') {
          await failStepRunInternal(sr, `action_failed: ${result.error}`);
          return;
        }
        // approved_and_executed
        await completeStepRunInternal(
          sr,
          result.output,
          hashValue(result.output),
          'action_call',
        );
      } catch (err) {
        const reason =
          err instanceof ActionTimeoutError
            ? 'action_timeout'
            : `action_call_error: ${err instanceof Error ? err.message : String(err)}`;
        await failStepRunInternal(sr, reason);
      }
      return;
    }

    case 'agent_call':
    case 'prompt': {
      // §5.10 replay mode hard block — never dispatch external work for
      // a replay run. Instead, read the stored output from the source
      // run and write it to the replay step run directly with the
      // _meta.isReplay envelope.
      if (run.replayMode) {
        await replayDispatch(run, sr, step);
        return;
      }

      // Real dispatch — resolve inputs via the templating module, hash
      // them, check for input-hash reuse, then enqueue onto the
      // Workflow-agent-step queue. The worker creates the agent_runs row
      // (with workflow_step_run_id set) and runs executeRun. The
      // existing completion hook routes the result back via
      // WorkflowAgentRunHook.

      // Resolve templated agentInputs against the run context.
      const ctx = run.contextJson as unknown as RunContext;
      let resolvedAgentInputs: Record<string, unknown> = {};
      let renderedPrompt: string | null = null;
      try {
        if (step.agentInputs) {
          resolvedAgentInputs = resolveTemplateInputs(step.agentInputs, ctx);
        }
        if (step.prompt) {
          renderedPrompt = renderString(step.prompt, ctx);
        }
      } catch (err) {
        if (err instanceof TemplatingError) {
          await failStepRunInternal(
            sr,
            `templating_error: ${err.reason} ('${err.expression}')`
          );
          return;
        }
        throw err;
      }

      const dispatchInputHash = hashValue({
        agentInputs: resolvedAgentInputs,
        prompt: renderedPrompt,
      });

      // Input-hash reuse path (§5.5) — never for irreversible steps.
      if (step.sideEffectType !== 'irreversible') {
        const reuse = await findReusableOutputForStep(
          run.id,
          step.id,
          dispatchInputHash
        );
        if (reuse) {
          logger.info('workflow_step_input_hash_reuse', {
            event: 'step.completed',
            runId: run.id,
            stepRunId: sr.id,
            stepId: step.id,
            reusedFromAttempt: reuse.attempt,
          });
          await completeStepRunInternal(
            sr,
            reuse.output,
            reuse.outputHash,
            `input_hash_reuse:from_attempt_${reuse.attempt}`
          );
          return;
        }
      }

      // Resolve the agent. Cached on _meta.resolvedAgents at run start
      // (or fall back to live lookup if the cache misses).
      const resolvedAgentId = await resolveAgentForStep(run, step);
      if (!resolvedAgentId) {
        await failStepRunInternal(
          sr,
          `agent_not_found: ${step.agentRef?.kind ?? '?'}:${step.agentRef?.slug ?? '?'}`
        );
        return;
      }

      // Mark the step as running and stamp inputs.
      await scopedDb
        .update(workflowStepRuns)
        .set({
          status: 'running',
          inputJson: { agentInputs: resolvedAgentInputs, prompt: renderedPrompt } as unknown as Record<string, unknown>,
          inputHash: dispatchInputHash,
          startedAt: new Date(),
          version: sr.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, sr.id));

      // Pre-call invalidation guard (C4b-INVAL-RACE): abort if the step was
      // invalidated or cancelled while we were setting up the dispatch.
      const [preAgentCheck] = await scopedDb.select({ status: workflowStepRuns.status })
        .from(workflowStepRuns).where(eq(workflowStepRuns.id, sr.id)).limit(1);
      if (shouldDiscardWriteForInvalidation(preAgentCheck?.status ?? '')) {
        logger.info('workflowEngine.invalidated_before_dispatch', { stepRunId: sr.id, guard: 'pre_call' });
        return;
      }

      // Enqueue onto the Workflow-agent-step queue. The worker creates
      // the agent_runs row (with workflow_step_run_id) and runs
      // executeRun synchronously. The completion hook fires when done.
      const pgboss = (await getPgBoss()) as unknown as {
        send: (
          name: string,
          data: object,
          options?: Record<string, unknown>
        ) => Promise<string | null>;
      };
      const agentSendResult = await withInvalidationGuard(sr.id, () => pgboss.send(
        AGENT_STEP_QUEUE,
        {
          WorkflowStepRunId: sr.id,
          WorkflowRunId: run.id,
          organisationId: run.organisationId,
          subaccountId: requireSubaccountId(run),
          agentId: resolvedAgentId,
          stepId: step.id,
          attempt: sr.attempt,
          renderedPrompt,
          resolvedAgentInputs,
          sideEffectType: step.sideEffectType,
        },
        {
          ...getJobConfig('workflow-agent-step'),
          singletonKey: `Workflow-step:${sr.id}:${sr.attempt}`,
          useSingletonQueue: true,
        }
      ));
      if (typeof agentSendResult === 'object' && agentSendResult !== null && 'discarded' in agentSendResult) {
        logger.info('workflow_step_agent_dispatch_invalidation_discarded', {
          event: 'step.dispatch.invalidation_discarded',
          runId: run.id, stepRunId: sr.id, stepId: step.id,
          status: 'success', discarded: true,
        });
        return;
      }

      logger.info('workflow_agent_step_dispatched', {
        event: 'step.dispatched',
        runId: run.id,
        stepRunId: sr.id,
        stepId: step.id,
        resolvedAgentId,
      });
      await emitWorkflowEvent(run.id, run.subaccountId, 'Workflow:step:dispatched', {
        stepRunId: sr.id,
        stepId: step.id,
        stepType: step.type,
      });
      return;
    }

    case 'invoke_automation': {
      const autoStep = step as InvokeAutomationStep;
      const ctx = run.contextJson as unknown as RunContext;

      // Pre-call invalidation guard (C4b-INVAL-RACE): abort if the step was
      // invalidated or cancelled before we begin the automation dispatch.
      const [preInvokeCheck] = await scopedDb.select({ status: workflowStepRuns.status })
        .from(workflowStepRuns).where(eq(workflowStepRuns.id, sr.id)).limit(1);
      if (shouldDiscardWriteForInvalidation(preInvokeCheck?.status ?? '')) {
        logger.info('workflowEngine.invalidated_before_dispatch', { stepRunId: sr.id, guard: 'pre_call' });
        return;
      }

      // Mark step as running before dispatch.
      await scopedDb
        .update(workflowStepRuns)
        .set({ status: 'running', startedAt: new Date(), version: sr.version + 1, updatedAt: new Date() })
        .where(eq(workflowStepRuns.id, sr.id));

      const invokeGuardResult = await withInvalidationGuard(sr.id, () => invokeAutomationStep({
        step: autoStep,
        runId: run.id,
        stepRunId: sr.id,
        run: { organisationId: run.organisationId, subaccountId: run.subaccountId },
        templateCtx: ctx as unknown as Record<string, unknown>,
      }));
      if ('discarded' in invokeGuardResult) {
        logger.info('workflow_step_invoke_automation_invalidation_discarded', {
          event: 'step.dispatch.invalidation_discarded',
          runId: run.id, stepRunId: sr.id, stepId: step.id,
          status: 'success', discarded: true,
        });
        return;
      }
      const result = invokeGuardResult;

      if (result.status === 'ok') {
        const output = result.output ?? {};
        await completeStepRunInternal(sr, output, hashValue(output), 'invoke_automation');
        return;
      }

      if (result.status === 'review_required') {
        await WorkflowStepReviewService.requireApproval(sr, {
          reviewKind: 'invoke_automation_gate',
          organisationId: run.organisationId,
          // B1 fix (spec §6.3): forward step + run context.
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
        });
        return;
      }

      // error — respect failurePolicy: 'continue' so non-critical automations don't halt the run
      const errorReason = `invoke_automation_error: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`;
      if (autoStep.failurePolicy === 'continue') {
        await completeStepRunInternal(sr, { error: result.error }, hashValue(result.error), 'invoke_automation_continue');
      } else {
        await failStepRunInternal(sr, errorReason);
      }
      return;
    }

    default: {
      // Exhaustiveness guard — new step types must add a case above.
      const exhaustiveCheck: never = step.type as never;
      logger.error('workflow_dispatch_unknown_step_type', { stepType: exhaustiveCheck, runId: run.id, stepId: step.id });
      await failStepRunInternal(sr, `unknown_step_type:${step.type}`);
      return;
    }
  }
}

/**
 * Resolves an agent_call step's agentRef to a concrete agent id.
 * Reads the cache from `run.contextJson._meta.resolvedAgents` first;
 * falls back to a live DB lookup. The fresh lookup is also re-verified
 * before every dispatch (spec §3.4) so a deleted agent fails with
 * `workflow_template_drift:agent_deleted_mid_run`.
 */
export async function resolveAgentForStep(run: WorkflowRun, step: WorkflowStep): Promise<string | null> {
  if (!step.agentRef?.slug) return null;
  const slug = step.agentRef.slug;
  const kind = step.agentRef.kind;

  // Try cache first
  const meta = (run.contextJson as unknown as RunContext)?._meta ?? {};
  const cached = meta.resolvedAgents?.[`${kind}:${slug}`];

  const scopedDb = getOrgScopedDb('workflowEngineService.resolveAgentForStep');

  if (cached) {
    // Verify the cached agent still exists (re-verification per §3.4).
    if (kind === 'system') {
      const [row] = await scopedDb
        .select({ id: systemAgents.id })
        .from(systemAgents)
        .where(and(eq(systemAgents.id, cached), isNull(systemAgents.deletedAt)));
      if (row) return cached;
    } else {
      const [row] = await scopedDb
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, cached), isNull(agents.deletedAt)));
      if (row) return cached;
    }
    logger.warn('workflow_resolved_agent_missing', {
      runId: run.id,
      stepId: step.id,
      cached,
      slug,
    });
  }

  // Fresh lookup
  if (kind === 'system') {
    const [row] = await scopedDb
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(and(eq(systemAgents.slug, slug), isNull(systemAgents.deletedAt)));
    return row?.id ?? null;
  }
  if (kind === 'org') {
    const [row] = await scopedDb
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.slug, slug), eq(agents.organisationId, run.organisationId), isNull(agents.deletedAt)));
    return row?.id ?? null;
  }
  return null;
}

/**
 * Looks for a previous completed attempt of the same step in the same
 * run with an identical input_hash. Returns the previous output for
 * verbatim reuse, or null. Per spec §5.5, irreversible steps are never
 * eligible for this path — the caller must enforce that.
 */
export async function findReusableOutputForStep(
  runId: string,
  stepId: string,
  inputHashValue: string
): Promise<{ attempt: number; output: unknown; outputHash: string } | null> {
  const scopedDb = getOrgScopedDb('workflowEngineService.findReusableOutputForStep');
  const rows = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(
      and(
        eq(workflowStepRuns.runId, runId),
        eq(workflowStepRuns.stepId, stepId),
        eq(workflowStepRuns.status, 'completed'),
        eq(workflowStepRuns.inputHash, inputHashValue)
      )
    );
  const row = rows[0];
  if (!row || row.outputJson === null || !row.outputHash) return null;
  return { attempt: row.attempt, output: row.outputJson, outputHash: row.outputHash };
}

/**
 * Mid-run output edit. Spec §5.4 — the safety-critical mutation path.
 *
 * Pre-edit safety check (§5.4):
 *   1. Compute downstream set (transitive dep BFS)
 *   2. Inspect each downstream step's sideEffectType
 *   3. Default-block irreversible / reversible without explicit
 *      confirmation arrays — return a structured 409 payload
 *   4. Compute estimated cost + cascade summary
 *
 * Edit + invalidation:
 *   1. Hash the new output. If identical to previous, no-op (firewall).
 *   2. Update the seed step's outputJson + outputHash.
 *   3. For each downstream step run: mark current row 'invalidated',
 *      insert a new pending row at attempt+1. Steps in skipAndReuse
 *      copy previous output forward as completed.
 *   4. Cancel any in-flight downstream agent runs (best-effort).
 *   5. Re-merge context from scratch using only currently-completed
 *      step outputs.
 */
export async function editStepOutput(
  organisationId: string,
  runId: string,
  stepRunId: string,
  options: {
    output: Record<string, unknown>;
    confirmReversible?: string[];
    confirmIrreversible?: string[];
    skipAndReuse?: string[];
    expectedVersion?: number;
    userId: string;
  }
): Promise<
  | {
      ok: true;
      invalidatedStepIds: string[];
      skippedStepIds: string[];
      estimatedCostCents: number;
      cascade: { size: number; criticalPathLength: number };
    }
  | {
      ok: false;
      statusCode: 409;
      error: string;
      detail: string;
      affected: Array<{
        stepId: string;
        name: string;
        sideEffectType: WorkflowStep['sideEffectType'];
        previousOutput: unknown;
      }>;
      totalEstimatedCostCents: number;
      cascade: { size: number; criticalPathLength: number };
    }
> {
  const scopedDb = getOrgScopedDb('workflowEngineService.editStepOutput');
  const [run] = await scopedDb
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.organisationId, organisationId)));
  if (!run) throw { statusCode: 404, message: 'Workflow run not found' };

  const [seedStep] = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));
  if (!seedStep) throw { statusCode: 404, message: 'Step run not found' };
  if (seedStep.status !== 'completed') {
    throw {
      statusCode: 409,
      message: `Cannot edit step in status '${seedStep.status}' — only completed steps can be edited`,
    };
  }
  if (
    options.expectedVersion !== undefined &&
    seedStep.version !== options.expectedVersion
  ) {
    throw {
      statusCode: 409,
      message: `Step version is ${seedStep.version}, expected ${options.expectedVersion}`,
      errorCode: 'workflow_stale_version',
    };
  }

  const def = await loadDefinitionForRun(run);
  if (!def) throw { statusCode: 422, message: 'Run definition not loadable' };

  // Output-hash firewall — no-op if the new output is byte-identical to
  // the previous one. This is the cheapest possible exit path.
  const newHash = hashValue(options.output);
  if (newHash === seedStep.outputHash) {
    logger.info('workflow_mid_run_edit_noop_firewall', {
      runId,
      stepRunId,
      stepId: seedStep.stepId,
    });
    return {
      ok: true,
      invalidatedStepIds: [],
      skippedStepIds: [],
      estimatedCostCents: 0,
      cascade: { size: 0, criticalPathLength: 0 },
    };
  }

  // Compute downstream set.
  const downstreamIds = computeDownstreamSet(def, seedStep.stepId);
  const downstreamRows = await scopedDb
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.runId, runId));
  const downstreamLive = downstreamRows.filter(
    (r) =>
      downstreamIds.includes(r.stepId) &&
      r.status !== 'invalidated' &&
      r.status !== 'failed'
  );

  // Build affected list with side-effect classification.
  const affected: Array<{
    stepId: string;
    name: string;
    sideEffectType: WorkflowStep['sideEffectType'];
    previousOutput: unknown;
  }> = [];
  let needsConfirmation = false;
  for (const row of downstreamLive) {
    const stepDef = findStepInDefinition(def, row.stepId);
    if (!stepDef) continue;
    const isSkipped = options.skipAndReuse?.includes(row.stepId);
    const isConfirmedReversible =
      options.confirmReversible?.includes(row.stepId) ||
      options.confirmIrreversible?.includes(row.stepId);
    const isConfirmedIrreversible = options.confirmIrreversible?.includes(row.stepId);

    if (
      stepDef.sideEffectType === 'irreversible' &&
      !isSkipped &&
      !isConfirmedIrreversible
    ) {
      needsConfirmation = true;
      affected.push({
        stepId: row.stepId,
        name: stepDef.name,
        sideEffectType: 'irreversible',
        previousOutput: row.outputJson,
      });
    } else if (
      stepDef.sideEffectType === 'reversible' &&
      !isSkipped &&
      !isConfirmedReversible
    ) {
      needsConfirmation = true;
      affected.push({
        stepId: row.stepId,
        name: stepDef.name,
        sideEffectType: 'reversible',
        previousOutput: row.outputJson,
      });
    } else {
      affected.push({
        stepId: row.stepId,
        name: stepDef.name,
        sideEffectType: stepDef.sideEffectType,
        previousOutput: row.outputJson,
      });
    }
  }

  // Cascade metrics
  const cascade = {
    size: downstreamLive.length,
    criticalPathLength: computeCriticalPath(def, downstreamLive.map((d) => d.stepId)),
  };
  const estimatedCostCents = estimateCascadeCostCents(def, downstreamLive);

  if (needsConfirmation) {
    logger.info('workflow_mid_run_edit_blocked', {
      event: 'mid_run_edit.blocked',
      runId,
      stepRunId,
      affectedCount: affected.length,
    });
    return {
      ok: false,
      statusCode: 409,
      error: 'workflow_irreversible_blocked',
      detail: 'mid_run_edit_irreversible',
      affected,
      totalEstimatedCostCents: estimatedCostCents,
      cascade,
    };
  }

  // Apply edit + cascade. Single transaction for atomicity.
  const skippedStepIds: string[] = [];
  const invalidatedStepIds: string[] = [];

  await scopedDb.transaction(async (tx) => {
    // Update the seed step's output + hash.
    await tx
      .update(workflowStepRuns)
      .set({
        outputJson: options.output as Record<string, unknown>,
        outputHash: newHash,
        version: seedStep.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, seedStep.id));

    // For each downstream live row: invalidate + insert successor.
    for (const row of downstreamLive) {
      const stepDef = findStepInDefinition(def, row.stepId);
      if (!stepDef) continue;

      // Mark current row invalidated.
      await tx
        .update(workflowStepRuns)
        .set({
          status: 'invalidated',
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(workflowStepRuns.id, row.id));
      invalidatedStepIds.push(row.stepId);

      if (options.skipAndReuse?.includes(row.stepId)) {
        // Copy the previous output forward as a new completed attempt.
        await tx.insert(workflowStepRuns).values({
          runId,
          stepId: row.stepId,
          stepType: row.stepType,
          status: 'completed',
          sideEffectType: row.sideEffectType,
          dependsOn: row.dependsOn,
          inputJson: row.inputJson,
          inputHash: row.inputHash,
          outputJson: row.outputJson as Record<string, unknown> | null,
          outputHash: row.outputHash,
          attempt: row.attempt + 1,
          startedAt: new Date(),
          completedAt: new Date(),
        });
        skippedStepIds.push(row.stepId);
      } else {
        // Insert a fresh pending row.
        await tx.insert(workflowStepRuns).values({
          runId,
          stepId: row.stepId,
          stepType: row.stepType,
          status: 'pending',
          sideEffectType: row.sideEffectType,
          dependsOn: row.dependsOn,
          attempt: row.attempt + 1,
        });
      }
    }

    // Re-merge context from scratch using only currently-completed step
    // outputs. The mid-run-edit semantics (§5.1.1 rule 6) say invalidated
    // step outputs are removed from context, not preserved.
    const completedAfterEdit = await tx
      .select()
      .from(workflowStepRuns)
      .where(
        and(
          eq(workflowStepRuns.runId, runId),
          eq(workflowStepRuns.status, 'completed')
        )
      );
    const ctx = run.contextJson as unknown as RunContext;
    const nextSteps: Record<string, { output: unknown }> = {};
    for (const sr of completedAfterEdit) {
      if (sr.outputJson !== null) {
        nextSteps[sr.stepId] = { output: sr.outputJson };
      }
    }
    // Make sure the seed step uses the new output.
    nextSteps[seedStep.stepId] = { output: options.output };
    const nextCtx: RunContext = {
      input: ctx.input,
      subaccount: ctx.subaccount,
      org: ctx.org,
      steps: nextSteps,
      _meta: ctx._meta,
    };
    const nextBytes = Buffer.byteLength(JSON.stringify(nextCtx), 'utf8');
    await tx
      .update(workflowRuns)
      .set({
        contextJson: nextCtx as unknown as Record<string, unknown>,
        contextSizeBytes: nextBytes,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));
  });

  logger.info('workflow_mid_run_edit_applied', {
    event: 'mid_run_edit.applied',
    runId,
    stepRunId,
    stepId: seedStep.stepId,
    invalidatedCount: invalidatedStepIds.length,
    skippedCount: skippedStepIds.length,
    cascadeSize: cascade.size,
    criticalPathLength: cascade.criticalPathLength,
  });

  await enqueueTick(runId);

  return {
    ok: true,
    invalidatedStepIds,
    skippedStepIds,
    estimatedCostCents,
    cascade,
  };
}

