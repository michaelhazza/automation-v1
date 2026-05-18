import type { LoopParams } from '../agentExecutionLoop.js';
import type { DelegationScope, DelegationDirection, HierarchyContext } from '../../../shared/types/delegation.js';
import type { agentRuns, subaccountAgents, tasks } from '../../db/schema/index.js';
import type { agentService } from '../agentService.js';
import type { PolicyEnvelopeSnapshot } from '../../../shared/types/policyEnvelope.js';
import type { RunContextData } from '../runContextLoader.js';
import type { RetrievalResult, RetrievalResultLoaded } from '../../../shared/types/retrieval.js';
import type { getOrgProcessesForTools, AnthropicTool } from '../llmService.js';
import type { MiddlewarePipeline } from '../middleware/types.js';
import type { McpClientInstance } from '../mcpClientManager.js';
import type { McpServerConfig } from '../../db/schema/mcpServerConfigs.js';
import type { BackendDispatchResult } from '../executionBackends/types.js';

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
export interface ExecutionClosureContext {
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
  /**
   * AE2 / spec §5.2 step 1 — when the `agent-handoff-run` worker dequeues a
   * job whose payload carries a pre-created `runId` (created in
   * `enqueueHandoff` under the same transaction as `boss.send`), it passes
   * that id here. `persistAndAnnounce` then takes ownership of the existing
   * `pending` row (transitioning it to `running`) instead of inserting a
   * second `agent_runs` row. Without this, the worker leaves the
   * pre-created row stuck in `pending` and the parent's spawn poll-loop
   * polls the wrong runId — producing false `spawn_timeout` and duplicate
   * runs per spawned child.
   */
  preCreatedRunId?: string;
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
export interface TaskWithAgent {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignedAgentId: string | null;
  assignedAgent: { id: string; name: string | null; slug: string | null } | null;
  createdAt: Date;
  [key: string]: unknown;
}

/**
 * Mutable context record threaded through phase functions (Chunks 4-9).
 * Each phase accepts `(request, ctx)` and populates fields consumed by
 * later phases. Intentionally open-shape; concrete fields land with each
 * phase chunk.
 *
 * Extended by Chunks 5-9 — see DEFERRED AGENTEXEC-SPLIT-DEF-2 for shape
 * consolidation.
 */
// Extended in Chunk 4+; Chunk 5 adds resolvedControllerStyleAllowed, controllerStyleSource, run; Chunk 6 adds agent, saLink, tokenBudget, maxToolCalls, timeoutMs, configSkillSlugs, configCustomInstructions, configHash, configVersion, policyEnvelope, maxLoopIterations
export interface RunExecutionContext {
  startTime: number;
  isOrgSubaccountRun: boolean;
  idempotencyLookupKeys: string[];
  // Populated by persistAndAnnounce (Chunk 5)
  resolvedControllerStyleAllowed?: string;
  controllerStyleSource?: 'subaccount_agent' | 'default' | string;
  run?: typeof agentRuns.$inferSelect;
  // Populated by configureRun (Chunk 6)
  agent?: Awaited<ReturnType<typeof agentService.getAgent>>;
  saLink?: typeof subaccountAgents.$inferSelect;
  tokenBudget?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  configSkillSlugs?: string[];
  configCustomInstructions?: string | null;
  configHash?: string;
  configVersion?: string;
  policyEnvelope?: PolicyEnvelopeSnapshot;
  maxLoopIterations?: number;
  // Populated by loadRunContextAndHierarchy (Chunk 7a)
  runContextData?: RunContextData;
  retrievalResult?: RetrievalResult;
  knowledgeLoaded?: RetrievalResultLoaded[];
  orgProcesses?: Awaited<ReturnType<typeof getOrgProcessesForTools>>;
  hierarchyContext?: Readonly<HierarchyContext>;
  // Populated by prepareRun (Chunk 7b)
  effectiveTools?: AnthropicTool[];
  pipeline?: MiddlewarePipeline;
  mcpClients?: Map<string, McpClientInstance> | null;
  mcpLazyRegistry?: Map<string, McpServerConfig> | null;
  workspaceContext?: string;
  targetItem?: typeof tasks.$inferSelect | null;
  agentDomain?: string;
  injectedMemoryEntries?: Array<{ id: string; content: string }>;
  appliedMemoryBlockIds?: string[];
  stablePrefix?: string;
  dynamicSuffix?: string;
  systemPrompt?: string;
  systemPromptTokens?: number;
  // Populated by dispatchRun (Chunk 8)
  dispatchResult?: BackendDispatchResult;
}

/**
 * Discriminated union returned by Chunk 4's `validateAndPrepare`.
 * `early_exit` means the caller should return `result` immediately;
 * `proceed` means execution continues with the populated `ctx`.
 */
export type ValidatePrepareResult =
  | { kind: 'early_exit'; result: AgentRunResult }
  | { kind: 'proceed'; ctx: RunExecutionContext };
