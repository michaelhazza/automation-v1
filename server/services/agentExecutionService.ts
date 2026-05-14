// executionMode in code = 'Execution Environment' in the v1.2 product brief. controllerStyle in code = 'Controller' in the v1.2 product brief. See docs/synthetos-nomenclature.md

import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { describeTransition } from '../../shared/stateMachineGuards.js';
import { agentRuns } from '../db/schema/index.js';
import {
  computeRunResultStatus,
} from './agentExecutionServicePure.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';

import type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';
import { validateAndPrepare } from './agentExecutionService/runLifecycle/validate.js';
import { persistAndAnnounce } from './agentExecutionService/runLifecycle/persistRun.js';
import { configureRun } from './agentExecutionService/runLifecycle/configure.js';
import { loadRunContextAndHierarchy } from './agentExecutionService/runLifecycle/loadContext.js';
import { prepareRun } from './agentExecutionService/runLifecycle/prepare.js';
import { dispatchRun } from './agentExecutionService/runLifecycle/dispatch.js';
import { finalizeRun, cleanupMcp } from './agentExecutionService/runLifecycle/complete.js';

// ---------------------------------------------------------------------------
// Public-surface re-exports (§4 / spec §5.6)
// ---------------------------------------------------------------------------

export type { AgentRunRequest, AgentRunResult } from './agentExecutionService/types.js';
export { resumeAgentRun } from './agentExecutionService/resume.js';
export type { ResumeAgentRunOptions, ResumeAgentRunResult } from './agentExecutionService/resume.js';
export type { LoopParams } from './agentExecutionLoop.js';
export type { LoopResult } from './agentExecutionTypes.js';

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
      if (configResult.kind === 'early_exit_failed') return configResult.result;

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
