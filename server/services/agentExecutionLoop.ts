/**
 * agentExecutionLoop — neutral sibling module hosting `runAgenticLoop`.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 4.1,
 *       § 7 *api/headless shared body*, plan.md Chunk 4 (file inventory).
 *
 * Why this file exists:
 *
 *   `executionBackends/apiBackend.ts` and `executionBackends/headlessBackend.ts`
 *   both wrap `runAgenticLoop` (the in-process agentic-loop executor). Once
 *   Chunk 5 wires the dispatch ladder through the adapter registry, the
 *   import graph becomes:
 *
 *     agentExecutionService.ts
 *        -> executionBackends/registry.ts
 *        -> executionBackends/apiBackend.ts
 *        -> agentExecutionService.ts  (cycle if runAgenticLoop lives there)
 *
 *   Lifting `runAgenticLoop` (and the helpers ONLY it consumes) into this
 *   neutral sibling breaks the cycle: the adapters import from
 *   `agentExecutionLoop.ts`, which has no path back to
 *   `agentExecutionService.ts`.
 *
 * Cycle prevention — HARD RULE:
 *   This module MUST NOT import any *runtime* symbol from
 *   `server/services/agentExecutionService.ts`. The single
 *   `import type { AgentRunRequest } from './agentExecutionService.js'`
 *   below is erased at compile time (TypeScript drops type-only imports
 *   from emitted JS), so it does not introduce a runtime cycle —
 *   confirmed by `npm run typecheck` and `npm run build:server`. The
 *   neutral runtime type alias `LoopResult` lives in
 *   `agentExecutionTypes.ts` and is re-exported here for backwards
 *   compatibility with historical importers.
 *
 * Exports:
 *   - `LoopParams` — the parameter shape `runAgenticLoop` accepts.
 *   - `runAgenticLoop` — the in-process agentic-loop executor.
 *
 * Helpers extracted alongside (file-private):
 *   - `TraceThrottle` — per-run trace event batcher (only used by the loop).
 *   - `persistCheckpoint` / `PersistCheckpointParams` — per-iteration
 *     checkpoint writer (only used by the loop).
 *   - `buildInitialMessage` — initial user-message builder (only used by
 *     the loop's seed step).
 *   - `formatPreviousSessionBlock` — handoff seed formatter (only used by
 *     the loop's optional previous-session injection path).
 */

import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';

import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import {
  agentRuns,
  agentRunSnapshots,
  agentMessages,
  subaccountAgents,
} from '../db/schema/index.js';
import {
  type LLMMessage,
  type AnthropicTool,
} from './llmService.js';
import { routeCall } from './llmRouter.js';
import type { LLMCallContext } from './llmRouter.js';
import type { ProviderTool } from './providers/types.js';
import {
  selectExecutionPhase,
  validateToolCalls,
  buildMiddlewareContext,
  serialiseMiddlewareContext,
  parsePlan,
  isComplexRun,
  mutateActiveToolsPreservingUniversal,
} from './agentExecutionServicePure.js';
import { reorderToolsByTopicRelevance } from './topicClassifierPure.js';
import { HARD_REMOVAL_CONFIDENCE_THRESHOLD } from '../config/limits.js';
import { UNIVERSAL_SKILL_NAMES } from '../config/universalSkills.js';
import {
  appendMessage as appendAgentRunMessage,
} from './agentRunMessageService.js';
import type { AgentRunCheckpoint } from './middleware/types.js';
import { skillExecutor } from './skillExecutor.js';
import {
  hashToolCall,
  executeWithRetry,
  type MiddlewareContext,
  type MiddlewarePipeline,
} from './middleware/index.js';
import { isFailureError } from '../../shared/iee/failure.js';
import { maskObservations, tagIteration } from './middleware/observationMasking.js';
import {
  WRAP_UP_MAX_TOKENS,
  TOKEN_INPUT_RATIO,
  TOKEN_OUTPUT_RATIO,
  MAX_TOOL_OUTPUT_LOG_LENGTH,
} from '../config/limits.js';
import type { HierarchyContext } from '../../shared/types/delegation.js';
import { emitAgentRunUpdate, emitAgentRunPlan } from '../websocket/emitters.js';
import { insertExecutionEventSafe } from './agentExecutionEventService.js';
import {
  createSpan, createEvent, emitLoopTermination,
} from '../lib/tracing.js';
import { previewSpendForPlan, type SpendingPolicy } from './chargeRouterServicePure.js';
import { spendingBudgets } from '../db/schema/spendingBudgets.js';
import { spendingPolicies } from '../db/schema/spendingPolicies.js';
import { SPEND_ACTION_ALLOWED_SLUGS, getActionDefinition } from '../config/actionRegistry.js';
import { evaluate as evaluateRuntimeCheck } from './runtimeCheckService.js';
import { checkRequiredIntegration } from './integrationBlockService.js';

// `AgentRunRequest` stays in agentExecutionService.ts (30+ call-site imports).
// Using `import type` here is safe because TypeScript erases type-only imports
// from emitted JS — no runtime cycle is introduced.
// Migration trigger: if any adapter ever needs AgentRunRequest as a *runtime*
// value (not just a type annotation), relocate it to agentExecutionTypes.ts
// first to avoid a runtime cycle.
import type { AgentRunRequest } from './agentExecutionService.js';
import type { LoopResult } from './agentExecutionTypes.js';

// `LoopResult` is re-exported so existing importers of
// `agentExecutionService.ts` that previously read `LoopResult` from there
// continue to work after the extraction.
export type { LoopResult };

// ---------------------------------------------------------------------------
// Agent trace throttle — batches iteration/tool_call events to max 2/sec
// ---------------------------------------------------------------------------

const TRACE_THROTTLE_MS = 500;

class TraceThrottle {
  private pending: Record<string, unknown> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;

  constructor(private runId: string) {}

  emit(event: string, data: Record<string, unknown>): void {
    this.pending = { event, data };
    const now = Date.now();
    const elapsed = now - this.lastEmit;

    if (elapsed >= TRACE_THROTTLE_MS) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), TRACE_THROTTLE_MS - elapsed);
    }
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return;
    const { event, data } = this.pending as { event: string; data: Record<string, unknown> };
    this.pending = null;
    this.lastEmit = Date.now();
    emitAgentRunUpdate(this.runId, event, data);
  }

  destroy(): void {
    this.flush(); // emit any pending event before cleanup
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

// ---------------------------------------------------------------------------
// LoopParams — parameter shape for runAgenticLoop
// ---------------------------------------------------------------------------

export interface LoopParams {
  runId: string;
  agent: { modelId: string; modelProvider: string; temperature: number; maxTokens: number; complexityHint?: string | null };
  routerCtx: Omit<LLMCallContext, 'taskType' | 'provider' | 'model' | 'executionPhase' | 'routingMode'>;
  systemPrompt: string | { stablePrefix: string; dynamicSuffix: string };
  tools: AnthropicTool[];
  tokenBudget: number;
  maxToolCalls: number;
  /** Maximum loop iterations for this run — derived from CONTROLLER_LIMITS[controllerStyle]. */
  maxLoopIterations: number;
  timeoutMs: number;
  startTime: number;
  request: AgentRunRequest;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
  saLink: typeof subaccountAgents.$inferSelect;
  pipeline: MiddlewarePipeline;
  mcpClients?: Map<string, import('./mcpClientManager.js').McpClientInstance> | null;
  mcpLazyRegistry?: Map<string, import('../db/schema/mcpServerConfigs.js').McpServerConfig> | null;
  /**
   * Context data pool for this run — populated upstream by loadRunContextData.
   * Threaded through to the skill execution context so the read_data_source
   * skill handler can answer list/read ops against the same pool used to
   * build the system prompt. See spec §8.2.
   */
  runContextData: import('./runContextLoader.js').RunContextData;
  /**
   * Sprint 3 P2.1 Sprint 3A — fingerprint of `agent_runs.configSnapshot`.
   * Stamped onto every checkpoint so the Sprint 3B resume path can refuse
   * to resume a run whose configuration has drifted. Computed by
   * executeRun via `fingerprint(resolvedConfig)` so runAgenticLoop does
   * not need to redo the hash per iteration.
   */
  configVersion: string;
  /**
   * Sprint 3 P2.1 Sprint 3A — iteration index to begin the outer loop at.
   * Default 0 for a fresh run. The resume path (Sprint 3B) will pass the
   * checkpoint's `iteration + 1` along with pre-seeded `messages`,
   * `mwCtx`, and running counters; 3A wires the parameter so the loop
   * API is resume-ready even though the resume wiring itself lands in
   * the next sprint.
   */
  startingIteration?: number;
  /** Whether this run is in the org subaccount (affects cross-subaccount access control). */
  isOrgSubaccountRun?: boolean;
  /** Phase 2C: agent's memory domain derived from agentRole. */
  agentDomain?: string;
  /**
   * Pre-built hierarchy snapshot (INV-4). Built once in executeRun BEFORE skill
   * resolution and threaded into SkillExecutionContext. Undefined when the agent
   * has no subaccount context or when buildForRun raised HierarchyContextBuildError.
   */
  hierarchyContext?: Readonly<HierarchyContext>;
}

// ---------------------------------------------------------------------------
// runAgenticLoop — the in-process agentic loop executor.
//
// Calls LLM, handles tool calls, repeats until done. Lifted verbatim from
// `agentExecutionService.ts` (Chunk 4 of the ExecutionBackend Adapter
// Contract refactor) to break the future import cycle between
// `agentExecutionService.ts` and `executionBackends/registry.ts`.
// ---------------------------------------------------------------------------

export async function runAgenticLoop(params: LoopParams): Promise<LoopResult> {
  const {
    runId, agent, routerCtx, systemPrompt, tools: initialTools, tokenBudget,
    maxToolCalls, maxLoopIterations, timeoutMs, startTime, request, orgProcesses,
    saLink, pipeline, mcpClients, mcpLazyRegistry, runContextData,
    configVersion, agentDomain, hierarchyContext,
  } = params;
  // Both saLink and timeoutMs are consumed within this function:
  //   - timeoutMs -> skillExecutionContext (skill call timeout cap)
  //   - saLink    -> buildMiddlewareContext (passed to per-iteration middleware)
  const startingIteration = params.startingIteration ?? 0;

  // Sprint 5 P4.1 — mutable tool list; topic filter may narrow it on iteration 0
  let tools = initialTools;

  // Sprint 3 P2.1 Sprint 3A — highest persisted sequence_number for this run.
  // Initialised to -1 and updated after every successful appendMessage call
  // so `persistCheckpoint` below can stamp the correct `messageCursor`. The
  // resume path asserts that every sequence_number in the window
  // `[0, messageCursor]` is present before rehydrating.
  let messageCursor = -1;

  const toolCallsLog: object[] = [];
  let totalToolCalls = 0;
  let totalTokensUsed = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let deliverablesCreated = 0;
  let finalStatus: string | undefined;

  // Persistent skill execution context — created ONCE outside the loop so
  // that counters (readDataSourceCallCount, mcpCallCount) survive across
  // iterations. Previously this was rebuilt inline on every tool call,
  // which would have reset the counters every iteration.
  const skillExecutionContext: import('./skillExecutor.js').SkillExecutionContext = {
    runId,
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    // Org subaccount agents get full cross-subaccount access; regular agents are scoped
    allowedSubaccountIds: params.isOrgSubaccountRun ? null : (request.subaccountId ? [request.subaccountId] : null),
    agentId: request.agentId,
    agentDomain,
    userId: request.userId,
    orgProcesses,
    handoffDepth: request.handoffDepth,
    isSubAgent: request.isSubAgent,
    tokenBudget,
    startTime,
    timeoutMs,
    taskId: request.taskId,
    isTestRun: request.isTestRun ?? false,
    conversationId: request.conversationId ?? (request.triggerContext?.conversationId as string | undefined) ?? undefined,
    _mcpClients: mcpClients ?? undefined,
    _mcpLazyRegistry: mcpLazyRegistry ?? undefined,
    runContextData,
    readDataSourceCallCount: 0,
    hierarchy: hierarchyContext,
    workflowRunDepth: request.workflowRunDepth,
  };

  // Throttle trace events to prevent event floods (max 2/sec)
  const traceThrottle = new TraceThrottle(runId);

  try { // Expanded try/finally scope — guarantees traceThrottle.destroy() even
        // if middleware setup, seed-from-previous, or planning prelude throws.

  const mwCtx: MiddlewareContext = buildMiddlewareContext({
    runId,
    request,
    agent,
    saLink,
    startTime,
    tokenBudget,
    maxToolCalls,
    timeoutMs,
  });

  // Brain Tree OS adoption P1 — optional previous-session seeding.
  // When the caller passes seedFromPreviousRun=true (manual / continue-from
  // UX paths), look up the most recent handoff and prepend it. Best-effort:
  // any failure logs and skips the seeding.
  let previousSessionBlock: string | null = null;
  if (request.seedFromPreviousRun) {
    try {
      const { getLatestHandoffForAgent } = await import('./agentRunHandoffService.js');
      const previous = await getLatestHandoffForAgent({
        agentId: request.agentId,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId ?? null,
        excludeRunId: runId,
      });
      if (previous) {
        previousSessionBlock = formatPreviousSessionBlock(previous.handoff);
      }
    } catch (err) {
      logger.warn('agent_runs.seed_previous_handoff_failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const initialMessage = buildInitialMessage(request, previousSessionBlock);
  const messages: LLMMessage[] = [{ role: 'user', content: initialMessage }];

  let lastTextContent = '';
  let previousResponseHadToolCalls = false;

  // ── Sprint 5 P4.3: Planning prelude for complex runs ─────────────
  // For runs classified as "complex", emit a planning call before the
  // main loop. The plan is persisted to agent_runs.plan_json and
  // injected as a system reminder so the agent stays anchored.
  if (startingIteration === 0) {
    const shouldPlan = isComplexRun({
      complexityHint: agent.complexityHint ?? null,
      messageWordCount: initialMessage.split(/\s+/).length,
      skillCount: tools.length,
    });

    if (shouldPlan) {
      try {
        const planningPrompt = `You are in PLANNING mode. Output a JSON plan describing the actions you intend to take. Do NOT execute any tools yet. Your response must be a JSON object with an "actions" array where each item has "tool" (the tool name) and "reason" (why you need it).\n\nExample: { "actions": [{ "tool": "read_inbox", "reason": "Check for new emails" }, { "tool": "create_task", "reason": "File a bug for the issue found" }] }`;

        const planMessages: LLMMessage[] = [
          { role: 'user', content: `${initialMessage}\n\n${planningPrompt}` },
        ];

        const planResponse = await routeCall({
          messages: planMessages,
          system: systemPrompt,
          tools: undefined, // No tools during planning
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          estimatedContextTokens: 0,
          context: {
            ...routerCtx,
            taskType: 'general',
            executionPhase: 'planning' as const,
            provider: agent.modelProvider,
            model: agent.modelId,
            routingMode: 'ceiling' as const,
          },
        });

        const planContent = planResponse.content;
        const plan = parsePlan(planContent);
        if (plan) {
          // Persist the plan
          await db
            .update(agentRuns)
            .set({ planJson: plan, updatedAt: new Date() })
            .where(eq(agentRuns.id, runId));

          // Emit WS event
          emitAgentRunPlan(runId, { plan });

          // Inject the plan as a system reminder in the message history
          const planSummary = plan.actions
            .map((a, i) => `${i + 1}. ${a.tool}${a.reason ? ` — ${a.reason}` : ''}`)
            .join('\n');

          // Chunk 7: advisory spend-policy preview (fail-open, never blocks)
          let spendPreviewNote = '';
          try {
            const spendActions = plan.actions.filter((a) =>
              (SPEND_ACTION_ALLOWED_SLUGS as readonly string[]).includes(a.tool),
            );
            if (spendActions.length > 0 && request.subaccountId) {
              const [budgetRow] = await db
                .select({ policy: spendingPolicies })
                .from(spendingBudgets)
                .innerJoin(spendingPolicies, eq(spendingPolicies.spendingBudgetId, spendingBudgets.id))
                .where(
                  and(
                    eq(spendingBudgets.organisationId, request.organisationId),
                    eq(spendingBudgets.subaccountId, request.subaccountId),
                  ),
                )
                .limit(1);

              if (budgetRow) {
                const parsedPlan = {
                  steps: spendActions.map((a) => ({
                    amountMinor: 1,
                    currency: 'USD',
                    merchant: { id: null, descriptor: '' },
                    intent: a.reason ?? a.tool,
                  })),
                };
                const previews = previewSpendForPlan(parsedPlan, budgetRow.policy as unknown as SpendingPolicy);
                const nonAuto = previews.filter((p) => p.verdict !== 'would_auto');
                if (nonAuto.length > 0) {
                  const notes = nonAuto
                    .map((p) => `  step ${p.stepIndex + 1} (${spendActions[p.stepIndex]?.tool ?? '?'}): ${p.verdict}`)
                    .join('\n');
                  spendPreviewNote = `\nSpend policy advisory:\n${notes}`;
                }
              }
            }
          } catch (previewErr) {
            logger.warn('[P4.3] Spend preview failed (non-blocking)', { err: previewErr });
          }

          messages.push({
            role: 'user',
            content: `<system-reminder>\nYou created this plan. Execute it step by step:\n${planSummary}${spendPreviewNote}\n</system-reminder>`,
          });

          // Track token usage from the planning call
          totalTokensUsed += (planResponse.tokensIn ?? 0) + (planResponse.tokensOut ?? 0);
        }
      } catch (planError) {
        // Planning failure is non-fatal — fall through to the normal loop
        logger.warn('[P4.3] Planning prelude failed', { err: planError, runId });
      }
    }
  }

  outerLoop:
  for (let iteration = startingIteration; iteration < maxLoopIterations; iteration++) {
    mwCtx.iteration = iteration;
    mwCtx.tokensUsed = totalTokensUsed;
    mwCtx.toolCallsCount = totalToolCalls;

    // ── User-triggered cancel observation ──────────────────────────────
    // agentRunCancelService flips agent_runs.status to 'cancelling' when a
    // user cancels an in-flight non-IEE run. This per-iteration PK read is
    // the cheapest place to observe that — runs at most maxLoopIterations
    // times per run and is dwarfed by the LLM call that follows. IEE-
    // delegated runs are stopped via the worker's per-step ownership check
    // (worker/src/persistence/runs.ts::assertWorkerOwnership), so this guard
    // is for the in-process API path only.
    {
      const [cancelObserved] = await db
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .limit(1);
      if (cancelObserved?.status === 'cancelling') {
        finalStatus = 'cancelled';
        emitLoopTermination('user_cancelled', { iteration, totalToolCalls });
        break outerLoop;
      }
    }

    // ── Parent-cancellation cooperative observer (AE2 §5.2 step 8) ────
    // If this is a sub-agent run and its parent was cancelled by the
    // operator, exit cleanly and write a run.terminal event so the
    // parent-initiated cancellation is reflected in this child's audit trail.
    if (request.parentRunId) {
      const [parentRow] = await db
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, request.parentRunId))
        .limit(1);
      if (parentRow?.status === 'cancelled' || parentRow?.status === 'cancelling') {
        await insertExecutionEventSafe({
          runId,
          organisationId: request.organisationId,
          subaccountId: request.subaccountId ?? null,
          payload: { eventType: 'run.terminal', critical: true, status: 'cancelled' },
          sourceService: 'agentExecutionService',
        });
        finalStatus = 'cancelled';
        emitLoopTermination('user_cancelled', { iteration, totalToolCalls });
        break outerLoop;
      }
    }

    // ── Heartbeat: update lastActivityAt for stale run detection ──────
    // Throttle to every 3rd iteration to avoid DB write pressure
    if (iteration % 3 === 0) {
      db.update(agentRuns)
        .set({ lastActivityAt: new Date() })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'running')))
        .catch((err) => {
          logger.warn('heartbeat_update_failed', { runId, error: err instanceof Error ? err.message : String(err) });
        });
    }

    // ── Pre-call middleware ────────────────────────────────────────────
    for (const mw of pipeline.preCall) {
      const result = mw.execute(mwCtx);
      if (result.action === 'stop') {
        createEvent('agent.middleware.decision', {
          middlewareName: mw.name, decision: 'stop', reason: result.reason, iteration,
        });
        messages.push({ role: 'user', content: result.reason });
        const maskedWrapUp = maskObservations(messages, iteration);
        const wrapUp = await routeCall({
          messages: maskedWrapUp,
          system: systemPrompt,
          temperature: agent.temperature,
          maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
          context: {
            ...routerCtx, taskType: 'general', executionPhase: 'synthesis' as const,
            provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
          },
        });
        lastTextContent = wrapUp.content;
        totalTokensUsed += (wrapUp.tokensIn ?? 0) + (wrapUp.tokensOut ?? 0);
        finalStatus = result.status;
        emitLoopTermination('middleware_stop', {
          iteration, middlewareName: mw.name, reason: result.reason, totalToolCalls,
        });
        break outerLoop;
      }
      if (result.action === 'inject_message') {
        createEvent('agent.middleware.decision', {
          middlewareName: mw.name, decision: 'inject_message', iteration,
        });
        messages.push({ role: 'user', content: result.message });
        logger.debug('middleware.inject_message', {
          runId, middleware: mw.name, iteration, tokensUsed: totalTokensUsed,
        });
      }
    }

    // Sprint 5 P4.1 — apply topic-based tool filtering after preCall middleware.
    // If the topic filter stashed matching skills on the context, apply the
    // filter. Only runs on iteration 0 to avoid re-filtering on every turn.
    if (iteration === 0) {
      const topicClassification = (mwCtx as unknown as Record<string, unknown>)._topicClassification as
        { confidence: number } | undefined;
      const topicMatchingSkills = (mwCtx as unknown as Record<string, unknown>)._topicMatchingSkills as
        string[] | undefined;

      if (topicClassification && topicMatchingSkills && topicClassification.confidence >= HARD_REMOVAL_CONFIDENCE_THRESHOLD) {
        const matchSet = new Set(topicMatchingSkills);
        tools = mutateActiveToolsPreservingUniversal(
          tools as unknown as ProviderTool[],
          (t) => t.filter((tool) => matchSet.has(tool.name)),
          tools as unknown as ProviderTool[],
        ) as unknown as typeof tools;
        logger.debug('topic_filter.hard_removal', {
          runId, iteration, kept: tools.length, matchingSkills: topicMatchingSkills.length,
        });
      } else if (topicClassification && topicMatchingSkills && topicClassification.confidence > 0) {
        // Soft reorder — matching tools move to front, nothing removed
        const coreSkills = UNIVERSAL_SKILL_NAMES as unknown as string[];
        tools = reorderToolsByTopicRelevance(
          tools as unknown as ProviderTool[],
          topicMatchingSkills,
          coreSkills,
        ) as unknown as typeof tools;
      }
    }

    // Emit iteration event for live trace (throttled to max 2/sec)
    traceThrottle.emit('agent:run:iteration', {
      iteration, tokensUsed: totalTokensUsed, toolCallsCount: totalToolCalls,
    });

    // Determine execution phase for this iteration via pure helper.
    const phase = selectExecutionPhase(iteration, previousResponseHadToolCalls, totalToolCalls);

    const iterationSpan = createSpan('agent.loop.iteration', {
      iteration, phase, totalToolCalls, tokensUsed: totalTokensUsed,
    });

    // ── Call LLM (with observation masking) ─────────────────────────────
    const maskedMessages = maskObservations(messages, iteration);
    const response = await routeCall({
      messages: maskedMessages,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      estimatedContextTokens: totalTokensUsed,
      context: {
        ...routerCtx, taskType: 'development', executionPhase: phase,
        provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
      },
    });

    totalTokensUsed += (response.tokensIn ?? 0) + (response.tokensOut ?? 0);

    lastTextContent = response.content;
    previousResponseHadToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);

    // ── Cascade escalation: validate economy model tool calls ────────
    let escalationAttempted = false;
    if (!env.ROUTER_FORCE_FRONTIER && response.routing?.wasDowngraded && response.toolCalls?.length) {
      const validation = validateToolCalls(response.toolCalls, tools as unknown as ProviderTool[]);
      if (!validation.valid && !escalationAttempted) {
        escalationAttempted = true;
        logger.warn('[agentLoop] escalating — retrying with frontier model', { failureReason: validation.failureReason });
        const escalatedResponse = await routeCall({
          messages: maskedMessages,
          system: systemPrompt,
          tools: tools.length > 0 ? tools : undefined,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          estimatedContextTokens: totalTokensUsed,
          context: {
            ...routerCtx, taskType: 'development', executionPhase: phase,
            provider: agent.modelProvider, model: agent.modelId, routingMode: 'forced' as const,
            wasEscalated: true,
            escalationReason: `economy_invalid_tool_calls: ${validation.failureReason}`,
          },
        });
        // Replace response with escalated version
        Object.assign(response, escalatedResponse);
        totalTokensUsed += (escalatedResponse.tokensIn ?? 0) + (escalatedResponse.tokensOut ?? 0);
        lastTextContent = escalatedResponse.content;
        previousResponseHadToolCalls = !!(escalatedResponse.toolCalls && escalatedResponse.toolCalls.length > 0);
      }
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      iterationSpan.end({ output: { phase, noToolCalls: true } });
      emitLoopTermination('no_tool_calls', { iteration, totalToolCalls });
      break;
    }

    // Build assistant message with tool calls
    const assistantBlocks: LLMMessage['content'] = [];
    if (response.content) assistantBlocks.push({ type: 'text', text: response.content });
    for (const tc of response.toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Sprint 3 P2.1 Sprint 3A — mirror the assistant message into the
    // append-only `agent_run_messages` log. Best-effort in 3A: a persistence
    // failure is logged but does not terminate the run. Sprint 3B tightens
    // this into a hard invariant when the async resume path lands.
    try {
      const appended = await appendAgentRunMessage({
        runId,
        organisationId: request.organisationId,
        role: 'assistant',
        content: assistantBlocks,
        toolCallId: null,
      });
      messageCursor = appended.sequenceNumber;
    } catch (err) {
      logger.warn('agent_run_messages.append_failed', {
        runId,
        role: 'assistant',
        iteration,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Sprint 3 P2.3 — stash the latest assistant text on mwCtx so preTool
    // middlewares (notably the decision-time guidance / tool_intent
    // confidence extractor) can read it without widening the middleware
    // contract to include the full message array.
    mwCtx.lastAssistantText = response.content ?? undefined;

    // ── Sprint 5 P4.4: Shadow-mode critique gate (postCall phase) ────
    // Fires after the LLM responds but before tool calls execute.
    // In shadow mode, results are logged but execution is never blocked.
    if (response.toolCalls.length > 0) {
      try {
        const { evaluateCritiqueGate } = await import('./middleware/critiqueGate.js');
        const critiqueResult = await evaluateCritiqueGate(
          response.toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
          {
            runId,
            organisationId: request.organisationId,
            phase,
            wasDowngraded: response.routing?.wasDowngraded ?? false,
            recentMessages: messages.slice(-3).map((m) => ({
              role: typeof m.role === 'string' ? m.role : 'user',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            })),
            logCritiqueResult: (result) => {
              logger.info('critique_gate_shadow', { runId, ...result });
            },
          },
        );
        if (critiqueResult.hasSuspect) {
          logger.warn('critique_gate_suspect', { runId, results: critiqueResult.results });
        }
      } catch (err) {
        // Shadow mode: critique failures never block execution
        logger.warn('critique_gate_error', { runId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Execute tool calls ────────────────────────────────────────────
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    // Sprint 2 P1.1 Layer 3 — messages queued by `inject_message` middleware
    // decisions or `skip { injectMessage }` side channels. Flushed to the
    // conversation immediately after the tool_results batch for this iteration.
    const pendingInjectedMessages: string[] = [];

    for (const toolCall of response.toolCalls) {
      // Pre-tool middleware
      let skipTool = false;
      for (const mw of pipeline.preTool) {
        const result = await mw.execute(mwCtx, {
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
        if (result.action === 'skip') {
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: result.reason }),
          });
          if (result.injectMessage) {
            pendingInjectedMessages.push(result.injectMessage);
          }
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'skip', reason: result.reason, iteration,
          });
          skipTool = true;
          break;
        }
        if (result.action === 'block') {
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: result.reason, blocked: true }),
          });
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'block', reason: result.reason, iteration,
          });
          skipTool = true;
          break;
        }
        if (result.action === 'inject_message') {
          // Emit a neutral skipped-tool result so every tool_use has a matching
          // tool_result in the next LLM request, then queue the injected
          // message to be appended after the tool_results batch for this
          // iteration.
          toolResults.push({
            tool_use_id: toolCall.id,
            content: JSON.stringify({ success: false, error: 'middleware_injected_message', skipped: true }),
          });
          pendingInjectedMessages.push(result.message);
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'inject_message', iteration,
          });
          skipTool = true;
          break;
        }
        if (result.action === 'stop') {
          createEvent('agent.middleware.decision', {
            middlewareName: mw.name, decision: 'stop', reason: result.reason, iteration,
          });
          messages.push({
            role: 'user',
            content: toolResults.map(tr => ({
              type: 'tool_result' as const,
              tool_use_id: tr.tool_use_id,
              content: tr.content,
            })),
          });
          messages.push({ role: 'user', content: result.reason });
          const maskedStopMessages = maskObservations(messages, iteration);
          const wrapUp = await routeCall({
            messages: maskedStopMessages,
            system: systemPrompt,
            temperature: agent.temperature,
            maxTokens: Math.min(agent.maxTokens, WRAP_UP_MAX_TOKENS),
            context: {
              ...routerCtx, taskType: 'general', executionPhase: 'synthesis' as const,
              provider: agent.modelProvider, model: agent.modelId, routingMode: 'ceiling' as const,
            },
          });
          lastTextContent = wrapUp.content;
          finalStatus = result.status;
          iterationSpan.end({ output: { phase, middlewareStop: true } });
          emitLoopTermination('middleware_stop', {
            iteration, middlewareName: mw.name, reason: result.reason, totalToolCalls,
          });
          break outerLoop;
        }
      }

      if (skipTool) continue;

      // ── Integration block check ───────────────────────────────────────────
      // Determine if this tool requires an OAuth integration that is not yet
      // connected. In v1 checkRequiredIntegration always returns shouldBlock:false;
      // the full block path is wired and ready to activate when ACTION_REGISTRY
      // entries begin declaring requiredIntegration fields.
      {
        // Read current runMetadata for block-sequence tracking
        const [runMeta] = await db
          .select({ runMetadata: agentRuns.runMetadata })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId))
          .limit(1);
        const currentRunMeta = (runMeta?.runMetadata ?? {}) as Record<string, unknown>;
        const newBlockSeq = ((currentRunMeta.currentBlockSequence as number) ?? 0) + 1;

        const blockDecision = await checkRequiredIntegration(
          toolCall.name,
          toolCall.input as Record<string, unknown>,
          {
            organisationId: request.organisationId,
            subaccountId: request.subaccountId ?? null,
            conversationId: request.conversationId ?? (request.triggerContext?.conversationId as string | undefined) ?? '',
            runId,
            agentId: request.agentId,
            currentBlockSequence: newBlockSeq,
          },
        );

        if ('code' in blockDecision && blockDecision.code === 'TOOL_NOT_RESUMABLE') {
          // Cancel the run — this tool cannot be safely paused mid-execution.
          await db.update(agentRuns).set({
            status: 'cancelled',
            runResultStatus: 'failed',
            runMetadata: {
              ...currentRunMeta,
              cancelReason: 'tool_not_resumable',
            },
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(agentRuns.id, runId));

          logger.error('tool_not_resumable', {
            runId,
            conversationId: request.conversationId ?? (request.triggerContext?.conversationId as string | undefined) ?? '',
            blockedReason: 'integration_required',
            toolName: toolCall.name,
            action: 'tool_not_resumable',
          });

          finalStatus = 'failed';
          emitLoopTermination('pre_loop_exit', { iteration, totalToolCalls });
          break outerLoop;
        }

        if (blockDecision.shouldBlock) {
          const plaintext = blockDecision.plaintext;
          const tokenHash = blockDecision.tokenHash;
          const appBase = process.env.APP_BASE_URL ?? '';
          const blockConversationId = request.conversationId ?? (request.triggerContext?.conversationId as string | undefined) ?? '';
          const actionUrl = `${appBase}/api/integrations/oauth2/auth-url?provider=${encodeURIComponent(blockDecision.integrationId)}&resumeToken=${encodeURIComponent(plaintext)}${blockConversationId ? `&conversationId=${encodeURIComponent(blockConversationId)}` : ''}`;

          const cardContent = {
            ...blockDecision.card,
            actionUrl,
            resumeToken: plaintext,
            expiresAt: blockDecision.expiresAt.toISOString(),
            schemaVersion: 1 as const,
          };

          // Persist blocked state on run
          await db.update(agentRuns).set({
            blockedReason: 'integration_required',
            blockedExpiresAt: blockDecision.expiresAt,
            integrationResumeToken: tokenHash,
            integrationDedupKey: blockDecision.integrationDedupKey,
            runMetadata: {
              ...currentRunMeta,
              currentBlockSequence: newBlockSeq,
              blockedToolCall: {
                toolName: toolCall.name,
                toolArgs: toolCall.input,
                dedupKey: blockDecision.integrationDedupKey,
              },
            },
            updatedAt: new Date(),
          }).where(eq(agentRuns.id, runId));

          logger.info('run_blocked', {
            runId,
            conversationId: request.conversationId ?? (request.triggerContext?.conversationId as string | undefined) ?? '',
            blockedReason: 'integration_required',
            integrationId: blockDecision.integrationId,
            blockSequence: newBlockSeq,
            action: 'run_blocked',
          });

          // Persist the integration card as an assistant message in the conversation.
          // Skip insert if conversationId is empty — guard prevents a DB error when no conversation is associated.
          const _integrationConvId =
            request.conversationId ??
            (request.triggerContext?.conversationId as string | undefined) ??
            '';
          if (_integrationConvId) {
            await db.insert(agentMessages).values({
              conversationId: _integrationConvId,
              role: 'assistant',
              content: `Integration required: ${cardContent.integrationId}`,
              meta: cardContent as any,
              createdAt: new Date(),
            });
            logger.info('integration_card_emitted', {
              runId,
              conversationId: _integrationConvId,
              integrationId: cardContent.integrationId,
              blockSequence: cardContent.blockSequence,
              action: 'integration_card_emitted',
            });
          }

          // Break out of the agent loop — run stays in 'running' status
          // with blocked_reason set. The expiry sweep will cancel it if
          // the user never connects.
          finalStatus = 'blocked_awaiting_integration';
          // Note: emitLoopTermination only accepts its fixed union — use
          // the closest structural match and log the actual reason separately.
          emitLoopTermination('pre_loop_exit', { iteration, totalToolCalls });
          break outerLoop;
        }
      }

      totalToolCalls++;
      const toolStart = Date.now();

      // Mark tool start for stale run grace period
      db.update(agentRuns)
        .set({ lastToolStartedAt: new Date() })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, 'running')))
        .catch((err) => {
          logger.warn('tool_start_update_failed', { runId, tool: toolCall.name, error: err instanceof Error ? err.message : String(err) });
        });

      const inputHash = hashToolCall(toolCall.name, toolCall.input);
      mwCtx.toolCallHistory.push({ name: toolCall.name, inputHash, iteration });

      let resultContent: string;
      let result: unknown;
      let error: { message: string; type: string; category: string } | undefined;
      let retried = false;
      try {
        const outcome = await executeWithRetry(async () => {
          return skillExecutor.execute({
            skillName: toolCall.name,
            input: toolCall.input,
            context: skillExecutionContext,
            // Sprint 2 P1.1 Layer 3: thread the LLM tool call id into the
            // skill executor so the per-case action wrappers build the same
            // deterministic idempotency key as proposeActionMiddleware.
            toolCallId: toolCall.id,
          });
        }, { actionType: toolCall.name });
        result = outcome.result;
        error = outcome.error;
        retried = outcome.retried;
      } catch (err) {
        // P0.2 Slice C — onFailure: 'fail_run' throws a FailureError that
        // propagates through executeWithRetry. Terminate the loop cleanly
        // here rather than letting it unwind out of runAgenticLoop, so that
        // (a) accumulated stats and toolCallsLog are preserved, (b) the
        // executeRun finalization path runs (MCP disconnect, trace finalize,
        // DB persist of totals), and (c) finalStatus is recorded as 'failed'.
        // Only fail_run-sourced FailureErrors reach here (errorHandling.ts
        // scopes its rethrow to the same marker). Any other error rethrows.
        if (!isFailureError(err) || err.failure?.metadata?.source !== 'onFailure:fail_run') {
          throw err;
        }
        const failMsg = err.failure?.failureDetail ?? err.message;
        toolCallsLog.push({
          tool: toolCall.name,
          input: toolCall.input,
          output: JSON.stringify({
            success: false,
            error: failMsg,
            failureReason: err.failure?.failureReason,
            fail_run: true,
          }),
          durationMs: Date.now() - toolStart,
          iteration,
          retried: false,
        });
        finalStatus = 'failed';
        iterationSpan.end({ output: { phase, failRun: true, tool: toolCall.name } });
        emitLoopTermination('error', { iteration, tool: toolCall.name, totalToolCalls, reason: 'fail_run' });
        break outerLoop;
      }

      if (error) {
        resultContent = JSON.stringify({
          success: false,
          error: error.message,
          error_type: error.type,
          error_category: error.category,
          retried,
        });
      } else {
        resultContent = typeof result === 'string' ? result : JSON.stringify(result);

        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (r._created_task) tasksCreated++;
          if (r._updated_task) tasksUpdated++;
          if (r._created_deliverable) deliverablesCreated++;
        }
      }

      // Runtime check hook — inline, bounded by 250ms timeout, never throws.
      // Evaluates post-action state, persists the result, and pauses the run
      // when blastRadius === 'external' and state is fail or inconclusive
      // (spec §11.2: "External — Always pause. Existing approval gate handles
      // the operator confirmation.").
      let runtimeCheckPauseNeeded = false;
      try {
        const actionDef = getActionDefinition(toolCall.name);
        if (actionDef !== undefined) {
          const checkBlastRadius = actionDef.blastRadius ?? 'self';
          const rcResult = await evaluateRuntimeCheck({
            runId,
            eventId: null,
            sequenceNumber: totalToolCalls,
            skillSlug: toolCall.name,
            organisationId: request.organisationId,
            subaccountId: request.subaccountId ?? null,
            checkKind: actionDef.verify ?? null,
            toolResult: result,
            blastRadius: checkBlastRadius,
            reversible: actionDef.reversible ?? false,
          });
          if (
            checkBlastRadius === 'external' &&
            (rcResult.state === 'fail' || rcResult.state === 'inconclusive')
          ) {
            runtimeCheckPauseNeeded = true;
          }
          // Forced scorecard grading on non-self failure — fire-and-forget,
          // never throws into the agent loop (spec §12.3).
          // Gate avoids a DB round-trip for self-scoped actions.
          if (rcResult.state === 'fail' && checkBlastRadius !== 'self') {
            void import('./scorecardJudgeRunner.js')
              .then(({ scheduleForcedGrade }) =>
                scheduleForcedGrade({
                  runId,
                  agentId: request.agentId,
                  organisationId: request.organisationId,
                  triggerSource: 'forced_runtime_check_fail',
                  blastRadius: checkBlastRadius as 'tenant' | 'external',
                  runtimeCheckState: rcResult.state,
                })
              )
              .catch((err: unknown) => {
                logger.warn('forced_grade_dispatch_failed', {
                  runId, agentId: request.agentId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
          }
        }
      } catch (rcHookErr) {
        // Never throw into the agent loop. Log so unexpected failures
        // (programming error, persistence error, action-definition lookup
        // failure) are observable instead of silently dropped.
        logger.warn('runtime_check_hook_error', {
          runId,
          skillSlug: toolCall.name,
          error: rcHookErr instanceof Error ? rcHookErr.message : String(rcHookErr),
        });
      }

      if (runtimeCheckPauseNeeded) {
        finalStatus = 'failed';
        emitLoopTermination('error', { iteration, totalToolCalls, reason: 'runtime_check_gate' });
        break outerLoop;
      }

      const toolDurationMs = Date.now() - toolStart;

      // Post-tool middleware
      // Sprint 3 P2.2 widens PostToolResult to five variants. The switch is
      // exhaustive — adding a new variant will fail compilation at the
      // `assertNever` line until a handler is added here.
      let postToolBreakOuter = false;
      for (const mw of pipeline.postTool) {
        const postResult = await Promise.resolve(mw.execute(
          mwCtx,
          { name: toolCall.name, input: toolCall.input },
          { content: resultContent, durationMs: toolDurationMs }
        ));
        switch (postResult.action) {
          case 'continue':
            if (postResult.content) {
              resultContent = postResult.content;
            }
            break;
          case 'stop':
            finalStatus = postResult.status;
            iterationSpan.end({ output: { phase, postToolStop: true } });
            emitLoopTermination('middleware_stop', {
              iteration, middlewareName: mw.name, totalToolCalls,
            });
            postToolBreakOuter = true;
            break;
          case 'inject_message':
            // Queue the middleware-authored message for the next LLM turn.
            // Drained alongside the Sprint 2 P1.1 Layer 3 queue after the
            // tool_results batch is pushed, so every tool_use has a matching
            // tool_result before the new user message lands.
            pendingInjectedMessages.push(postResult.message);
            createEvent('agent.middleware.decision', {
              middlewareName: mw.name,
              decision: 'inject_message',
              iteration,
            });
            break;
          case 'escalate_to_review':
            // Sprint 3 P2.2 reflection loop exhausted the self-review
            // allowance. Halt the run with a distinct termination reason so
            // the dashboard can tell reflection-exhausted runs apart from
            // generic failures. The review item creation + `awaiting_review`
            // status transition are deferred to Sprint 3B (see
            // docs/improvements-roadmap-spec.md §P2.1 Verdict). In 3A this
            // terminates the run and surfaces the reason via the
            // loop-termination event.
            finalStatus = 'failed';
            iterationSpan.end({
              output: {
                phase,
                postToolEscalate: true,
                escalateReason: postResult.reason,
              },
            });
            emitLoopTermination('middleware_stop', {
              iteration,
              middlewareName: mw.name,
              totalToolCalls,
              escalateReason: postResult.reason,
            });
            createEvent('agent.middleware.decision', {
              middlewareName: mw.name,
              decision: 'escalate_to_review',
              reason: postResult.reason,
              iteration,
            });
            postToolBreakOuter = true;
            break;
          default: {
            const _exhaustive: never = postResult;
            void _exhaustive;
          }
        }
        if (postToolBreakOuter) break;
      }
      if (postToolBreakOuter) break outerLoop;

      const logEntry = {
        tool: toolCall.name,
        input: toolCall.input,
        output: resultContent.length > MAX_TOOL_OUTPUT_LOG_LENGTH
          ? resultContent.slice(0, MAX_TOOL_OUTPUT_LOG_LENGTH) + '...[truncated]'
          : resultContent,
        durationMs: toolDurationMs,
        iteration,
        retried,
      };
      toolCallsLog.push(logEntry);

      // Emit tool call event for live trace (throttled to max 2/sec)
      traceThrottle.emit('agent:run:tool_call', {
        tool: toolCall.name, durationMs: toolDurationMs, iteration,
        totalToolCalls, tokensUsed: totalTokensUsed,
      });

      toolResults.push({ tool_use_id: toolCall.id, content: resultContent });
    }

    const toolResultsContent = toolResults.map(tr => ({
      type: 'tool_result' as const,
      tool_use_id: tr.tool_use_id,
      content: tr.content,
    }));
    messages.push(tagIteration({
      role: 'user',
      content: toolResultsContent,
    }, iteration));

    // Sprint 3 P2.1 Sprint 3A — mirror the tool_results batch into the
    // append-only log. A batch carries multiple tool_use_ids so we do not
    // stamp a single top-level tool_call_id (the partial index in migration
    // 0084 only targets single-block rows). Best-effort writes match the
    // assistant-message path above.
    if (toolResultsContent.length > 0) {
      try {
        const appended = await appendAgentRunMessage({
          runId,
          organisationId: request.organisationId,
          role: 'user',
          content: toolResultsContent,
          toolCallId: toolResultsContent.length === 1 ? toolResultsContent[0].tool_use_id : null,
        });
        messageCursor = appended.sequenceNumber;
      } catch (err) {
        logger.warn('agent_run_messages.append_failed', {
          runId,
          role: 'user',
          iteration,
          batchSize: toolResultsContent.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Sprint 2 P1.1 Layer 3 — drain any messages queued by middleware decisions
    // (`inject_message` action, or `skip { injectMessage }`). Appended as
    // additional user messages after the tool_results batch so they reach the
    // next LLM call.
    for (const injected of pendingInjectedMessages) {
      messages.push({ role: 'user', content: injected });

      // Mirror the injected guidance into the append-only log so a resume
      // picks up the same conversation state the live run would have seen.
      try {
        const appended = await appendAgentRunMessage({
          runId,
          organisationId: request.organisationId,
          role: 'user',
          content: injected,
          toolCallId: null,
        });
        messageCursor = appended.sequenceNumber;
      } catch (err) {
        logger.warn('agent_run_messages.append_failed', {
          runId,
          role: 'user',
          iteration,
          kind: 'injected_message',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    iterationSpan.end({ output: { phase, toolCallsThisIteration: response.toolCalls?.length ?? 0 } });

    // Sprint 3 P2.1 Sprint 3A — persist a structured checkpoint capturing
    // everything needed to resume this run on a different worker. Best-effort:
    // a checkpoint write failure is logged but does not kill the live run.
    await persistCheckpoint({
      runId,
      iteration,
      totalToolCalls,
      totalTokensUsed,
      messageCursor,
      mwCtx,
      configVersion,
    });

    // Check if we've hit the max iteration limit — enforce the exit
    if (iteration >= maxLoopIterations - 1) {
      finalStatus = finalStatus ?? 'completed';
      emitLoopTermination('max_iterations', { iteration, totalToolCalls });
      break outerLoop;
    }
  }
  return {
    summary: lastTextContent || null,
    toolCallsLog,
    totalToolCalls,
    inputTokens: Math.floor(totalTokensUsed * TOKEN_INPUT_RATIO),
    outputTokens: Math.floor(totalTokensUsed * TOKEN_OUTPUT_RATIO),
    totalTokens: totalTokensUsed,
    tasksCreated,
    tasksUpdated,
    deliverablesCreated,
    finalStatus,
  };

  } finally {
    // Flush any pending throttled trace events before returning — guaranteed
    // cleanup even on early exit (timeout, budget, loop_detected, error).
    traceThrottle.destroy();
  }
}

// ---------------------------------------------------------------------------
// persistCheckpoint — Sprint 3 P2.1 Sprint 3A
//
// Writes a structured `AgentRunCheckpoint` into
// `agent_run_snapshots.checkpoint` once per iteration of `runAgenticLoop`.
// The payload is a JSON-safe snapshot of just enough state to resume the
// run on a different worker: counters, message cursor, serialised
// middleware context, and the config fingerprint the resumer will check.
//
// The helper is best-effort — failures are logged and swallowed so the
// live run is not affected by a checkpoint persistence hiccup. Sprint 3B
// tightens this into a hard invariant once the async resume path is
// wired end-to-end.
// ---------------------------------------------------------------------------

interface PersistCheckpointParams {
  runId: string;
  iteration: number;
  totalToolCalls: number;
  totalTokensUsed: number;
  messageCursor: number;
  mwCtx: MiddlewareContext;
  configVersion: string;
}

async function persistCheckpoint(params: PersistCheckpointParams): Promise<void> {
  try {
    // Build a cloned snapshot context so the live middleware context is
    // never mutated by the checkpoint path — the resume path reads from
    // the serialised copy, and mutating the live object here would make
    // post-iteration middleware reason about shifted counters. The clone
    // is shallow: MiddlewareContext values are either primitives or
    // Maps/objects that `serialiseMiddlewareContext` already deep-copies
    // into the JSON-safe shape.
    const snapshotCtx: MiddlewareContext = {
      ...params.mwCtx,
      iteration: params.iteration,
      tokensUsed: params.totalTokensUsed,
      toolCallsCount: params.totalToolCalls,
    };

    const serialised = serialiseMiddlewareContext(snapshotCtx);

    const checkpoint: AgentRunCheckpoint = {
      version: 1,
      iteration: params.iteration,
      totalToolCalls: params.totalToolCalls,
      totalTokensUsed: params.totalTokensUsed,
      // A fresh run with no messages has `messageCursor = -1` because we
      // initialise the tracker to -1 and only advance it after a
      // successful append. Preserve the -1 sentinel exactly — the
      // resume path reads `messageCursor < 0` as "skip the stream
      // altogether" (see `resumeAgentRun`). Clamping to 0 would
      // conflate "no rows persisted" with "one row at seq 0" and
      // cause the first persisted message to be replayed on resume.
      messageCursor: params.messageCursor,
      middlewareContext: serialised,
      // Resume token is opaque in 3A — 3B wires the enforcement in the
      // admin resume endpoint. Use a hash of runId + iteration so the
      // token is deterministic per iteration but non-trivial to guess
      // from the runId alone.
      resumeToken: createHash('sha256')
        .update(`${params.runId}:${params.iteration}:${params.configVersion}`)
        .digest('hex')
        .slice(0, 32),
      configVersion: params.configVersion,
    };

    await db
      .insert(agentRunSnapshots)
      .values({ runId: params.runId, checkpoint })
      .onConflictDoUpdate({
        target: agentRunSnapshots.runId,
        set: { checkpoint },
      });
  } catch (err) {
    logger.warn('agent_run_checkpoint.persist_failed', {
      runId: params.runId,
      iteration: params.iteration,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// buildInitialMessage — initial user-message builder.
//
// Selects the seed message based on `request.runType` and optionally
// prepends a "Previous Session" handoff block when
// `request.seedFromPreviousRun` is set and a previous handoff was found.
// ---------------------------------------------------------------------------

function buildInitialMessage(request: AgentRunRequest, previousSessionBlock?: string | null): string {
  let base: string;
  if (request.taskId) {
    base = `You have a task assigned to you. Please work on it now. The task details are in your system context above.`;
  } else {
    const messages: Record<string, string> = {
      scheduled: 'This is your scheduled run. Check the board, review any tasks assigned to you, and do your job. Take actions based on your role and current board state.',
      manual: 'You have been manually triggered. Check the board and take appropriate actions based on your role.',
      triggered: 'You have been triggered by an event. Check the trigger context and board, then take appropriate actions.',
    };
    base = messages[request.runType] ?? messages.manual;
  }

  // Brain Tree OS adoption P1 — when seedFromPreviousRun is enabled and the
  // caller fetched a previous handoff, prepend a "Previous Session" block so
  // the agent sees its own last handoff before the new instruction.
  if (previousSessionBlock) {
    return `${previousSessionBlock}\n\n${base}`;
  }
  return base;
}

/**
 * Format an AgentRunHandoffV1 as a "Previous Session" markdown block for
 * injection into the initial user message. Imported by runAgenticLoop when
 * `seedFromPreviousRun` is set on the request.
 */
function formatPreviousSessionBlock(handoff: import('./agentRunHandoffServicePure.js').AgentRunHandoffV1): string {
  const lines: string[] = ['## Previous Session', ''];
  if (handoff.accomplishments.length > 0) {
    lines.push('**Accomplishments:**');
    for (const a of handoff.accomplishments) lines.push(`- ${a}`);
    lines.push('');
  }
  if (handoff.decisions.length > 0) {
    lines.push('**Decisions:**');
    for (const d of handoff.decisions) {
      lines.push(d.rationale ? `- ${d.decision} (because ${d.rationale})` : `- ${d.decision}`);
    }
    lines.push('');
  }
  if (handoff.blockers.length > 0) {
    lines.push('**Blockers:**');
    for (const b of handoff.blockers) lines.push(`- [${b.severity}] ${b.blocker}`);
    lines.push('');
  }
  if (handoff.nextRecommendedAction) {
    lines.push(`**Next recommended action:** ${handoff.nextRecommendedAction}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
