// executionMode in code = 'Execution Environment' in the v1.2 product brief. controllerStyle in code = 'Controller' in the v1.2 product brief. See docs/synthetos-nomenclature.md

import { createHash } from 'crypto';
import { eq, and, isNull, count, inArray } from 'drizzle-orm';
import { isActive } from '../lib/queryHelpers.js';
import { recordIncident } from './incidentIngestor.js';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { describeTransition } from '../../shared/stateMachineGuards.js';
import {
  agents,
  subaccounts,
  subaccountAgents,
  agentRuns,
  agentRunSnapshots,
  tasks,
  agentExecutionEvents,
} from '../db/schema/index.js';
import { agentService } from './agentService.js';
import { devContextService } from './devContextService.js';
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
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  buildResumeContext,
  computeRunResultStatus,
} from './agentExecutionServicePure.js';
import {
  streamMessages as streamAgentRunMessages,
} from './agentRunMessageService.js';
import { project as projectToolCallsLogFromMessages } from './toolCallsLogProjectionService.js';
import { fingerprint } from './regressionCaptureServicePure.js';
import type { AgentRunCheckpoint } from './middleware/types.js';
import type { SubaccountAgent } from '../db/schema/index.js';
import { tryEmitAgentEvent, emitAgentEvent } from './agentExecutionEventEmitter.js';
import { persistAssembly as persistPromptAssembly } from './agentRunPromptService.js';
import { workspaceMemoryService, agentRoleToDomain } from './workspaceMemoryService.js';
import * as memoryBlockService from './memoryBlockService.js';
import { agentBriefingService } from './agentBriefingService.js';
import { agentBeliefService } from './agentBeliefService.js';
import { subaccountStateSummaryService } from './subaccountStateSummaryService.js';
import { triggerService } from './triggerService.js';
import { buildForRun as buildHierarchyForRun, HierarchyContextBuildError } from './hierarchyContextBuilderService.js';
import type { HierarchyContext, DelegationScope, DelegationDirection } from '../../shared/types/delegation.js';
import {
  createDefaultPipeline,
  checkWorkspaceLimits,
  type MiddlewareContext,
} from './middleware/index.js';
import {
  MAX_CROSS_AGENT_TASKS,
} from '../config/limits.js';
import { CONTROLLER_LIMITS } from '../config/controllerLimits.js';
import { deriveControllerStyle } from './controllerStyleResolver.js';
import {
  resolvePolicyEnvelope,
  persist as persistPolicyEnvelope,
  ExecutionModeNotAllowedForAgentError,
} from './policyEnvelopeResolver.js';
import { executionModeToEnvironment } from '../../shared/types/executionEnvironment.js';
import { emitAgentRunUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
// orgAgentConfigService import removed — deprecated post-migration 0106
import { organisations } from '../db/schema/index.js';
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
// Universal Brief — artefact validator (Phase 1 prep; active emission begins Phase 2)
import { validateArtefactForPersistence } from './briefArtefactValidator.js';
import { buildThreadContextReadModel } from './conversationThreadContextService.js';
import { formatThreadContextBlock, prependThreadContextToBasePrompt } from './conversationThreadContextServicePure.js';
import type { ThreadContextReadModel } from '../../shared/types/conversationThreadContext.js';
import type { ServicePrincipal } from './principal/types.js';

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

import { executionBackendRegistry } from './executionBackends/registry.js';
import { ParentRunNotDispatchable } from './executionBackends/types.js';
import type { BackendOptions } from './executionBackends/types.js';
import type { ExecutionMode } from '../../shared/types/executionEnvironment.js';

/**
 * Closure-context bundle assembled in `executeRun` and forwarded to each
 * adapter on `BackendDispatchInput.backendOptions.loopContext`.
 *
 * The api / headless / claude-code adapters read different subsets of
 * this bag — `buildBackendOptionsForMode` projects it onto the right
 * adapter-specific shape (`ApiHeadlessLoopContext` /
 * `ClaudeCodeLoopContext`). The IEE adapters do NOT consume any of these
 * fields; their `BackendOptions` carries `ieeTask` only.
 *
 * Field set comes from the pre-Chunk-5 inline branches — the closure
 * variables `runAgenticLoop` / `claudeCodeRunner.execute` previously read
 * directly from `executeRun`'s scope.
 */
interface ExecutionClosureContext {
  agent: LoopParams['agent'];
  effectiveTools: LoopParams['tools'];
  pipeline: LoopParams['pipeline'];
  mcpClients: LoopParams['mcpClients'];
  mcpLazyRegistry: LoopParams['mcpLazyRegistry'];
  runContextData: LoopParams['runContextData'];
  saLink: LoopParams['saLink'];
  agentDomain: LoopParams['agentDomain'];
  configVersion: LoopParams['configVersion'];
  hierarchyContext: LoopParams['hierarchyContext'];
  orgProcesses: LoopParams['orgProcesses'];
  request: LoopParams['request'];
  startTime: LoopParams['startTime'];
  isOrgSubaccountRun: LoopParams['isOrgSubaccountRun'];
  maxLoopIterations: LoopParams['maxLoopIterations'];
  /** Pre-built router context (carries the inserted run id + agent name). */
  routerCtx: LoopParams['routerCtx'];
  /** Resolved task prompt forwarded to the Claude Code runner. */
  taskPrompt: string;
}

/**
 * Project the closure-context bundle onto the per-adapter
 * `BackendOptions` discriminated-union variant. Exhaustive switch on
 * `ExecutionMode` with a `never` exhaustiveness check on the default
 * branch — adding a new mode breaks compilation here until the new
 * variant is wired.
 *
 * Pure: no DB / I/O / closure mutations; only assembles the discriminated
 * shape from the inputs.
 */
function buildBackendOptionsForMode(
  mode: ExecutionMode,
  request: AgentRunRequest,
  ctx: ExecutionClosureContext,
): BackendOptions {
  // Derive the spec.options.RunSource from the request's runSource +
  // runType. Mirrors the pre-Chunk-5 trace-metadata derivation.
  const runSource: 'manual' | 'scheduled' | 'handoff' | 'sub_agent' =
    request.runSource === 'handoff' ? 'handoff'
    : request.runSource === 'sub_agent' ? 'sub_agent'
    : request.runType === 'scheduled' ? 'scheduled'
    : 'manual';

  switch (mode) {
    case 'api':
      return {
        backendId: 'api',
        runSource,
        allowedToolSlugs: request.allowedToolSlugs,
        loopContext: {
          agent: ctx.agent,
          routerCtx: ctx.routerCtx,
          tools: ctx.effectiveTools,
          maxLoopIterations: ctx.maxLoopIterations,
          startTime: ctx.startTime,
          request: ctx.request,
          orgProcesses: ctx.orgProcesses,
          saLink: ctx.saLink,
          pipeline: ctx.pipeline,
          mcpClients: ctx.mcpClients,
          mcpLazyRegistry: ctx.mcpLazyRegistry,
          runContextData: ctx.runContextData,
          isOrgSubaccountRun: ctx.isOrgSubaccountRun,
          agentDomain: ctx.agentDomain,
          hierarchyContext: ctx.hierarchyContext,
          configVersion: ctx.configVersion,
        },
      };
    case 'headless':
      return {
        backendId: 'headless',
        runSource,
        allowedToolSlugs: request.allowedToolSlugs,
        loopContext: {
          agent: ctx.agent,
          routerCtx: ctx.routerCtx,
          tools: ctx.effectiveTools,
          maxLoopIterations: ctx.maxLoopIterations,
          startTime: ctx.startTime,
          request: ctx.request,
          orgProcesses: ctx.orgProcesses,
          saLink: ctx.saLink,
          pipeline: ctx.pipeline,
          mcpClients: ctx.mcpClients,
          mcpLazyRegistry: ctx.mcpLazyRegistry,
          runContextData: ctx.runContextData,
          isOrgSubaccountRun: ctx.isOrgSubaccountRun,
          agentDomain: ctx.agentDomain,
          hierarchyContext: ctx.hierarchyContext,
          configVersion: ctx.configVersion,
        },
      };
    case 'claude-code':
      return {
        backendId: 'claude-code',
        loopContext: {
          taskPrompt: ctx.taskPrompt,
          request: ctx.request,
        },
      };
    case 'iee_browser':
      // Pre-flight validation in the dispatch site narrowed
      // `request.ieeTask.type === 'browser'`; the cast matches the
      // BrowserTaskPayload shape the adapter expects. A runtime
      // mismatch is caught by the adapter's own `dispatch()` guard.
      return {
        backendId: 'iee_browser',
        ieeTask: request.ieeTask as never,
      };
    case 'iee_dev':
      return {
        backendId: 'iee_dev',
        ieeTask: request.ieeTask as never,
      };
    default: {
      const _exhaustive: never = mode;
      void _exhaustive;
      throw new Error(`buildBackendOptionsForMode: unknown executionMode '${mode}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRunRequest {
  agentId: string;
  subaccountId?: string | null;
  subaccountAgentId?: string | null;
  organisationId: string;
  /**
   * Execution scope. Always 'subaccount' after the org subaccount refactor.
   * Kept for backward compatibility with historical agent_runs records.
   * @deprecated — all runs are subaccount-scoped post-migration 0106
   */
  executionScope?: 'subaccount';
  runType: 'scheduled' | 'manual' | 'triggered';
  executionMode?: 'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev';
  /**
   * Optional IEE task. Required when executionMode is 'iee_browser' or
   * 'iee_dev'. Spec §9.1.
   *
   * Fields extended to pass through to the worker's browser executor:
   *  - mode ('standard' | 'login_test' | 'capture_video')
   *  - webLoginConnectionId (for paywall workflows; audit blocker #1 wiring)
   *  - playSelector (capture_video mode)
   */
  ieeTask?: {
    type: 'browser' | 'dev';
    goal: string;
    startUrl?: string;
    sessionKey?: string;
    repoUrl?: string;
    branch?: string;
    commands?: string[];
    mode?: 'standard' | 'login_test' | 'capture_video';
    webLoginConnectionId?: string;
    playSelector?: string;
  };
  taskId?: string;
  triggerContext?: Record<string, unknown>;
  handoffDepth?: number;
  parentRunId?: string;
  /** WB-1: for handoff runs, the canonical handoff-edge pointer. Set alongside
   *  parentRunId (both equal the source run's id for a handoff run). */
  handoffSourceRunId?: string;
  isSubAgent?: boolean;
  parentSpawnRunId?: string;
  /** Optional idempotency key — if provided, duplicate runs with same key return existing result */
  idempotencyKey?: string;
  /**
   * Additional keys to check for an existing run before inserting. When the
   * caller wants boundary-tolerant dedup (e.g. dual-bucket for test runs) it
   * passes `[currentBucketKey, previousBucketKey]` here. The SELECT treats
   * the set as an OR; the INSERT always uses `idempotencyKey` as the write
   * value. If absent, behaviour falls back to checking only `idempotencyKey`.
   */
  idempotencyCandidateKeys?: string[];
  /** How this run was sourced — for observability */
  runSource?: 'scheduler' | 'manual' | 'trigger' | 'handoff' | 'sub_agent' | 'system';
  /**
   * Workflows: when this agent run was dispatched by a Workflow step, the
   * step run id is stamped onto agent_runs.workflow_step_run_id so the
   * completion hook can route the result back to the engine.
   * Spec tasks/Workflows-spec.md §5.2 / step 6 wiring.
   */
  workflowStepRunId?: string;
  /**
   * The principal that initiated this run, when known. Plumbed into the
   * SkillExecutionContext so user-scoped tools (e.g. Workflow Studio
   * propose_save) can enforce ownership without making downstream
   * database lookups. Optional because system / scheduled runs have no
   * initiating user. Review finding #3.
   */
  userId?: string;
  /**
   * Brain Tree OS adoption P1 — when true, the executor looks up the most
   * recent terminal run with a non-null handoff for the same agent and
   * scope, and injects its handoff into the initial message under a
   * "## Previous Session" block. Default false. Only manual / continue-from
   * UX paths should set this to true; scheduled and triggered runs should
   * leave it false to avoid stale-context poisoning.
   */
  seedFromPreviousRun?: boolean;
  /**
   * Workflow agent_decision steps: rendered decision envelope injected at the
   * end of the system prompt so the agent sees branch options and output schema.
   * Spec: docs/Workflow-agent-decision-step-spec.md §17.
   */
  systemPromptAddendum?: string;
  /**
   * Workflow agent_decision steps: when set to an empty array, the agent runs
   * with no tools (pure reasoning only). If omitted, the agent's configured
   * skill set is used.
   */
  allowedToolSlugs?: string[];
  /**
   * Feature 2 — inline Run-Now test panel. When true the run is flagged as a
   * test run: excluded from agency P&L and LLM usage aggregates by default,
   * and shown with a "Test" badge in run history. Default false.
   */
  isTestRun?: boolean;
  /**
   * When set, executeRun emits a live-log `orchestrator.routing_decided`
   * event on the dispatched run immediately after `run.started` — i.e.
   * within the run's own timeline (sequence 2), not after it has finished.
   *
   * Set by `orchestratorFromTaskJob` on the downstream `executeRun` call
   * so the timeline correctly captures the dispatch decision BEFORE the
   * run completes. Previously the job emitted the event after awaiting
   * `executeRun`, which put it after `run.completed` on the timeline.
   * Spec: tasks/live-agent-execution-log-spec.md §5.3.
   */
  orchestratorDispatch?: {
    taskId: string;
    chosenAgentId: string;
    idempotencyKey: string;
    routingSource: 'rule' | 'llm' | 'fallback';
  };
  /**
   * Paperclip Hierarchy — delegation telemetry (Chunk 4a).
   * Populated by spawn_sub_agents and reassign_task when hierarchy is active.
   * Stored on agent_runs.delegation_scope / agent_runs.delegation_direction.
   */
  delegationScope?: DelegationScope;
  delegationDirection?: DelegationDirection;
  /**
   * When the run is triggered from a conversation context (e.g. chat panel
   * test-run), the caller passes the conversationId here so that integration
   * card messages can be persisted to agent_messages.
   */
  conversationId?: string;
  /** Workflow nesting depth — propagated from parent run via workflow.run.start skill. Top-level orchestrator runs set this to 1. */
  workflowRunDepth?: number;
  /**
   * Optional caller-requested controller style override. When provided and the
   * agent's controllerStyleAllowed permits it, overrides the executionMode
   * default. Throws ControllerStyleNotAllowedForAgentError (HTTP 422) when
   * override='operator' but the agent link is 'native_only'.
   */
  controllerStyle?: string;
}

export interface AgentRunResult {
  runId: string;
  // 'delegated' added in IEE Phase 0 (docs/iee-delegation-lifecycle-spec.md).
  // When returned, the agent run has been handed off to a delegated backend
  // (IEE worker). Terminal state is reached asynchronously via the
  // iee-run-completed event handler. Callers that need a terminal result
  // must subscribe to WebSocket `agent:run:completed` or poll the agent
  // run status until it leaves 'delegated'.
  // 'blocked_awaiting_integration' — run is paused waiting for the user to
  // connect an OAuth integration. Not terminal; completedAt is NOT written.
  status: 'delegated' | 'completed' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded' | 'blocked_awaiting_integration';
  summary: string | null;
  totalToolCalls: number;
  totalTokens: number;
  durationMs: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
  /** Present only when status === 'delegated'. Identifies the iee_runs row
   *  that will eventually produce the terminal state. */
  ieeRunId?: string;
  /** Present only when status === 'delegated' and the enqueue hit an
   *  existing idempotent row. */
  delegationDeduplicated?: boolean;
}

/** Task with its joined agent relation resolved */
interface TaskWithAgent {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  status: string;
  priority: string;
  assignedAgentId: string | null;
  assignedAgent: { id: string; name: string | null; slug: string | null } | null;
  createdAt: Date;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Execution service
// ---------------------------------------------------------------------------

export const agentExecutionService = {
  /**
   * Execute a single agent run. This is the main entry point for autonomous execution.
   */
  async executeRun(request: AgentRunRequest): Promise<AgentRunResult> {
    const startTime = Date.now();

    // ── 0a. Execution scope validation ─────────────────────────────────
    // Post-migration 0106: all runs are subaccount-scoped. Both fields are required.
    // Use Error instances (not plain objects) so background callers that check
    // `err instanceof Error` (scheduledTaskService, subtaskWakeupService, etc.)
    // can read err.message. asyncHandler also accepts Error with statusCode/errorCode
    // as extra properties.
    if (!request.subaccountId) {
      const err = Object.assign(new Error('All agent runs require a subaccountId'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_ID' });
      throw err;
    }
    if (!request.subaccountAgentId) {
      const err = Object.assign(new Error('All agent runs require a subaccountAgentId post-migration'), { statusCode: 400, errorCode: 'MISSING_SUBACCOUNT_AGENT_ID' });
      throw err;
    }

    // ── 0b. General org execution kill switch ───────────────────────────
    // Applies to ALL runs (org subaccount and regular subaccounts alike).
    const [orgForKillSwitch] = await db
      .select({ executionEnabled: organisations.orgExecutionEnabled })
      .from(organisations)
      .where(eq(organisations.id, request.organisationId));
    if (orgForKillSwitch && !orgForKillSwitch.executionEnabled) {
      return {
        runId: '',
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs: Date.now() - startTime,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      };
    }

    // ── 0c. Check if this is an org subaccount run (for cross-subaccount access control) ─
    const [subaccountRow] = await db
      .select({ isOrgSubaccount: subaccounts.isOrgSubaccount })
      .from(subaccounts)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to check isOrgSubaccount flag; subaccountId comes from authenticated agent run request already validated upstream"
      .where(eq(subaccounts.id, request.subaccountId!));
    const isOrgSubaccountRun = subaccountRow?.isOrgSubaccount ?? false;

    // ── 0d. Idempotency check — return existing run if key already used ───
    // Candidate set: explicit list (e.g. dual-bucket for test runs) falls
    // through to a single-key lookup if absent.
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
        return {
          runId: existing.id,
          status: existing.status as AgentRunResult['status'],
          summary: existing.summary,
          totalToolCalls: existing.totalToolCalls,
          totalTokens: existing.totalTokens,
          durationMs: existing.durationMs ?? (Date.now() - startTime),
          tasksCreated: existing.tasksCreated,
          tasksUpdated: existing.tasksUpdated,
          deliverablesCreated: existing.deliverablesCreated,
        };
      }
    }

    // ── 1. Resolve controller style before inserting the run ─────────────
    // Read controllerStyleAllowed from the subaccountAgents row so we can
    // pass the resolved value into the INSERT. Default 'native_only' matches
    // the DB column default so missing rows are safe.
    let resolvedControllerStyleAllowed = 'native_only';
    if (request.subaccountAgentId) {
      const [saGovRow] = await db
        .select({ controllerStyleAllowed: subaccountAgents.controllerStyleAllowed })
        .from(subaccountAgents)
        .where(and(
          eq(subaccountAgents.id, request.subaccountAgentId),
          eq(subaccountAgents.organisationId, request.organisationId),
        ));
      if (saGovRow) {
        resolvedControllerStyleAllowed = saGovRow.controllerStyleAllowed;
      }
    }
    const { controllerStyle: resolvedControllerStyle, source: controllerStyleSource } =
      deriveControllerStyle(
        request.executionMode ?? 'api',
        resolvedControllerStyleAllowed,
        request.controllerStyle,
      );

    // ── 2. Create the run record ──────────────────────────────────────────
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        executionScope: 'subaccount',
        controllerStyle: resolvedControllerStyle,
        runSource: request.runSource ?? null,
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        handoffDepth: request.handoffDepth ?? 0,
        parentRunId: request.parentRunId ?? null,
        handoffSourceRunId: request.handoffSourceRunId ?? null,
        isSubAgent: request.isSubAgent ?? false,
        parentSpawnRunId: request.parentSpawnRunId ?? null,
        workflowStepRunId: request.workflowStepRunId ?? null,
        isTestRun: request.isTestRun ?? false,
        delegationScope: request.delegationScope ?? null,
        delegationDirection: request.delegationDirection ?? null,
        lastActivityAt: new Date(),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Emit run started event
    emitAgentRunUpdate(run.id, 'agent:run:started', {
      agentId: request.agentId, subaccountId: request.subaccountId ?? null,
      runType: request.runType, status: 'running',
    });
    emitSubaccountUpdate(request.subaccountId!, 'live:agent_started', {
      runId: run.id, agentId: request.agentId,
    });

    // Live Agent Execution Log — critical lifecycle bookend (spec §5.3).
    // Awaited so that run.started claims sequence_number=1 before any later
    // event (prompt.assembled, context.source_loaded, etc.) allocates a
    // sequence number. Using tryEmitAgentEvent here would fire it in the
    // background, creating a race where a subsequent event could win the
    // lower sequence and sort before the bookend in the timeline.
    await emitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: 'run.started',
        critical: true,
        agentId: request.agentId,
        runType: request.runType,
        triggeredBy: request.runSource ?? 'unknown',
      },
      linkedEntity: { type: 'agent', id: request.agentId },
    });

    // Log the resolved controller style for observability (spec §3.5 log code).
    tryEmitAgentEvent({
      runId: run.id,
      organisationId: request.organisationId,
      subaccountId: request.subaccountId ?? null,
      sourceService: 'agentExecutionService',
      payload: {
        eventType: 'foundation.controller_style.derived',
        critical: false,
        runId: run.id,
        executionMode: request.executionMode ?? 'api',
        controllerStyle: resolvedControllerStyle,
        source: controllerStyleSource,
      },
      linkedEntity: { type: 'agent', id: request.agentId },
    });

    // Live Agent Execution Log — `orchestrator.routing_decided` (spec §5.3).
    // Emitted here (not from the orchestrator job) so the event lands
    // inside THIS run's timeline at sequence 2, immediately after
    // `run.started`. The previous shape — job calls tryEmitAgentEvent
    // AFTER awaiting executeRun — put the event after `run.completed`,
    // breaking the "timeline represents actual execution order"
    // invariant. Fire-and-forget is safe: this is a non-critical event
    // and the run is now committed with sequence_number = 1 claimed.
    if (request.orchestratorDispatch) {
      tryEmitAgentEvent({
        runId: run.id,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        sourceService: 'orchestratorFromTaskJob',
        payload: {
          eventType: 'orchestrator.routing_decided',
          critical: false,
          taskId: request.orchestratorDispatch.taskId,
          chosenAgentId: request.orchestratorDispatch.chosenAgentId,
          idempotencyKey: request.orchestratorDispatch.idempotencyKey,
          routingSource: request.orchestratorDispatch.routingSource,
        },
        linkedEntity: { type: 'agent', id: request.orchestratorDispatch.chosenAgentId },
      });
    }

    // Observability: temporary metric for org subaccount runs (remove after 2 weeks stable)
    if (isOrgSubaccountRun) {
      logger.info('org_subaccount_run', {
        orgId: request.organisationId,
        agentId: request.agentId,
        runId: run.id,
        runType: request.runType,
      });
    }

    try {
      // ── 2. Load agent config ────────────────────────────────────────────
      const agent = await agentService.getAgent(request.agentId, request.organisationId);

      let tokenBudget: number;
      let maxToolCalls: number;
      let timeoutMs: number;
      let configSkillSlugs: string[];
      let configCustomInstructions: string | null = null;

      // Single config path — all runs load from subaccountAgents
      let saLink: typeof subaccountAgents.$inferSelect | null = null;

      {
        const [link] = await db
          .select()
          .from(subaccountAgents)
          .where(and(
            eq(subaccountAgents.id, request.subaccountAgentId!),
            eq(subaccountAgents.organisationId, request.organisationId),
          ));

        if (!link) throw Object.assign(new Error('Subaccount agent link not found'), { statusCode: 404, errorCode: 'SUBACCOUNT_AGENT_NOT_FOUND' });
        saLink = link;

        const controllerLimits = CONTROLLER_LIMITS[run.controllerStyle];
        tokenBudget = Math.round(link.tokenBudgetPerRun * controllerLimits.defaultTokenBudgetMultiplier);
        maxToolCalls = link.maxToolCallsPerRun;
        timeoutMs = link.timeoutSeconds * 1000;
        configSkillSlugs = (link.skillSlugs ?? []) as string[];
        configCustomInstructions = link.customInstructions;
      }

      // ── 2a. Snapshot resolved config for reproducibility ──────────────
      const resolvedConfig = {
        tokenBudget,
        maxToolCalls,
        timeoutMs,
        skillSlugs: configSkillSlugs,
        customInstructions: configCustomInstructions,
        executionScope: 'subaccount' as const,
      };
      const configHashValue = createHash('sha256').update(JSON.stringify(resolvedConfig)).digest('hex');

      await db.update(agentRuns).set({
        tokenBudget,
        configSnapshot: resolvedConfig,
        configHash: configHashValue,
        resolvedSkillSlugs: configSkillSlugs,
        resolvedLimits: { tokenBudget, maxToolCalls, timeoutMs },
      }).where(eq(agentRuns.id, run.id));

      // ── 2b. Workspace limit check (pre-run guard) ─────────────────────
      const limitCheck = await checkWorkspaceLimits(request.subaccountId!, tokenBudget);
      if (!limitCheck.allowed) {
        const durationMs = Date.now() - startTime;
        await db.update(agentRuns).set({
          status: 'failed',
          errorMessage: limitCheck.reason ?? 'Workspace limit exceeded',
          errorDetail: {
            type: 'workspace_limit',
            dailyUsed: limitCheck.dailyUsed,
            dailyLimit: limitCheck.dailyLimit,
            requestedBudget: tokenBudget,
          },
          completedAt: new Date(),
          durationMs,
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id));

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
      }

      // ── 2c. Snapshot DEC hash + iteration count into triggerContext ──
      try {
        const { hash: decHash } = await devContextService.getContext(request.subaccountId!);

        // Count prior runs for this task to determine current iteration
        let iteration = 0;
        if (request.taskId) {
          const [{ total }] = await db
            .select({ total: count() })
            .from(agentRuns)
            .where(and(
              eq(agentRuns.taskId, request.taskId),
              eq(agentRuns.subaccountId, request.subaccountId!),
            ));
          // Subtract 1 because current run is already inserted
          iteration = Math.max(0, Number(total) - 1);
        }

        const existingCtx = (request.triggerContext ?? {}) as Record<string, unknown>;
        await db.update(agentRuns).set({
          triggerContext: {
            ...existingCtx,
            executionSnapshot: {
              decHash,
              iteration,
              snapshotAt: new Date().toISOString(),
            },
          },
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id));
      } catch {
        // DEC not configured for this subaccount — skip snapshot (non-dev agents)
      }

      // ── 2d. Resolve and persist policy envelope (INV-19) ─────────────────
      // Must complete before any tool call, LLM call, or IEE dispatch.
      // On failure: run is transitioned to 'failed' and execution is aborted.
      try {
        const policyEnvelopeCtx = {
          runId: run.id,
          agentId: request.agentId,
          subaccountAgentId: request.subaccountAgentId!,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId!,
          controllerStyle: run.controllerStyle,
          executionMode: request.executionMode ?? 'api',
          tokenBudget,
          maxToolCalls,
        };
        const snapshot = await resolvePolicyEnvelope(policyEnvelopeCtx);
        await persistPolicyEnvelope(run.id, snapshot);

        // Enforce allowedEnvironments (spec §4.2.8). The envelope captures
        // the constraint at run start; this gate rejects a run whose
        // requested executionMode maps to an environment the agent is not
        // permitted to use. Without this check, a Governance-tab restriction
        // (e.g. browser-disabled) is silently ignored.
        const requestedEnv = executionModeToEnvironment(
          request.executionMode ?? 'api',
        );
        if (!snapshot.allowedEnvironments.includes(requestedEnv)) {
          throw new ExecutionModeNotAllowedForAgentError(
            request.executionMode ?? 'api',
            requestedEnv,
          );
        }

        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'agentExecutionService',
          payload: {
            eventType: 'foundation.policy_envelope.resolved',
            critical: false,
            runId: run.id,
            schemaVersion: 1,
            sourceCounts: {
              activePolicyRuleIds: snapshot.activePolicyRuleIds.length,
              availableCredentialIds: snapshot.availableCredentialIds.length,
              allowedSkillSlugs: snapshot.allowedSkillSlugs.length,
            },
          },
          linkedEntity: { type: 'agent', id: request.agentId },
        });
      } catch (envelopeErr) {
        const durationMs = Date.now() - startTime;
        const isEnvViolation = envelopeErr instanceof ExecutionModeNotAllowedForAgentError;
        const failureType = isEnvViolation
          ? 'execution_mode_not_allowed_for_agent'
          : 'policy_envelope_resolution_failed';

        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'agentExecutionService',
          payload: {
            eventType: isEnvViolation
              ? 'foundation.execution_environment.rejected'
              : 'foundation.policy_envelope.resolution_failed',
            critical: false,
            runId: run.id,
            error: envelopeErr instanceof Error ? envelopeErr.message : String(envelopeErr),
          },
          linkedEntity: { type: 'agent', id: request.agentId },
        });

        await db.update(agentRuns).set({
          status: 'failed',
          errorMessage: envelopeErr instanceof Error ? envelopeErr.message : 'Policy envelope resolution failed',
          errorDetail: {
            type: failureType,
            failureReason: failureType,
          },
          completedAt: new Date(),
          durationMs,
          updatedAt: new Date(),
        }).where(eq(agentRuns.id, run.id));

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
      }

      // ── 3. Load run context data (cascading scopes + task attachments + instructions) ──
      // Spec §7.1/§7.2. Pulls agent-wide, subaccount-scoped, scheduled-task-
      // scoped, and task-instance data across all four scopes; resolves
      // same-name overrides; enforces the eager budget upstream of
      // buildSystemPrompt; caps the lazy manifest; and exposes the scheduled
      // task's description as taskInstructions for the new system-prompt layer.
      const { loadRunContextData } = await import('./runContextLoader.js');
      const runContextData = await loadRunContextData({
        agentId: request.agentId,
        organisationId: request.organisationId,
        subaccountAgentId: request.subaccountAgentId ?? null,
        taskId: request.taskId ?? null,
        triggerContext: request.triggerContext,
        subaccountId: request.subaccountId ?? null,
        runId: run.id,
        tokenBudget,
      });

      // Only eager sources flagged includedInPrompt: true are rendered into
      // the Knowledge Base block. Sources excluded by the upstream budget
      // walk or by same-name override resolution stay in runContextData
      // (for snapshot persistence) but do not appear in the prompt.
      const dataSourceContents = runContextData.eager
        .filter(s => s.includedInPrompt)
        .map(s => ({
          name: s.name,
          description: s.description,
          content: s.content,
          contentType: s.contentType,
        }));

      // ── 3.5. Auto-knowledge retrieval — spec §8, Chunk 4B ──────────────
      // Assembles ranked reference-document chunks and memory blocks for
      // this run. Fail-open: degraded result carries loaded:[] so the run
      // continues without knowledge context rather than aborting.
      const { assembleKnowledgeForRun } = await import('./retrievalService.js');
      const retrievalResult = await assembleKnowledgeForRun(run.id);
      // Append loaded chunks (auto + always_available modes) to knowledge base.
      for (const item of retrievalResult.loaded) {
        dataSourceContents.push({
          name: item.documentId ?? item.id,
          description: null,
          content: item.content,
          contentType: 'text',
        });
      }

      // ── 4. Load org processes for trigger_process skill ─────────────────
      const orgProcesses = await getOrgProcessesForTools(request.organisationId);

      // ── 4.5. Build immutable hierarchy snapshot (INV-4) ──────────────────
      // Must complete before skill resolution so Phase 4's derived-skill
      // resolver can read context.hierarchy.childIds.
      let hierarchyContext: Readonly<HierarchyContext> | undefined;
      if (request.subaccountId && request.subaccountAgentId) {
        try {
          hierarchyContext = await buildHierarchyForRun({
            agentId: request.subaccountAgentId,
            subaccountId: request.subaccountId,
            organisationId: request.organisationId,
          });
          // Persist hierarchy_depth on the run row (non-critical: catch and log)
          db.update(agentRuns)
            .set({ hierarchyDepth: hierarchyContext.depth, updatedAt: new Date() })
            .where(eq(agentRuns.id, run.id))
            .catch((err: unknown) => {
              logger.warn('[agentExecutionService] Failed to persist hierarchy_depth', {
                runId: run.id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        } catch (err) {
          if (err instanceof HierarchyContextBuildError) {
            logger.warn('[agentExecutionService] hierarchy_not_built_for_run', {
              runId: run.id,
              code: err.code,
              agentId: request.agentId,
              subaccountAgentId: request.subaccountAgentId,
            });
            // Leave hierarchyContext undefined — read skills fall through (Chunk 3b),
            // write skills fail closed (Chunk 4a). Do not abort the run for a build failure.
          } else {
            throw err;
          }
        }
      }

      // ── 5. Resolve skills → tools + instructions (3-layer) ─────────────
      // Layer 1: System skills (from system agent, if linked)
      let systemSkillTools: AnthropicTool[] = [];
      let systemSkillInstructions: string[] = [];
      let systemAgentRecord: typeof systemAgents.$inferSelect | null = null;

      if (agent.systemAgentId) {
        const [sa] = await db.select().from(systemAgents).where(eq(systemAgents.id, agent.systemAgentId));
        if (sa) {
          systemAgentRecord = sa;
          const systemSlugs = (sa.defaultSystemSkillSlugs ?? []) as string[];
          const resolved = await systemSkillService.resolveSystemSkills(systemSlugs);
          systemSkillTools = resolved.tools;
          systemSkillInstructions = resolved.instructions;
        }
      }

      // Layer 2+3: Org skills + sub-account/org skills
      const skillSlugs = configSkillSlugs;
      const { tools: skillTools, instructions: skillInstructions, truncated: skillInstructionsTruncated } = await skillService.resolveSkillsForAgent(
        skillSlugs,
        request.organisationId,
        request.subaccountId,
        request.subaccountAgentId ? hierarchyContext : undefined,  // Pass hierarchy only in subaccount context
      );
      if (skillInstructionsTruncated) {
        logger.warn('[agentExecutionService] Skill instructions were truncated — agent may have reduced capability', {
          organisationId: request.organisationId,
          subaccountId: request.subaccountId,
          skillSlugs,
        });
      }

      // For trigger_process, inject the process enum dynamically
      const allSkillTools = [...systemSkillTools, ...skillTools];
      const enhancedTools = allSkillTools.map(tool => {
        if (tool.name === 'trigger_process' && orgProcesses.length > 0) {
          return {
            ...tool,
            input_schema: {
              ...tool.input_schema,
              properties: {
                ...tool.input_schema.properties,
                process_id: {
                  ...tool.input_schema.properties.process_id,
                  enum: orgProcesses.map(t => t.id),
                },
              },
            },
          };
        }
        return tool;
      });

      // ── 5a. Auto-inject read_data_source (spec §8.4) ─────────────────────
      // The skill is default-on for every agent run. It's read-only, cheap,
      // and only useful when data sources are attached. Rather than requiring
      // each system agent to list it in defaultSystemSkillSlugs, we append it
      // to the tool list here so every agent can call it without operator
      // action. The skill is already registered via systemSkillService because
      // the .md file exists at server/skills/read_data_source.md.
      if (!enhancedTools.some(t => t.name === 'read_data_source')) {
        const readDataSourceSkill = await systemSkillService.getSkillBySlug('read_data_source');
        if (readDataSourceSkill && readDataSourceSkill.visibility !== 'none') {
          enhancedTools.push({
            name: readDataSourceSkill.definition.name,
            description: readDataSourceSkill.definition.description,
            input_schema: readDataSourceSkill.definition.input_schema,
          });
          if (readDataSourceSkill.instructions) {
            systemSkillInstructions.push(readDataSourceSkill.instructions);
          }
        }
      }

      // ── 5b. MCP tool resolution ────────────────────────────────────────
      let mcpClients: Map<string, import('./mcpClientManager.js').McpClientInstance> | null = null;
      let mcpLazyRegistry: Map<string, import('../db/schema/mcpServerConfigs.js').McpServerConfig> | null = null;

      try {
        const { mcpClientManager } = await import('./mcpClientManager.js');
        const mcp = await mcpClientManager.connectForRun({
          runId: run.id,
          organisationId: request.organisationId,
          agentId: request.agentId,
          subaccountId: request.subaccountId ?? null,
          isTestRun: run.isTestRun ?? false,
        });
        mcpClients = mcp.clients;
        mcpLazyRegistry = mcp.lazyRegistry;
        if (mcp.tools.length > 0) {
          // Defense in depth: cap is also enforced in connectForRun
          const { MAX_MCP_TOOLS_PER_RUN } = await import('../config/limits.js');
          const cappedTools = mcp.tools.slice(0, MAX_MCP_TOOLS_PER_RUN);
          enhancedTools.push(...cappedTools);
          logger.info('mcp.tools_loaded', { runId: run.id, mcpToolCount: cappedTools.length, serverCount: mcp.clients.size });
        }
      } catch (err) {
        logger.warn('mcp.connect_failed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
        // Non-fatal — agent runs without MCP tools
      }

      // ── 6. Build task context (with smart offloading) ───────────────────
      let workspaceContext = '';
      let targetItem: typeof tasks.$inferSelect | null = null;

      if (request.taskId) {
        const item = await taskService.getTask(request.taskId, request.organisationId);
        targetItem = item;
        workspaceContext = buildTaskContext(item);
      } else {
        workspaceContext = await buildSmartBoardContext(
          request.organisationId,
          request.subaccountId!,
          request.agentId
        );
      }

      // ── 7. Build the full system prompt (3-layer assembly) ─────────────
      // Layer 1: System agent prompt (our IP — invisible to org/sub-account)
      const effectiveMasterPrompt = systemAgentRecord
        ? systemAgentRecord.masterPrompt
        : agent.masterPrompt;

      const basePrompt = buildSystemPrompt(
        effectiveMasterPrompt,
        dataSourceContents,
        orgProcesses,
        undefined,
        runContextData.externalDocumentBlocks,
      );

      // ── Thread context injection (A-D1) ─────────────────────────────────────
      // Prepended first — before external docs, memory blocks, and all other
      // augmentation. Spec §2.2 ordering invariant. Fail-open: a build error
      // skips injection rather than aborting the run.
      let effectiveBasePrompt = basePrompt;
      const THREAD_CTX_TIMEOUT = Symbol('timeout');
      const runConvId =
        request.conversationId ??
        (request.triggerContext?.conversationId as string | undefined) ??
        undefined;
      if (runConvId) {
        const _threadCtxStart = Date.now();
        let threadCtx: ThreadContextReadModel | null = null;
        try {
          let _threadCtxTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const ctxResult = await Promise.race<ThreadContextReadModel | typeof THREAD_CTX_TIMEOUT>([
            buildThreadContextReadModel(runConvId, request.organisationId),
            new Promise<typeof THREAD_CTX_TIMEOUT>((resolve) => {
              _threadCtxTimeoutHandle = setTimeout(() => resolve(THREAD_CTX_TIMEOUT), 500);
            }),
          ]);
          if (_threadCtxTimeoutHandle !== undefined) clearTimeout(_threadCtxTimeoutHandle);
          if (ctxResult === THREAD_CTX_TIMEOUT) {
            logger.warn('thread_ctx.timeout', { runId: run.id });
          } else {
            threadCtx = ctxResult;
          }
        } catch (err) {
          logger.warn('thread_ctx.build_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        logger.debug('thread_ctx.build_ms', { ms: Date.now() - _threadCtxStart, runId: run.id });
        if (threadCtx && typeof threadCtx.version === 'number') {
          const threadBlock = formatThreadContextBlock(threadCtx);
          if (threadBlock) {
            effectiveBasePrompt = prependThreadContextToBasePrompt(threadBlock, basePrompt);
            // Persist version for drift detection — fire-and-forget, best-effort
            void db
              .update(agentRuns)
              .set({
                runMetadata: {
                  ...(run.runMetadata ?? {}),
                  threadContextVersionAtStart: threadCtx.version,
                },
              })
              .where(eq(agentRuns.id, run.id))
              .catch(() => {});
          }
        }
      }

      const systemPromptParts = [effectiveBasePrompt];

      // Layer 1b: System skill instructions
      if (systemSkillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Core Capabilities\n${systemSkillInstructions.join('\n\n')}`);
      }

      // Layer 2: Org additional prompt (invisible to sub-account)
      if (agent.additionalPrompt) {
        systemPromptParts.push(`\n\n---\n## Organisation Instructions\n${agent.additionalPrompt}`);
      }

      // Layer 2a: Shared memory blocks — composes explicit attachments +
      // relevance-ranked active blocks (spec §5.2, S6). The block-status
      // invariant (`status='active'` only) is enforced inside the service.
      //
      // Relevance retrieval requires a task context. When no task is in flight
      // (e.g., smart-board runs), the workspace-context string derived above
      // acts as the query text. Explicit attachments always pass through and
      // ensure zero regression for agents configured with pinned blocks.

      // Derive agent domain early — needed for tier-2 block filtering (F1 §4)
      // and for workspace memory retrieval below.
      const agentDomain = agentRoleToDomain(agent.agentRole) ?? undefined;

      // Tier-1 baseline artefacts: pinned, hash-stable, always present when captured.
      // Spec: docs/sub-account-baseline-artefacts-spec.md §4.
      const tier1Blocks = await memoryBlockService.getTier1Blocks(
        request.organisationId,
        request.subaccountId ?? null,
      );

      const memoryBlocksForPrompt = await memoryBlockService.getBlocksForInjection({
        agentId: request.agentId,
        subaccountId: request.subaccountId ?? null,
        organisationId: request.organisationId,
        taskContext: workspaceContext,
        agentDomain,
      });

      // Prepend tier-1 ahead of the relevance/explicit set.
      // Dedupe: if a tier-1 block also appears via explicit attachment, tier-1 entry wins.
      const tier1BlockIds = new Set(tier1Blocks.map((b) => b.id));
      const composedBlocks = [
        ...tier1Blocks.map((b) => ({ ...b, permission: 'read' as const })),
        ...memoryBlocksForPrompt.filter((b) => !tier1BlockIds.has(b.id)),
      ];

      // F1 §4 — emit one telemetry event per tier-1 and tier-2 baseline block injected.
      for (const block of composedBlocks) {
        const blockTier: 1 | 2 | null = tier1BlockIds.has(block.id)
          ? 1
          : (block as { tier?: 1 | 2 | null }).tier === 2
          ? 2
          : null;
        if (blockTier === 1 || blockTier === 2) {
          createEvent('baseline_artefact.tier_loaded', {
            organisation_id: request.organisationId,
            subaccount_id: request.subaccountId ?? null,
            agent_role: agent.agentRole,
            tier: blockTier,
            block_slug: block.name,
            token_count: approxTokens(block.content),
          });
        }
      }

      const memoryBlocksSection = memoryBlockService.formatBlocksForPrompt(composedBlocks);
      if (memoryBlocksSection) {
        systemPromptParts.push(`\n\n---\n${memoryBlocksSection}`);
      }
      // Phase 8 / W3c — log injected block IDs for provenance trail
      const injectedBlockIds = composedBlocks.map((b) => b.id);
      if (injectedBlockIds.length > 0) {
        void db
          .update(agentRuns)
          .set({ appliedMemoryBlockIds: injectedBlockIds })
          .where(eq(agentRuns.id, run.id))
          .catch(() => {});
      }

      // Layer 2b: Org skill instructions
      if (skillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Your Capabilities\n${skillInstructions.join('\n\n')}`);
      }

      // Layer 3: Custom instructions (from subaccount link or org config)
      if (configCustomInstructions) {
        systemPromptParts.push(`\n\n---\n## Additional Instructions\n${configCustomInstructions}`);
      }

      // Add team roster (loaded fresh from DB every run)
      // Team roster is placed in the stable prefix (changes only on agent config edit)
      const teamRoster = await buildTeamRoster(request.subaccountId!, request.agentId);
      if (teamRoster) {
        systemPromptParts.push(`\n\n---\n## Your Team\nYou can reassign tasks to or create tasks for any of these agents:\n${teamRoster}`);
      }

      // ── Stable/dynamic split for multi-breakpoint prompt caching (Phase 0C) ──
      // Sections 1-6 + team roster = stablePrefix (cached across runs)
      // Briefing, task instructions, manifest, memory, entities, board, autonomous = dynamicSuffix
      const stablePrefix = systemPromptParts.join('');
      const dynamicParts: string[] = [];

      // Phase 2D: Agent briefing — compact cross-run summary (dynamic — updates after each run)
      try {
        const briefing = await agentBriefingService.get(
          request.organisationId,
          request.subaccountId!,
          request.agentId,
        );
        if (briefing) {
          dynamicParts.push(`\n\n---\n## Your Briefing\n${briefing}`);
        }
      } catch {
        // Non-fatal — agent runs fine without a briefing
      }

      // Phase 1: Agent beliefs — discrete facts (dynamic — updated after each run)
      try {
        const beliefs = await agentBeliefService.getActiveBeliefs(
          request.organisationId,
          request.subaccountId!,
          request.agentId,
        );
        if (beliefs.length > 0) {
          dynamicParts.push(`\n\n---\n## Your Beliefs\n${agentBeliefService.formatBeliefsForPrompt(beliefs)}`);
        }
      } catch {
        // Non-fatal — agent runs fine without beliefs
      }

      // Layer 3.5: Task Instructions (dynamic — changes per scheduled task)
      if (runContextData.taskInstructions) {
        dynamicParts.push(
          `\n\n---\n## Task Instructions\nYou are executing a recurring task. Follow these instructions precisely:\n\n${runContextData.taskInstructions}`
        );
      }

      // Layer 3.6: Available Context Sources — the lazy manifest (dynamic — varies per run)
      if (runContextData.manifestForPrompt.length > 0) {
        const scopeLabels: Record<string, string> = {
          task_instance: 'task attachment',
          scheduled_task: 'scheduled task',
          subaccount: 'subaccount',
          agent: 'agent',
        };
        const manifestLines = runContextData.manifestForPrompt.map((s) => {
          const scopeLabel = scopeLabels[s.scope] ?? s.scope;
          const sizeHint = s.sizeBytes > 0 ? ` (~${Math.round(s.sizeBytes / 1024)}KB)` : '';
          const unreadable = !s.fetchOk ? ' [binary — not readable]' : '';
          const desc = s.description ? ` — ${s.description}` : '';
          return `- **${s.name}** [${scopeLabel}]${sizeHint}${unreadable}${desc} (id: \`${s.id}\`)`;
        }).join('\n');

        const elidedNote = runContextData.manifestElidedCount > 0
          ? `\n\n_${runContextData.manifestElidedCount} additional source(s) are available but not listed here to keep the prompt compact. Call \`read_data_source\` with \`op: 'list'\` to see the full inventory._`
          : '';

        dynamicParts.push(
          `\n\n---\n## Available Context Sources\nThe following additional reference materials are available. Use the \`read_data_source\` tool to fetch any of them on demand:\n\n${manifestLines}${elidedNote}`
        );
      }

      // Add workspace memory (with prompt injection boundaries)
      // Pass task context for semantic retrieval when available
      const taskContextForMemory = targetItem
        ? `${targetItem.title ?? ''}${targetItem.description ? ' ' + targetItem.description : ''}`
        : undefined;

      let memory: string | null = null;
      // Phase 2 S12: track injected memory entries for the citation detector
      // hook at run completion.
      const memoryWithTracking = await workspaceMemoryService.getMemoryForPromptWithTracking(
        request.organisationId,
        request.subaccountId!,
        taskContextForMemory,
        agentDomain,
      );
      memory = memoryWithTracking.promptText;
      const injectedMemoryEntries = memoryWithTracking.injectedEntries;
      if (memory) {
        dynamicParts.push(`\n\n---\n## Workspace Memory\n${memory}`);
      }

      const entities = await workspaceMemoryService.getEntitiesForPrompt(
        request.subaccountId!,
        request.organisationId,
      );
      if (entities) {
        dynamicParts.push(`\n\n---\n## Known Workspace Entities\n${entities}`);
      }

      if (workspaceContext) {
        dynamicParts.push(`\n\n---\n## Current Board\n${workspaceContext}`);
      }

      // Phase 3B: Subaccount state summary — operational snapshot (task counts, run stats)
      try {
        const stateSummary = await subaccountStateSummaryService.getOrGenerate(
          request.organisationId,
          request.subaccountId!,
        );
        if (stateSummary) {
          dynamicParts.push(`\n\n---\n${stateSummary}`);
        }
      } catch {
        // Non-fatal — agent runs fine without the state summary
      }

      dynamicParts.push(buildAutonomousInstructions(request, targetItem));

      // agent_decision steps inject a structured decision envelope at the end
      // of the system prompt so the agent sees branch options and output schema.
      if (request.systemPromptAddendum) {
        dynamicParts.push(`\n\n---\n${request.systemPromptAddendum}`);
      }

      const dynamicSuffix = dynamicParts.join('');
      const fullSystemPrompt = stablePrefix + dynamicSuffix;
      const systemPromptTokens = approxTokens(fullSystemPrompt);

      // Live Agent Execution Log — persist the fully-assembled prompt + emit
      // prompt.assembled event. Best-effort layer attributions (spec §5.6):
      // we record offsets for the top-level layers we know about but do not
      // drill into memory-block-level attribution in P1 — that's a follow-up
      // when buildSystemPrompt learns to return per-layer offsets natively.
      try {
        const layerAttributions = {
          master: { startOffset: 0, length: Buffer.byteLength(stablePrefix, 'utf8') },
          orgAdditional: { startOffset: 0, length: 0 },
          memoryBlocks: [] as Array<{ blockId: string; startOffset: number; length: number }>,
          skillInstructions: [] as Array<{ skillSlug: string; startOffset: number; length: number }>,
          taskContext: {
            startOffset: Buffer.byteLength(stablePrefix, 'utf8'),
            length: Buffer.byteLength(dynamicSuffix, 'utf8'),
          },
        };
        const { promptRowId, assemblyNumber } = await persistPromptAssembly({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          systemPrompt: fullSystemPrompt,
          userPrompt: targetItem?.description ?? targetItem?.title ?? '',
          toolDefinitions: [],
          layerAttributions,
          totalTokens: systemPromptTokens,
        });
        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'agentExecutionService',
          payload: {
            eventType: 'prompt.assembled',
            critical: false,
            assemblyNumber,
            promptRowId,
            totalTokens: systemPromptTokens,
            layerTokens: {
              master: approxTokens(stablePrefix),
              orgAdditional: 0,
              memoryBlocks: 0,
              skillInstructions: 0,
              taskContext: approxTokens(dynamicSuffix),
            },
          },
          linkedEntity: { type: 'prompt', id: promptRowId },
        });
      } catch (err) {
        logger.warn('agentExecutionService.prompt_assembled_persist_failed', {
          runId: run.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Persist the context sources snapshot (spec §7.5). Captures every
      // entry considered at run-start time — winners, suppressed losers,
      // lazy manifest, eager-but-budget-excluded. Used by the run detail
      // UI Context Sources panel for debugging.
      const allForSnapshot = [
        ...runContextData.eager,
        ...runContextData.manifest,
        ...runContextData.suppressed,
      ];
      const contextSourcesSnapshot = allForSnapshot.map((s) => ({
        id: s.id,
        scope: s.scope,
        name: s.name,
        description: s.description,
        contentType: s.contentType,
        sizeBytes: s.sizeBytes,
        tokenCount: s.tokenCount,
        fetchOk: s.fetchOk,
        // orderIndex is always assigned in runContextLoader step 5,
        // BEFORE suppression, so every entry carries a stable index.
        orderIndex: s.orderIndex!,
        includedInPrompt: s.includedInPrompt ?? false,
        truncated: s.truncated ?? false,
        suppressedByOverride: s.suppressedByOverride ?? false,
        suppressedBy: s.suppressedBy,
        exclusionReason: (() => {
          if (s.suppressedByOverride) return 'override_suppressed' as const;
          if (!s.includedInPrompt) return 'budget_exceeded' as const;
          return null;
        })(),
      }));

      await db.update(agentRuns).set({
        memoryStateAtStart: memory ?? null,
        skillsUsed: [
          ...(systemAgentRecord ? ((systemAgentRecord.defaultSystemSkillSlugs ?? []) as string[]).map(s => `system:${s}`) : []),
          ...skillSlugs,
        ],
        systemPromptTokens,
        contextSourcesSnapshot,
      }).where(eq(agentRuns.id, run.id));

      // Live Agent Execution Log — emit one context.source_loaded per
      // source. Payload is a slice of the existing contextSourcesSnapshot
      // struct; reused directly. Fire-and-forget per §4.1.
      for (const s of allForSnapshot) {
        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'runContextLoader',
          payload: {
            eventType: 'context.source_loaded',
            critical: false,
            sourceId: s.id,
            sourceName: s.name ?? 'unknown',
            scope: s.scope ?? 'unknown',
            contentType: s.contentType ?? 'text',
            tokenCount: s.tokenCount ?? 0,
            includedInPrompt: s.includedInPrompt ?? false,
            exclusionReason: (() => {
              if (s.suppressedByOverride) return 'override_suppressed';
              if (!s.includedInPrompt) return 'budget_exceeded';
              return undefined;
            })(),
          },
          linkedEntity: { type: 'data_source', id: s.id },
        });
      }

      // H-5: store large snapshot in agent_run_snapshots (keep agent_runs lean)
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, systemPromptSnapshot: fullSystemPrompt })
        .onConflictDoNothing();

      // ── 8. Execute — dispatch through executionBackendRegistry ──────────
      // Chunk 5 of the ExecutionBackend Adapter Contract refactor replaces
      // the pre-Chunk-5 if/else ladder with a single registry resolve +
      // dispatch. Each adapter owns its own dispatch body in
      // `server/services/executionBackends/`. The post-completion
      // finalisation block below consumes `loopResult` exactly as the
      // inline branches produced it.
      //
      // Per-adapter validation (`IEE_TASK_REQUIRED`, `IEE_TASK_TYPE_MISMATCH`,
      // and the `BackendOptionsMismatch` invariant) lives inside the
      // adapter's own `dispatch()` body — see `_ieeShared.ts::ieeDispatch`.
      // The dispatch site here neither knows nor cares which executionMode
      // is in flight.
      const effectiveMode: ExecutionMode = request.executionMode ?? 'api';

      // agent_decision steps restrict the tool list to prevent side effects.
      // allowedToolSlugs: [] means no tools (pure reasoning). When undefined,
      // the full enhancedTools list is used (normal agent behavior).
      // Built unconditionally — the api/headless adapters consume it via
      // `loopContext.tools`; other adapters ignore it.
      const effectiveTools =
        request.allowedToolSlugs !== undefined
          ? enhancedTools.filter(t => (request.allowedToolSlugs as string[]).includes(t.name))
          : enhancedTools;

      // Middleware pipeline — used by the in-process agentic loop. Built
      // here (not inside the adapter) because `runAgenticLoop` requires
      // a single instance threaded through every iteration.
      const pipeline = createDefaultPipeline();

      // Closure-context bundle assembled from the variables in scope here
      // and forwarded to the api/headless adapters via
      // `BackendDispatchInput.backendOptions.loopContext`. See
      // `executionBackends/options.ts:ApiHeadlessLoopContext`.
      const closureContext: ExecutionClosureContext = {
        agent,
        effectiveTools,
        pipeline,
        mcpClients,
        mcpLazyRegistry,
        runContextData,
        saLink: saLink!,
        agentDomain,
        configVersion: fingerprint(resolvedConfig),
        hierarchyContext,
        orgProcesses,
        request,
        startTime,
        isOrgSubaccountRun,
        maxLoopIterations: CONTROLLER_LIMITS[run.controllerStyle].maxLoopIterations,
        // Routing context for the LLM router — built here because
        // `run.id` and `agent.name` are only in scope at the dispatch
        // site. Mirrors the pre-Chunk-5 inline construction.
        routerCtx: {
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? undefined,
          runId: run.id,
          subaccountAgentId: request.subaccountAgentId ?? undefined,
          agentName: agent.name,
          sourceType: 'agent_run',
        },
        // Claude Code runner consumes a task prompt (workspace summary or
        // a default fallback if the workspace is empty).
        taskPrompt: workspaceContext || 'Review the current workspace and report status.',
      };

      const backend = executionBackendRegistry.resolve(effectiveMode);
      let loopResult: LoopResult;

      try {
        const dispatchResult = await backend.dispatch({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          agentId: request.agentId,
          promptAssembly: { stablePrefix, dynamicSuffix },
          tokenBudget,
          maxToolCalls,
          timeoutMs,
          backendOptions: buildBackendOptionsForMode(effectiveMode, request, closureContext),
        });

        if (dispatchResult.lifecycle === 'delegated') {
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
            ieeRunId: dispatchResult.backendTaskId ?? undefined,
            delegationDeduplicated: dispatchResult.deduplicated,
          };
        }

        // In-process / subprocess: the loop ran inline and the adapter
        // returned the loop result. The post-completion finalisation
        // block below handles the terminal write + side-effects.
        loopResult = dispatchResult.loopResult!;
      } catch (err) {
        if (err instanceof ParentRunNotDispatchable) {
          // The parent run moved past the delegation window before the
          // adapter could claim it (cancellation racing dispatch, or a
          // duplicate dispatch). The adapter has already written the
          // backend-side orphan-cleanup row. Surface the parent's
          // current terminal status so the caller sees a consistent
          // result rather than a 5xx.
          const [currentRow] = await db
            .select({ status: agentRuns.status })
            .from(agentRuns)
            .where(eq(agentRuns.id, run.id))
            .limit(1);
          const observedStatus = currentRow?.status ?? 'failed';
          logger.warn('agentExecutionService.parent_not_dispatchable', {
            runId: run.id,
            mode: effectiveMode,
            observedStatus,
            reason: err.reason,
          });
          // Map to the closed `AgentRunResult.status` union — non-terminal
          // observed values fall back to 'failed' for the response (the
          // row itself is unchanged).
          const responseStatus: AgentRunResult['status'] =
            observedStatus === 'completed' ? 'completed'
            : observedStatus === 'failed' ? 'failed'
            : observedStatus === 'timeout' ? 'timeout'
            : observedStatus === 'loop_detected' ? 'loop_detected'
            : observedStatus === 'budget_exceeded' ? 'budget_exceeded'
            : 'failed';
          return {
            runId: run.id,
            status: responseStatus,
            summary: null,
            totalToolCalls: 0,
            totalTokens: 0,
            durationMs: Date.now() - startTime,
            tasksCreated: 0,
            tasksUpdated: 0,
            deliverablesCreated: 0,
          };
        }
        throw err;
      }

      // ── 9. Finalise the run ─────────────────────────────────────────────
      const durationMs = Date.now() - startTime;
      let finalStatus = (loopResult.finalStatus ?? 'completed') as
        'completed' | 'completed_with_uncertainty' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded' | 'cancelled';

      if (loopResult.finalStatus === 'blocked_awaiting_integration') {
        // Run is paused — do NOT write completedAt or trigger finalisation.
        // The blocked state has already been persisted inside the loop.
        return {
          runId: run.id,
          status: 'blocked_awaiting_integration' as AgentRunResult['status'],
          summary: null,
          totalToolCalls: loopResult.totalToolCalls,
          totalTokens: loopResult.totalTokens,
          durationMs,
          tasksCreated: loopResult.tasksCreated,
          tasksUpdated: loopResult.tasksUpdated,
          deliverablesCreated: loopResult.deliverablesCreated,
        };
      }

      // Pre-fetch runMetadata once — consumed by both the Reporting Agent
      // finalize hook and Phase B's runResultStatus derivation (which reads
      // `hadUncertainty` from runMetadata, where the clarification-timeout
      // job writes it).
      const [preFinalizeRow] = await db
        .select({ runMetadata: agentRuns.runMetadata, errorMessage: agentRuns.errorMessage })
        .from(agentRuns)
        .where(eq(agentRuns.id, run.id))
        .limit(1);
      const preFinalizeMetadata =
        (preFinalizeRow?.runMetadata ?? null) as Record<string, unknown> | null;

      // T25 / T16 — Reporting Agent end-of-run hook. Runs the invariant
      // and persists the content fingerprint. No-op for non-Reporting-Agent
      // runs. Spec v3.4 §6.7.2 / §8.4.2.
      if (finalStatus === 'completed') {
        try {
          const { finalizeReportingAgentRun } = await import('../lib/reportingAgentRunHook.js');
          await finalizeReportingAgentRun({
            runId: run.id,
            subaccountAgentId: request.subaccountAgentId ?? null,
            organisationId: request.organisationId,
            runMetadata: preFinalizeMetadata,
          });
        } catch (err) {
          // Invariant or persist failed — downgrade to failed so the run
          // does not flip to completed in an inconsistent state.
          logger.error('reportingAgent.finalize_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
          finalStatus = 'failed';
        }
      }

      // Hermes Tier 1 Phase B §6.3 — derive runResultStatus for the
      // terminal write. `hadUncertainty` lives on runMetadata (the
      // clarification-timeout job at `clarificationTimeoutJob.ts` writes
      // it there); `hasError` is inferred from finalStatus; `hasSummary`
      // is the trimmed-length > 0 check.
      const hadUncertainty = preFinalizeMetadata?.hadUncertainty === true;
      const hasSummary = !!(loopResult.summary && loopResult.summary.trim().length > 0);
      const derivedRunResultStatus = computeRunResultStatus(
        finalStatus,
        /* hasError — only affects the 'completed' branch of computeRunResultStatus;
           ignored for all other terminal statuses which return directly */ finalStatus !== 'completed',
        hadUncertainty,
      );
      // H3: hasSummary is no longer passed to computeRunResultStatus. Summary absence
      // is surfaced via the summaryMissing side-channel below, not via 'partial' status.

      // Write-once guard (§6.3.1): add `AND run_result_status IS NULL` so
      // a second attempt at the same terminal write becomes a zero-row
      // UPDATE rather than an overwrite. `.returning()` lets us detect
      // that and log rather than silently drift from the first writer's
      // value.
      //
      // Round-3 review note: this terminal write does not yet flow through
      // `assertValidTransition`. The `runResultStatus IS NULL` predicate
      // already guards against overwriting a terminal row, but we log the
      // transition with `guarded: false` so operators can quantify the
      // unguarded-by-assert surface area against the F6 follow-up spec.
      logger.info('state_transition', describeTransition({
        kind: 'agent_run',
        recordId: run.id,
        to: finalStatus,
        site: 'agentExecutionService.finishLoop_normal',
        guarded: false,
      }));
      const terminalUpdate = await db.update(agentRuns).set({
        status: finalStatus,
        runResultStatus: derivedRunResultStatus,
        totalToolCalls: loopResult.totalToolCalls,
        inputTokens: loopResult.inputTokens,
        outputTokens: loopResult.outputTokens,
        totalTokens: loopResult.totalTokens,
        summary: loopResult.summary,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
        lastActivityAt: new Date(),
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      })
        .where(and(eq(agentRuns.id, run.id), isNull(agentRuns.runResultStatus)))
        .returning({ id: agentRuns.id, nextEventSeq: agentRuns.nextEventSeq });
      if (terminalUpdate.length === 0) {
        logger.warn('runResultStatus.write_skipped', {
          runId: run.id,
          attemptedStatus: derivedRunResultStatus,
          writeSite: 'finishLoop_normal',
        });
      } else {
        // F22 — meaningful-run tracking hook for the non-IEE finalization path.
        // The IEE path calls this from the IEE adapter's post-commit hook
        // (`executionBackends/_ieeShared.ts::ieeFinalise`); without this
        // call, ordinary API/triggered runs never advance
        // `subaccount_agents.last_meaningful_tick_at` /
        // `ticks_since_last_meaningful_run`, which leaves the heartbeat
        // streak detector blind to the primary execution path. Best-effort —
        // a tracking-update failure must not flip a successful run to failed.
        try {
          const { updateMeaningfulRunTracking } = await import('./agentRunFinalizationService.js');
          await updateMeaningfulRunTracking(run.id, finalStatus);
        } catch (err) {
          logger.warn('agentExecutionService.meaningful_hook_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Live Agent Execution Log — critical terminal bookend (spec §5.3).
      // totalCostCents is read from the ledger; eventCount from the
      // just-returned nextEventSeq (number of events emitted so far this
      // run, which bounds the event count at this terminal).
      let totalCostCents = 0;
      try {
        const { getRunCostCentsFromLedger } = await import('../lib/runCostBreaker.js');
        totalCostCents = await getRunCostCentsFromLedger(run.id);
      } catch (err) {
        logger.warn('agentExecutionService.run_completed_cost_lookup_failed', {
          runId: run.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // nextEventSeq is the highest sequence allocated before the terminal
      // event. Add 1 to count the run.completed event itself, so the
      // eventCount in the payload matches the number of rows the client
      // will see when it fetches /events (including this terminal event).
      const eventCount = (terminalUpdate[0]?.nextEventSeq ?? 0) + 1;
      tryEmitAgentEvent({
        runId: run.id,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        sourceService: 'agentExecutionService',
        payload: {
          eventType: 'run.completed',
          critical: true,
          finalStatus,
          totalTokens: loopResult.totalTokens,
          totalCostCents,
          totalDurationMs: durationMs,
          eventCount,
        },
      });

      // H3: summaryMissing side-channel — emit only when hasSummary is false so
      // consumers can correlate without demoting runResultStatus to 'partial'.
      if (!hasSummary) {
        tryEmitAgentEvent({
          runId: run.id,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          sourceService: 'agentExecutionService',
          payload: {
            eventType: 'run.terminal.summary_missing',
            critical: false,
            runResultStatus: derivedRunResultStatus ?? 'partial',
          },
        });
      }

      // Emit retrieval.summary event — spec §10.4, §11.4, Chunk 4B.
      // Fire-and-forget: partial-unique-index (run_id, event_type='retrieval.summary')
      // makes concurrent emits idempotent. Non-critical: failure logs and continues.
      {
        const { emitRetrievalSummary } = await import('./retrievalObservabilityService.js');
        const { DEFAULT_CHUNK_TARGET_TOKENS, DEFAULT_CHUNK_OVERLAP_TOKENS } = await import('./documentChunkingServicePure.js');
        const retrievalSummaryPromise = emitRetrievalSummary({
          runId: run.id,
          organisationId: request.organisationId,
          result: retrievalResult,
          chunkConfig: { targetTokens: DEFAULT_CHUNK_TARGET_TOKENS, overlapTokens: DEFAULT_CHUNK_OVERLAP_TOKENS },
        }).catch((err: unknown) => {
          logger.warn('agentExecutionService.retrieval_summary_emit_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Observation emit for retrieval-summary — spec §7.3 Rev 2 composition.
        // Chains off retrievalSummaryPromise so the event row exists before the
        // FK-referencing observation row is inserted. Fire-and-forget: observation
        // failure does NOT roll back the retrieval-summary event.
        retrievalSummaryPromise.then(async () => {
          const { append } = await import('./agentObservationService.js');
          const orgDb = getOrgScopedDb('agentExecutionService.observation_retrieval_summary');
          const [eventRow] = await orgDb
            .select({ id: agentExecutionEvents.id })
            .from(agentExecutionEvents)
            .where(
              and(
                eq(agentExecutionEvents.runId, run.id),
                eq(agentExecutionEvents.eventType, 'retrieval.summary'),
              ),
            )
            .limit(1);
          if (!eventRow) return; // event was deduplicated away before we could observe it
          const ik = createHash('sha256').update(`${run.id}:retrieval_summary`).digest('hex');
          const ctx: ServicePrincipal = {
            type: 'service',
            id: 'agentExecutionService',
            organisationId: request.organisationId,
            subaccountId: request.subaccountId ?? null,
            serviceId: 'agentExecutionService',
            teamIds: [],
          };
          return append(
            {
              agentId: run.agentId,
              eventId: eventRow.id,
              observationType: 'learned',
              body: 'Retrieval summary produced',
              metadata: { source_kind: 'retrieval_summary' },
              idempotencyKey: ik,
            },
            ctx,
          );
        }).then((observation) => {
          if (!observation) return;
          tryEmitAgentEvent({
            runId: run.id,
            organisationId: request.organisationId,
            subaccountId: request.subaccountId ?? null,
            sourceService: 'agentExecutionService',
            payload: {
              eventType: 'observation_emitted',
              critical: false,
              observationId: observation.id,
              observationType: 'learned',
              agentId: run.agentId,
              sourceKind: 'retrieval_summary',
            },
          });
        }).catch((err: unknown) => {
          logger.warn('agentExecutionService.observation_retrieval_summary_emit_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Surface terminal failures as system incidents for operator visibility.
      if (finalStatus === 'failed' || finalStatus === 'timeout' || finalStatus === 'loop_detected') {
        recordIncident({
          source: 'agent',
          summary: `Agent run ${finalStatus}: ${loopResult.summary?.slice(0, 200) ?? '(no summary)'}`,
          errorCode: finalStatus,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          correlationId: run.correlationId ?? undefined,
          errorDetail: { runId: run.id, finalStatus },
        });
      }

      // Brain Tree OS adoption P1 — build the structured handoff document
      // and persist it. Best-effort: a build failure logs and leaves the
      // column null. The run completion above is the source-of-truth state
      // change; this is a follow-up enrichment.
      try {
        const { buildHandoffForRun } = await import('./agentRunHandoffService.js');
        const handoff = await buildHandoffForRun(run.id, request.organisationId);
        if (handoff !== null) {
          await db.update(agentRuns)
            .set({ handoffJson: handoff })
            .where(eq(agentRuns.id, run.id));
        }
      } catch (err) {
        logger.warn('agent_runs.handoff_build_failed', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Phase 2 (S12) — score injected memory entries against run output.
      // Idempotent: second call is a PK no-op. Best-effort: failure logs
      // and does not affect the run's persisted state.
      if (finalStatus === 'completed' && injectedMemoryEntries.length > 0) {
        try {
          const { scoreRun } = await import('./memoryCitationDetector.js');
          const generatedText = typeof loopResult.summary === 'string'
            ? loopResult.summary
            : '';
          const toolCallArgs = Array.isArray(loopResult.toolCallsLog)
            ? loopResult.toolCallsLog
                .map((tc: unknown) => (tc as { input?: unknown })?.input)
                .filter((v) => v !== undefined && v !== null)
            : [];
          await scoreRun({
            runId: run.id,
            organisationId: request.organisationId,
            injectedEntries: injectedMemoryEntries,
            generatedText,
            toolCallArgs,
          });
        } catch (err) {
          logger.warn('agent_runs.citation_score_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Phase 8 / W3c — score applied memory_blocks against run output.
      // Reads appliedMemoryBlockIds populated at injection time (line ~774).
      // Best-effort: scoreRunBlocks swallows errors internally.
      if (finalStatus === 'completed') {
        try {
          const [runRow] = await db
            .select({ appliedMemoryBlockIds: agentRuns.appliedMemoryBlockIds })
            .from(agentRuns)
            .where(eq(agentRuns.id, run.id))
            .limit(1);
          const appliedBlockIds = runRow?.appliedMemoryBlockIds ?? [];
          if (appliedBlockIds.length > 0) {
            const { scoreRunBlocks } = await import('./memoryCitationDetector.js');
            const generatedText = typeof loopResult.summary === 'string'
              ? loopResult.summary
              : '';
            await scoreRunBlocks({
              runId: run.id,
              organisationId: request.organisationId,
              appliedBlockIds,
              runOutputText: generatedText,
            });
          }
        } catch (err) {
          logger.warn('agent_runs.block_citation_score_failed', {
            runId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Universal Brief artefact emission hook (Phase 2+).
      // Phase 1 prep only: the import above makes validateArtefactForPersistence
      // available here. Capabilities that produce BriefChatArtefacts will call
      // validateArtefactForPersistence() and persist to conversation_messages
      // once Phase 2 tables are in place.
      void validateArtefactForPersistence; // reference prevents dead-import lint removal

      // H-5: upsert toolCallsLog into the snapshot table
      await db.insert(agentRunSnapshots)
        .values({ runId: run.id, toolCallsLog: loopResult.toolCallsLog })
        .onConflictDoUpdate({
          target: agentRunSnapshots.runId,
          set: { toolCallsLog: loopResult.toolCallsLog },
        });

      // Sprint 3 P2.1 Sprint 3A — project the legacy toolCallsLog shape
      // from the append-only agent_run_messages log as an observability
      // check. The inline writer above is still the Sprint 3A source of
      // truth; this side call validates that the projection path is
      // consistent so Sprint 3B can drop the inline writer safely.
      //
      // Best-effort: any projection failure is logged and swallowed —
      // it must never block run completion or fail the request.
      try {
        const projected = await projectToolCallsLogFromMessages(run.id, request.organisationId);
        const inlineCount = loopResult.toolCallsLog.length;
        const projectedCount = projected.length;
        if (inlineCount !== projectedCount) {
          logger.warn('agent_run_messages.projection_mismatch', {
            runId: run.id,
            inlineCount,
            projectedCount,
          });
        }
      } catch (err) {
        logger.warn('agent_run_messages.projection_failed', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Update lastRunAt on subaccount_agents
      if (request.subaccountAgentId) {
        await db.update(subaccountAgents).set({
          lastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(subaccountAgents.id, request.subaccountAgentId));
      }

      // Emit run completed event
      emitAgentRunUpdate(run.id, 'agent:run:completed', {
        status: finalStatus, summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls, totalTokens: loopResult.totalTokens,
        tasksCreated: loopResult.tasksCreated, durationMs,
      });

      // Workflows: if this agent run was dispatched by a Workflow step, route
      // its result back to the engine so the step run can be marked completed
      // and the next tick fired. Hook is non-blocking — failures are logged
      // and do not affect the agent run completion.
      try {
        const { notifyWorkflowEngineOnAgentRunComplete } = await import('./workflowAgentRunHook.js');
        await notifyWorkflowEngineOnAgentRunComplete(run.id, {
          ok: true,
          output: { summary: loopResult.summary ?? '' },
        });
      } catch (err) {
        console.error('[AgentExecution] Workflow hook failed (non-fatal)', err);
      }
      emitSubaccountUpdate(request.subaccountId!, 'live:agent_completed', {
        runId: run.id, agentId: request.agentId, status: finalStatus,
      });

      // ── 10. Extract insights for workspace memory + entities ─────────────
      if (loopResult.summary) {
        try {
          // Hermes Tier 1 Phase B §6.4 — thread the outcome through so
          // extractRunInsights can branch entry-type promotion, quality
          // scoring, and provenance confidence per §6.5 / §6.7. The
          // primary agent-run completion path always passes a non-null
          // `runResultStatus` here (when derivedRunResultStatus is null
          // the run is not terminal and this branch is unreachable).
          // HERMES-S1: thread errorMessage from the pre-finalize DB read so
          // failed-without-throw runs surface the error to extractRunInsights.
          const threadedErrorMessage = derivedRunResultStatus === 'failed'
            ? (preFinalizeRow?.errorMessage ?? null)
            : null;
          if (threadedErrorMessage !== null) {
            tryEmitAgentEvent({
              runId: run.id,
              organisationId: request.organisationId,
              subaccountId: request.subaccountId ?? null,
              sourceService: 'agentExecutionService',
              payload: {
                eventType: 'run.terminal.extracted_with_errorMessage',
                critical: false,
                errorMessageLength: threadedErrorMessage.length,
              },
            });
          }
          const extractionOutcome = {
            runResultStatus: (derivedRunResultStatus ?? 'partial') as 'success' | 'partial' | 'failed',
            trajectoryPassed: null as boolean | null,
            errorMessage: threadedErrorMessage,
          };
          await workspaceMemoryService.extractRunInsights(
            run.id,
            request.agentId,
            request.organisationId,
            request.subaccountId!,
            loopResult.summary,
            extractionOutcome,
          );
        } catch (err) {
          console.error(`[AgentExecution] Memory extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        }

        // Entity extraction (non-blocking)
        workspaceMemoryService.extractEntities(
          run.id,
          request.organisationId,
          request.subaccountId!,
          loopResult.summary
        ).catch(err => {
          console.error(`[AgentExecution] Entity extraction failed for run ${run.id}:`, err instanceof Error ? err.message : err);
        });

        // Phase 2D: Enqueue agent briefing update (non-blocking, pg-boss only)
        import('./queueService.js').then(({ queueService }) => {
          if ('send' in queueService) {
            (queueService as { send: (q: string, d: object) => Promise<unknown> }).send('agent-briefing-update', {
              organisationId: request.organisationId,
              subaccountId: request.subaccountId,
              agentId: request.agentId,
              runId: run.id,
              handoffJson: { summary: loopResult.summary, status: finalStatus },
            }).catch((err: unknown) => {
              console.error(`[AgentExecution] Briefing job enqueue failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
            });
          } else {
            // In-memory mode: run briefing update directly (fire-and-forget)
            agentBriefingService.updateAfterRun(
              request.organisationId,
              request.subaccountId!,
              request.agentId,
              run.id,
              { summary: loopResult.summary, status: finalStatus },
            ).catch((err: unknown) => {
              console.error(`[AgentExecution] Briefing update failed for run ${run.id}:`, err instanceof Error ? err.message : String(err));
            });
          }
        }).catch((err: unknown) => {
          // fire-and-forget: dynamic import failure is non-fatal (in-memory mode fallback)
          console.warn('[AgentExecution] Briefing enqueue import failed:', err instanceof Error ? err.message : String(err));
        });
      }

      // ── 11. Fire agent_completed triggers (non-blocking) ─────────────────
      triggerService.checkAndFire(
        request.subaccountId!,
        request.organisationId,
        'agent_completed',
        {
          runId: run.id,
          agentId: request.agentId,
          subaccountAgentId: request.subaccountAgentId,
          status: finalStatus,
        }
      ).catch((err: unknown) => {
        console.error('[AgentExecution] agent_completed trigger failed', {
          subaccountId: request.subaccountId,
          eventType: 'agent_completed',
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // ── 12. MCP cleanup (guaranteed) ────────────────────────────────────
      if (mcpClients?.size) {
        const { mcpClientManager } = await import('./mcpClientManager.js');
        await mcpClientManager.disconnectAll(mcpClients).catch((e) => {
          logger.error('mcp.disconnect_failed', { runId: run.id, error: e instanceof Error ? e.message : String(e) });
        });
      }

      return {
        runId: run.id,
        status: finalStatus as AgentRunResult['status'],
        summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls,
        totalTokens: loopResult.totalTokens,
        durationMs,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
      };
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

// ---------------------------------------------------------------------------
// resumeAgentRun — Sprint 3 P2.1 Sprint 3A library entry point
//
// Reads an `agent_runs` row + its checkpoint payload + the persisted
// message log, validates the `configVersion` against the current
// `configSnapshot` (unless `useLatestConfig` is true), and returns the
// structured state that the Sprint 3B async resume path will hand to
// `runAgenticLoop` via its `startingIteration` + pre-seeded context
// parameters.
//
// Sprint 3A exposes this as a callable library function but does NOT
// wire it to an HTTP endpoint or pg-boss job — that is Sprint 3B. The
// function exists in this sprint so:
//
//   * The schema + projection + resume state are provably consistent
//     end-to-end under unit test (Sprint 3B inherits a tested primitive).
//   * Sprint 3B has a small, concrete surface to integrate with.
//   * The `startingIteration` param on `runAgenticLoop` is exercised by
//     at least one caller, catching signature drift at compile time.
//
// MUST be called inside an active `withOrgTx` block — it uses the
// message service read path which depends on the org-scoped tx.
// ---------------------------------------------------------------------------

export interface ResumeAgentRunOptions {
  /**
   * When `true`, skip the `configVersion` equality check and rehydrate
   * against whatever `configSnapshot` the `agent_runs` row currently
   * has. Used by admin "force-resume" tooling for debugging. Default
   * `false` — a config drift is a hard refusal.
   */
  useLatestConfig?: boolean;
}

export interface ResumeAgentRunResult {
  /** The checkpoint payload that was read from `agent_run_snapshots`. */
  checkpoint: AgentRunCheckpoint;
  /** The rehydrated middleware context, ready to hand to `runAgenticLoop`. */
  middlewareContext: MiddlewareContext;
  /** Raw messages streamed from `agent_run_messages`. */
  messages: Array<{
    sequenceNumber: number;
    role: 'assistant' | 'user' | 'system';
    content: unknown;
  }>;
  /**
   * Whether the stored `configVersion` matches the live configSnapshot
   * fingerprint. Always `true` when the function returns — if they
   * disagree and `useLatestConfig` is false the call throws instead.
   */
  configVersionMatches: boolean;
}

export async function resumeAgentRun(
  runId: string,
  options: ResumeAgentRunOptions = {},
): Promise<ResumeAgentRunResult> {
  const { useLatestConfig = false } = options;

  // MUST run inside an active withOrgTx block — we use getOrgScopedDb
  // for every read below so a caller that forgets the surrounding
  // transaction fails closed with `missing_org_context` instead of
  // silently returning zero rows under RLS.
  const tx = getOrgScopedDb('agentExecutionService.resumeAgentRun');

  // ── 1. Load the run row — establishes org context + config ──────
  // Defence-in-depth: the ALS context is the authoritative org scope
  // for RLS, but every other read site in this service layers an
  // explicit `organisationId` predicate on top. We cannot layer one
  // here without the caller knowing the org, so we rely on the
  // surrounding tx's RLS policy to keep cross-org reads from leaking.
  const [runRow] = await tx.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!runRow) {
    throw new Error(`resumeAgentRun: run ${runId} not found`);
  }

  // ── 2. Load the checkpoint ───────────────────────────────────────
  // `agent_run_snapshots` has no direct `organisation_id` column —
  // cross-org isolation is enforced by the FK cascade from
  // `agent_runs` (the parent row we already validated above) plus the
  // RLS policy that joins through that FK. No explicit org filter is
  // possible or needed here.
  const [snapshotRow] = await tx
    .select()
    .from(agentRunSnapshots)
    .where(eq(agentRunSnapshots.runId, runId));
  if (!snapshotRow || !snapshotRow.checkpoint) {
    throw new Error(`resumeAgentRun: no checkpoint recorded for run ${runId}`);
  }
  const checkpoint = snapshotRow.checkpoint as AgentRunCheckpoint;

  if (checkpoint.version !== 1) {
    throw new Error(
      `resumeAgentRun: checkpoint version=${checkpoint.version} is not supported by this runtime (expected 1).`,
    );
  }

  // ── 3. configVersion drift check ─────────────────────────────────
  const liveConfigVersion = runRow.configSnapshot
    ? fingerprint(runRow.configSnapshot)
    : '';
  if (!useLatestConfig && liveConfigVersion !== checkpoint.configVersion) {
    throw new Error(
      `resumeAgentRun: configVersion drift — checkpoint=${checkpoint.configVersion}, live=${liveConfigVersion}. Re-run with useLatestConfig=true to override (admin only).`,
    );
  }

  // ── 4. Stream persisted messages up to the checkpoint cursor ─────
  // `messageCursor < 0` is the "no messages written yet" sentinel
  // (see persistCheckpoint). Skip the stream call in that case — a
  // range read with `toSequence = -1` would match nothing anyway, but
  // we want the intent to be explicit so a future maintainer reading
  // a resume trace doesn't second-guess the empty array.
  const messageRows =
    checkpoint.messageCursor < 0
      ? []
      : await streamAgentRunMessages(runId, runRow.organisationId, {
          fromSequence: 0,
          toSequence: checkpoint.messageCursor,
        });

  // ── 5. Load the agent + saLink so we can build a live MiddlewareContext ──
  const agent = await agentService.getAgent(runRow.agentId, runRow.organisationId);

  // Subaccount runs carry a subaccountAgent link; org runs do not. The
  // Sprint 3B async resume path needs the same saLink shape the original
  // executeRun passed to runAgenticLoop; Sprint 3A leaves a minimal stub
  // for org runs since the library entry point is not called from any
  // production code path yet.
  let saLink: SubaccountAgent;
  if (runRow.subaccountAgentId) {
    const [link] = await tx
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.id, runRow.subaccountAgentId),
          eq(subaccountAgents.organisationId, runRow.organisationId),
        ),
      );
    if (!link) {
      throw new Error(
        `resumeAgentRun: subaccount_agent ${runRow.subaccountAgentId} not found for run ${runId}`,
      );
    }
    saLink = link;
  } else {
    // Org-scope runs do not have a subaccountAgents row. Sprint 3B will
    // widen the resume path to accept a union shape; for 3A we cast an
    // empty object because the library entry point is not yet invoked
    // against org-scope runs in production.
    saLink = {} as SubaccountAgent;
  }

  const middlewareContext = buildResumeContext({
    checkpoint,
    runId,
    // Sprint 3B will rebuild a real AgentRunRequest from the triggerContext
    // + run row. For 3A the library caller is the unit test harness, so an
    // empty-ish request is sufficient.
    request: {
      agentId: runRow.agentId,
      organisationId: runRow.organisationId,
      subaccountId: runRow.subaccountId ?? undefined,
      runType: runRow.runType,
      executionScope: 'subaccount' as const,
    } as AgentRunRequest,
    agent: {
      modelId: agent.modelId,
      temperature: agent.temperature ?? 0,
      maxTokens: agent.maxTokens ?? 4096,
    },
    saLink,
    // Wall-clock state is re-initialised on every resume — the original
    // run's startTime is meaningless on a different worker. The budget
    // middleware uses the checkpoint's persisted tokensUsed /
    // toolCallsCount (restored by buildResumeContext) to pick up where
    // the original run left off against the SAME per-iteration limits.
    //
    // Sprint 3A stubs `tokenBudget`, `maxToolCalls`, and `timeoutMs` at
    // neutral values because the library entry point is not yet exposed
    // over HTTP or pg-boss. Sprint 3B re-derives them from
    // `runRow.resolvedLimits` (or re-runs limit resolution with the
    // live agent config) so the resumed iteration sees the same ceilings
    // the original iteration did.
    startTime: Date.now(),
    tokenBudget: runRow.tokenBudget ?? 0,
    maxToolCalls: 0,
    timeoutMs: 0,
  });

  return {
    checkpoint,
    middlewareContext,
    messages: messageRows.map((row) => ({
      sequenceNumber: row.sequenceNumber,
      role: row.role,
      content: row.content,
    })),
    configVersionMatches: liveConfigVersion === checkpoint.configVersion,
  };
}

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



// ---------------------------------------------------------------------------
// Team Roster — loaded fresh from DB on every run
// ---------------------------------------------------------------------------

async function buildTeamRoster(subaccountId: string, currentAgentId: string): Promise<string | null> {
  const roster = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentDescription: agents.description,
    })
    .from(subaccountAgents)
    .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
    .where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
      )
    );

  if (roster.length === 0) return null;

  const lines = roster.map(r => {
    const marker = r.agentId === currentAgentId ? ' ← (you)' : '';
    return `- ${r.agentName} (${r.agentId}) — ${r.agentDescription ?? 'No description'}${marker}`;
  });

  return lines.join('\n');
}

// buildOrgTeamRoster removed — org agents now run inside the org subaccount
// and use the standard buildTeamRoster() function. See spec §6d.

// ---------------------------------------------------------------------------
// Smart Board Context — DB-level filtering instead of loading all tasks
// ---------------------------------------------------------------------------

async function buildSmartBoardContext(
  organisationId: string,
  subaccountId: string,
  agentId: string
): Promise<string> {
  const parts: string[] = [];

  // 1. Board summary from workspace memory (compressed)
  const boardSummary = await workspaceMemoryService.getBoardSummaryForPrompt(
    organisationId,
    subaccountId
  );
  if (boardSummary) {
    parts.push('### Board Summary');
    parts.push(boardSummary);
  }

  // 2. Tasks assigned to THIS agent — full detail (DB-filtered)
  const myTasks = await taskService.listTasks(organisationId, subaccountId, {
    assignedAgentId: agentId,
  }) as TaskWithAgent[];

  if (myTasks.length > 0) {
    parts.push('\n### Your Assigned Tasks');
    for (const task of myTasks) {
      parts.push(`- [${task.id}] **${task.title}** (${task.status}, ${task.priority})`);
      if (task.description) parts.push(`  ${String(task.description).slice(0, 200)}`);
    }
  }

  // 3. In-progress tasks from other agents (DB-filtered)
  const inProgressTasks = await taskService.listTasks(organisationId, subaccountId, {
    status: 'in_progress',
  }) as TaskWithAgent[];

  const othersInProgress = inProgressTasks.filter(t => t.assignedAgentId !== agentId);
  if (othersInProgress.length > 0) {
    parts.push('\n### Other In-Progress Work');
    for (const task of othersInProgress.slice(0, MAX_CROSS_AGENT_TASKS)) {
      const agentName = task.assignedAgent?.name ?? 'unassigned';
      parts.push(`- [${task.id}] ${task.title} → ${agentName}`);
    }
  }

  // 4. Status counts (single query for all tasks)
  const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
  const counts: Record<string, number> = {};
  for (const t of allTasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  if (Object.keys(counts).length > 0) {
    parts.push('\n### Board Totals: ' + Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(' | '));
  }

  // Fallback if no board summary and we have tasks
  if (!boardSummary && allTasks.length > 0 && parts.length <= 1) {
    return buildTaskOverviewContext(allTasks.slice(0, 30) as TaskWithAgent[]);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function buildTaskContext(item: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`### Target Task`);
  parts.push(`- **Title**: ${item.title ?? '(untitled)'}`);
  parts.push(`- **ID**: ${item.id}`);
  parts.push(`- **Status**: ${item.status ?? 'unknown'}`);
  parts.push(`- **Priority**: ${item.priority ?? 'normal'}`);
  if (item.description) parts.push(`- **Description**: ${item.description}`);
  if (item.brief) parts.push(`- **Brief**: ${item.brief}`);

  if (item.activities && Array.isArray(item.activities)) {
    parts.push('\n#### Recent Activity');
    for (const act of (item.activities as Array<Record<string, unknown>>).slice(0, 10)) {
      parts.push(`- [${act.activityType}] ${act.message} (${act.createdAt})`);
    }
  }

  if (item.deliverables && Array.isArray(item.deliverables)) {
    parts.push('\n#### Existing Deliverables');
    for (const del of item.deliverables as Array<Record<string, unknown>>) {
      parts.push(`- ${del.title} (${del.deliverableType})`);
    }
  }

  return parts.join('\n');
}

function buildTaskOverviewContext(items: TaskWithAgent[]): string {
  const byStatus: Record<string, TaskWithAgent[]> = {};
  for (const item of items) {
    const status = item.status ?? 'unknown';
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(item);
  }

  const parts: string[] = ['### Board Overview'];
  for (const [status, statusItems] of Object.entries(byStatus)) {
    parts.push(`\n**${status}** (${statusItems.length} items):`);
    for (const item of statusItems.slice(0, 5)) {
      parts.push(`- [${item.id}] ${item.title}${item.priority !== 'normal' ? ` (${item.priority})` : ''}${item.assignedAgent ? ` → ${item.assignedAgent.name}` : ''}`);
    }
    if (statusItems.length > 5) {
      parts.push(`  ... and ${statusItems.length - 5} more`);
    }
  }

  return parts.join('\n');
}

function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string {
  const parts: string[] = ['\n\n---\n## Execution Mode: Autonomous Run'];

  parts.push('You are running autonomously (not in a conversation with a user).');
  parts.push(`This is a ${request.runType} run.`);

  if (request.triggerContext?.type === 'handoff') {
    const ctx = request.triggerContext;
    parts.push(`\nYou were handed this task by another agent (run: ${ctx.sourceRunId}).`);
    if (ctx.handoffContext) {
      parts.push(`The previous agent provided this context: ${ctx.handoffContext}`);
    }
    parts.push('Continue the work from where they left off.');
  }

  if (targetItem) {
    parts.push(`\nYou have been assigned to work on the task: "${targetItem.title}" (ID: ${targetItem.id}).`);
    parts.push('Your workflow:');
    parts.push('1. Read the task details and any existing activities/deliverables');
    parts.push('2. Move the task to "in_progress" if it is not already');
    parts.push('3. Do the work described in the brief/description');
    parts.push('4. Log your progress as activities on the task');
    parts.push('5. When done, attach your output as a deliverable');
    parts.push('6. Move the task to "review" for human approval');
    parts.push('7. Provide a summary of what you did');
  } else {
    parts.push('\nYou are running a general check. Review the board, do your job based on your role, and take appropriate actions.');
    parts.push('Check for tasks assigned to you, look for things that need attention, and proactively do useful work.');
  }

  parts.push('\nIMPORTANT:');
  parts.push('- Always provide a clear summary at the end of your run');
  parts.push('- Log all significant actions as task activities');
  parts.push('- Attach deliverables for any content you produce');
  parts.push('- Move tasks to "review" when ready for human approval — never to "done"');

  return parts.join('\n');
}


