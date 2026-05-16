import type { HierarchyContext } from '../../../shared/types/delegation.js';
import type { HandlerContext } from '../handlerContextTypes.js';

export interface SkillExecutionContext {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  /**
   * Cross-subaccount access control. null = full org access (org subaccount agents).
   * Array of IDs = scoped to those subaccounts only (regular subaccount agents).
   * Derived from whether the agent runs in the org subaccount. See spec §7c.
   */
  allowedSubaccountIds?: string[] | null;
  agentId: string;
  /** Phase 2C: agent's memory domain derived from agentRole. Used to scope memory search. */
  agentDomain?: string;
  /**
   * The principal that initiated this run, when known. Populated by
   * agentExecutionService when the AgentRunRequest carries a userId.
   * Used by user-scoped tools (e.g. Workflow Studio propose_save) to
   * enforce ownership without trusting tool inputs. Undefined for
   * scheduled / system runs that have no initiating user — tools that
   * require a user MUST refuse to run when this is undefined.
   * Review finding #3.
   */
  userId?: string;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
  handoffDepth?: number;
  isSubAgent?: boolean;
  tokenBudget?: number;
  startTime?: number;
  timeoutMs?: number;
  /** The task this agent run is working on, if any. Used for gate escalation. */
  taskId?: string;
  /** MCP client instances for this run. Set by agentExecutionService. */
  _mcpClients?: Map<string, import('../mcpClientManager.js').McpClientInstance>;
  /** MCP lazy server registry for deferred connection. */
  _mcpLazyRegistry?: Map<string, import('../../db/schema/mcpServerConfigs.js').McpServerConfig>;
  /** MCP call counter for budget enforcement. */
  mcpCallCount?: number;
  /** Whether this run is a test run — propagated from agentRun.isTestRun. */
  isTestRun?: boolean;
  /**
   * Depth of the current workflow run chain. 1 = top-level. Incremented on
   * each workflow.run.start call. MAX_WORKFLOW_DEPTH = 3.
   * Absent for non-workflow runs (orchestrator job, direct agent invocations).
   */
  workflowRunDepth?: number;
  /**
   * The conversation this run is associated with, when known. Populated from
   * AgentRunRequest.conversationId so that worker skills that need to write
   * conversation-scoped data (e.g. update_thread_context) can resolve the
   * correct conversation without a DB lookup.
   */
  conversationId?: string;
  /**
   * Loaded context data for this run — populated by agentExecutionService
   * via loadRunContextData before the loop starts. Used by the
   * read_data_source skill handler to answer list/read ops against the
   * same pool that was used to build the system prompt. See spec §8.2.
   */
  runContextData?: import('../runContextLoader.js').RunContextData;
  /**
   * Running count of read_data_source `op: 'read'` calls made during
   * this run. Enforced against MAX_READ_DATA_SOURCE_CALLS_PER_RUN.
   * Lives on the context so it survives across tool-call iterations.
   */
  readDataSourceCallCount?: number;
  /**
   * Immutable snapshot of this agent's position in the subaccount hierarchy.
   * Built once per run by agentExecutionService BEFORE skill resolution.
   * Undefined for diagnostic/test runs or when the agent has no subaccount context.
   * See INV-4 in tasks/builds/paperclip-hierarchy/plan.md.
   */
  hierarchy?: Readonly<HierarchyContext>;
  /**
   * Current LLM tool call id, set by skillExecutor.execute() at the top
   * of every dispatch. Sprint 2 P1.1 Layer 3: when present, the per-case
   * action wrappers below use it to build a deterministic idempotency
   * key (runId, toolCallId, args_hash) that matches the key written by
   * proposeActionMiddleware. This makes the middleware + wrapper
   * coexistence resolve to the same action row via the
   * actions.idempotency_key unique constraint.
   */
  toolCallId?: string;
  /**
   * Per-run counter for capability-discovery skill calls
   * (list_platform_capabilities, list_connections, check_capability_gap).
   * Enforced against systemSettings.orchestrator_capability_query_budget
   * (default 8). When exhausted, further calls return
   * { error: 'capability_query_budget_exhausted' } so the Orchestrator
   * stops looping rather than burning tokens. See
   * docs/orchestrator-capability-routing-spec.md §6.4.3.
   */
  capabilityQueryCallCount?: number;
}

/**
 * Asserts that the skill execution context has a subaccountId.
 * Call this at the top of any skill that requires subaccount scope.
 * Returns the subaccountId as a non-null string for downstream use.
 */
export function requireSubaccountContext(context: SkillExecutionContext, skillName: string): string {
  if (!context.subaccountId) {
    throw new Error(`Skill '${skillName}' requires a subaccount context but this is an org-level run. Use a subaccount-scoped agent or specify a targetSubaccountId.`);
  }
  return context.subaccountId;
}

/**
 * Signature for a skill handler entry in SKILL_HANDLERS. Each entry is an
 * async function that receives the raw tool input and the current skill
 * execution context and returns whatever value the LLM should observe as the
 * tool result. This is the Phase 0 replacement for the old switch statement
 * dispatch — keeping the registry shape explicit (not a Map) so static
 * analysis and the skill-analyzer can walk the keys directly.
 */
export type SkillHandler = (
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  handlerContext: HandlerContext,
) => Promise<unknown>;
