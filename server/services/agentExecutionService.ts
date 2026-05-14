// executionMode in code = 'Execution Environment' in the v1.2 product brief. controllerStyle in code = 'Controller' in the v1.2 product brief. See docs/synthetos-nomenclature.md

import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { describeTransition } from '../../shared/stateMachineGuards.js';
import {
  agentRuns,
  tasks,
} from '../db/schema/index.js';
import { skillService } from './skillService.js';
import { systemSkillService } from './systemSkillService.js';
import { systemAgents } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import {
  buildSystemPrompt,
  getOrgProcessesForTools,
  approxTokens,
  type AnthropicTool,
} from './llmService.js';
import {
  computeRunResultStatus,
  assembleVoiceBlock,
} from './agentExecutionServicePure.js';
import * as voiceProfileService from './voiceProfile/voiceProfileService.js';
import { persistAssembly as persistPromptAssembly } from './agentRunPromptService.js';
import { agentRoleToDomain } from './workspaceMemoryService.js';
import * as memoryBlockService from './memoryBlockService.js';
import { agentBeliefService } from './agentBeliefService.js';
import { subaccountStateSummaryService } from './subaccountStateSummaryService.js';
import { buildForRun as buildHierarchyForRun, HierarchyContextBuildError } from './hierarchyContextBuilderService.js';
import type { HierarchyContext } from '../../shared/types/delegation.js';
import {
  createDefaultPipeline,
  type MiddlewareContext,
} from './middleware/index.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
// orgAgentConfigService import removed — deprecated post-migration 0106
import {
  createEvent,
} from '../lib/tracing.js';
// `langfuse`, `withTrace`, `createSpan`, `finalizeTrace`, `generateRunFingerprint`,
// `FinalStatus`, `ErrorType` and `claudeCodeRunner` were consumed by the
// pre-Chunk-5 dispatch ladder. After the Chunk 5 cutover the api/headless
// adapter (`executionBackends/_apiHeadlessShared.ts`) and the claude-code
// adapter (`executionBackends/claudeCodeBackend.ts`) own those imports;
// the dispatch site here resolves an adapter from
// `executionBackendRegistry` and consumes the returned `BackendDispatchResult`.
import { buildThreadContextReadModel } from './conversationThreadContextService.js';
import { formatThreadContextBlock, prependThreadContextToBasePrompt } from './conversationThreadContextServicePure.js';
import type { ThreadContextReadModel } from '../../shared/types/conversationThreadContext.js';

// ---------------------------------------------------------------------------
// Agentic loop executor — extracted to neutral sibling module
// (`agentExecutionLoop.ts`) in Chunk 4 of the ExecutionBackend Adapter
// Contract refactor. Keep these imports adjacent so the relocated symbols
// are visible at a glance to readers of this file.
// ---------------------------------------------------------------------------

// `runAgenticLoop` is no longer called from this file after the Chunk 5
// cutover — the api/headless adapter (`_apiHeadlessShared.ts`) is the
// only direct caller now. `LoopParams` stays as a `import type` because
// `ExecutionClosureContext` derives every field from it and the
// re-export is consumed by historical importers of this module.
import type { LoopParams } from './agentExecutionLoop.js';

export type { LoopParams };

// ---------------------------------------------------------------------------
// Execution backend registry — Chunk 5 cutover.
//
// The pre-Chunk-5 dispatch ladder (`if (mode === 'iee_*') … else if
// (mode === 'claude-code') … else …`) is replaced by a single
// `executionBackendRegistry.resolve(mode).dispatch(input)` call. Each
// adapter owns its own dispatch body in `executionBackends/`; the dispatch
// site here is responsible only for assembling the `BackendDispatchInput`
// (including the closure-context bundle on `backendOptions.loopContext`)
// and consuming the returned `BackendDispatchResult`.
// ---------------------------------------------------------------------------

import type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';
import { validateAndPrepare } from './agentExecutionService/runLifecycle/validate.js';
import { persistAndAnnounce } from './agentExecutionService/runLifecycle/persistRun.js';
import { configureRun } from './agentExecutionService/runLifecycle/configure.js';
import { loadRunContextAndHierarchy } from './agentExecutionService/runLifecycle/loadContext.js';
import { prepareRun } from './agentExecutionService/runLifecycle/prepare.js';
import { dispatchRun } from './agentExecutionService/runLifecycle/dispatch.js';
import { finalizeRun, cleanupMcp } from './agentExecutionService/runLifecycle/complete.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';

// ---------------------------------------------------------------------------
// Execution service
// ---------------------------------------------------------------------------

export const agentExecutionService = {
  /**
   * Execute a single agent run. This is the main entry point for autonomous execution.
   */
  async executeRun(request: AgentRunRequest): Promise<AgentRunResult> {
    const startTime = Date.now();

    const validated = await validateAndPrepare(request, startTime);
    if (validated.kind === 'early_exit') return validated.result;
    const ctx = validated.ctx;

    const { run } = await persistAndAnnounce(request, ctx);
    ctx.run = run;

    try {
      const configResult = await configureRun(request, ctx);
      if (configResult.kind === 'workspace_limit_failed') return configResult.result;

      await loadRunContextAndHierarchy(request, ctx);

      await prepareRun(request, ctx);


      // ── 8. Execute — dispatch through executionBackendRegistry ──────────
      const dispatchOutcome = await dispatchRun(request, ctx);
      if (dispatchOutcome.kind === 'parent_not_dispatchable') {
        throw dispatchOutcome.error;
      }
      ctx.dispatchResult = dispatchOutcome.result;

      if (ctx.dispatchResult.lifecycle === 'delegated') {
        // The adapter has already updated the parent with status,
        // backendId, backendTaskId, ieeRunId, and emitted the delegated
        // websocket event. Return the delegated-run response shape;
        // post-completion hooks fire later via the terminal event
        // handler.
        return {
          runId: run.id,
          status: 'delegated',
          summary: null,
          totalToolCalls: 0,
          totalTokens: 0,
          durationMs: Date.now() - startTime,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
          ieeRunId: ctx.dispatchResult.backendTaskId ?? undefined,
          delegationDeduplicated: ctx.dispatchResult.deduplicated,
        };
      }

      return await finalizeRun(request, ctx);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Hermes Tier 1 Phase B §6.3 / §6.3.1 — outer catch-path write-once
      // terminal update. `finalStatus='failed'` here always maps to
      // `runResultStatus='failed'` via the pure helper; pinning via the
      // helper so the two sites stay in lock-step if the derivation
      // changes.
      const catchRunResultStatus = computeRunResultStatus(
        'failed',
        /* hasError */ true,
        /* hadUncertainty */ false,
      );
      // Round-3 review note: catch-block terminal write logged with
      // `guarded: false` for the same reason as `finishLoop_normal` above.
      logger.info('state_transition', describeTransition({
        kind: 'agent_run',
        recordId: run.id,
        to: 'failed',
        site: 'agentExecutionService.finishLoop_catch',
        guarded: false,
      }));
      const catchUpdate = await db.update(agentRuns).set({
        status: 'failed',
        runResultStatus: catchRunResultStatus,
        errorMessage,
        errorDetail: { error: errorMessage, stack: err instanceof Error ? err.stack : undefined },
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      })
        .where(and(eq(agentRuns.id, run.id), isNull(agentRuns.runResultStatus)))
        .returning({ id: agentRuns.id });
      if (catchUpdate.length === 0) {
        logger.warn('runResultStatus.write_skipped', {
          runId: run.id,
          attemptedStatus: catchRunResultStatus,
          writeSite: 'finishLoop_catch',
        });
      }

      // Emit run failed event
      emitAgentRunUpdate(run.id, 'agent:run:failed', {
        status: 'failed', errorMessage, durationMs,
      });

      // Workflows: route the failure to the engine so the step run is marked
      // failed and downstream failure-policy logic runs.
      try {
        const { notifyWorkflowEngineOnAgentRunComplete } = await import('./workflowAgentRunHook.js');
        await notifyWorkflowEngineOnAgentRunComplete(run.id, {
          ok: false,
          error: errorMessage,
        });
      } catch (hookErr) {
        console.error('[AgentExecution] Workflow hook failed (non-fatal)', hookErr);
      }
      emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
        runId: run.id, agentId: request.agentId, status: 'failed',
      });

      return {
        runId: run.id,
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      };
    } finally {
      await cleanupMcp(ctx);
    }
  },

  /**
   * Start an agent test run asynchronously (C2 — §4.3 async 202 + poll).
   *
   * Creates the `agentRuns` row immediately and detaches the LLM execution
   * loop, returning `{ runId, status: 'running' }` without waiting for the
   * run to complete. Callers poll `GET /api/agent-runs/:id?shape=test` for
   * the final result.
   *
   * Idempotency: if any of the candidate keys matches an existing row the
   * existing run is returned without starting a new execution.
   */
  async startRunAsync(request: AgentRunRequest): Promise<{ runId: string; status: 'running' | AgentRunResult['status']; isExisting?: true }> {
    if (!request.idempotencyKey) {
      throw Object.assign(new Error('startRunAsync: idempotencyKey is required'), {
        statusCode: 400, errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    // ── Idempotency check — mirror executeRun's early-return path ──────────
    const idempotencyLookupKeys =
      request.idempotencyCandidateKeys && request.idempotencyCandidateKeys.length > 0
        ? Array.from(new Set(request.idempotencyCandidateKeys))
        : request.idempotencyKey
          ? [request.idempotencyKey]
          : [];

    if (idempotencyLookupKeys.length > 0) {
      const [existing] = await db
        .select()
        .from(agentRuns)
        .where(inArray(agentRuns.idempotencyKey, idempotencyLookupKeys))
        .limit(1);

      if (existing) {
        const existingStatus = existing.status as AgentRunResult['status'];
        return { runId: existing.id, status: existingStatus, isExisting: true };
      }
    }

    // ── Insert the run row immediately so we can return the runId ──────────
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType ?? 'manual',
        executionMode: request.executionMode ?? 'api',
        executionScope: 'subaccount',
        runSource: request.runSource ?? null,
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        handoffDepth: request.handoffDepth ?? 0,
        parentRunId: request.parentRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        parentSpawnRunId: request.parentSpawnRunId ?? null,
        workflowStepRunId: request.workflowStepRunId ?? null,
        isTestRun: request.isTestRun ?? false,
        handoffSourceRunId: request.handoffSourceRunId ?? null,
        delegationScope: request.delegationScope ?? null,
        delegationDirection: request.delegationDirection ?? null,
        lastActivityAt: new Date(),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // PLAN_GAP: This is bare fire-and-forget (non-durable). A process restart between the 202
    // response and run completion will leave the agent_runs row permanently in 'running' state.
    // For test runs this is acceptable (low stakes, user will re-run). Phase 2 should route through
    // the durable queue infrastructure (pg-boss) if orphaned test runs become a support issue.
    // See tasks/builds/consolidation-build/migration-gaps.md.
    void this.executeRun(request).catch((err: unknown) => {
      logger.error('async_test_run_failed', { runId: run.id, err });
    });

    return { runId: run.id, status: 'running' };
  },
};

export { resumeAgentRun } from './agentExecutionService/resume.js';
export type { ResumeAgentRunOptions, ResumeAgentRunResult } from './agentExecutionService/resume.js';

// ---------------------------------------------------------------------------
// The agentic loop — `runAgenticLoop` and `LoopParams` were extracted to
// `./agentExecutionLoop.ts` in Chunk 4 of the ExecutionBackend Adapter
// Contract refactor (spec § 4.1 / plan Chunk 4). The import at the top of
// this file pulls them back in for the dispatch ladder. External callers
// should import directly from `agentExecutionLoop.ts`.
// ---------------------------------------------------------------------------

// LoopResult is the relocated neutral shape consumed by both the agentic
// loop and the ExecutionBackend dispatch contract
// (server/services/executionBackends/types.ts -> BackendDispatchResult).
// See spec § 4.1 "Neutral type file" — extraction breaks the import cycle
// between agentExecutionService.ts and executionBackends/registry.ts.
//
// The neutral source of truth lives in `agentExecutionTypes.ts`. The
// `export type` re-export here keeps backwards-compat for existing
// importers of this module (and future consumers reach for the neutral
// file directly).
import type { LoopResult } from './agentExecutionTypes.js';
export type { LoopResult };

