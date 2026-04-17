import { eq, and, isNull, count, inArray } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env } from '../lib/env.js';
import { createSpan, createEvent } from '../lib/tracing.js';
import { TripWire } from '../lib/tripwire.js';
import type { ProcessorHooks, ProcessorContext } from '../types/processor.js';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentRuns, tasks, actions, scheduledTasks } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { executeTriggerredProcess } from './llmService.js';
import { agentExecutionService } from './agentExecutionService.js';
import { actionService, buildActionIdempotencyKey } from './actionService.js';
import { executionLayerService, registerAdapter } from './executionLayerService.js';
import { reviewService } from './reviewService.js';
import { hitlService } from './hitlService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { devContextService, assertPathInRoot } from './devContextService.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';
import * as priorityFeedService from './priorityFeedService.js';
import * as skillStudioService from './skillStudioService.js';
import { scrapingEngine, parseFrequencyToRRule, serializeMonitorBrief, parseMonitorBrief } from './scrapingEngine/index.js';
import { loadSelectors, saveSelector, incrementHit, incrementMiss, updateSelector } from './scrapingEngine/selectorStore.js';
import { buildFingerprint, resolveSelector } from './scrapingEngine/adaptiveSelector.js';
import { canonicalizeFieldKey, computeContentHash } from './scrapingEngine/contentExtractor.js';
import { scheduledTaskService } from './scheduledTaskService.js';
import { routeCall } from './llmRouter.js';
import {
  MAX_HANDOFF_DEPTH,
  MAX_TASK_TITLE_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  VALID_PRIORITIES,
  MAX_SUB_AGENTS,
  MIN_SUB_AGENT_TOKEN_BUDGET,
  SUB_AGENT_TIMEOUT_BUFFER,
  HITL_REVIEW_TIMEOUT_MS,
  type TaskPriority,
} from '../config/limits.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Register worker adapter for execution layer (handles review-gated worker actions)
// ---------------------------------------------------------------------------
import { createWorkerAdapter } from './adapters/workerAdapter.js';

registerAdapter('worker', createWorkerAdapter(async (actionType, payload, ctx) => {
  const context = ctx as unknown as SkillExecutionContext;
  switch (actionType) {
    case 'create_page': return executeCreatePage(payload, context);
    case 'update_page': return executeUpdatePage(payload, context);
    case 'publish_page': return executePublishPage(payload, context);
    case 'write_spec': return executeWriteSpecApproved(payload, context);
    case 'publish_post': return executePublishPostApproved(payload, context);
    case 'update_bid': return executeAdsActionApproved('update_bid', payload, context);
    case 'update_copy': return executeAdsActionApproved('update_copy', payload, context);
    case 'pause_campaign': return executeAdsActionApproved('pause_campaign', payload, context);
    case 'increase_budget': return executeAdsActionApproved('increase_budget', payload, context);
    case 'update_crm': return executeCrmUpdateApproved(payload, context);
    case 'update_financial_record': return executeFinancialRecordUpdateApproved(payload, context);
    case 'create_lead_magnet': return executeLeadMagnetApproved(payload, context);
    case 'deliver_report': return executeDeliverReportApproved(payload, context);
    case 'configure_integration': return executeConfigureIntegrationApproved(payload, context);
    case 'propose_doc_update': return executeDocProposalApproved(payload, context);
    case 'write_docs': return executeWriteDocsApproved(payload, context);
    default: return { success: false, error: `No worker handler for: ${actionType}` };
  }
}));

// ---------------------------------------------------------------------------
// Skill Executor — executes tool calls for autonomous agent runs
// ---------------------------------------------------------------------------

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
   * Used by user-scoped tools (e.g. Playbook Studio propose_save) to
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
  _mcpClients?: Map<string, import('./mcpClientManager.js').McpClientInstance>;
  /** MCP lazy server registry for deferred connection. */
  _mcpLazyRegistry?: Map<string, import('../db/schema/mcpServerConfigs.js').McpServerConfig>;
  /** MCP call counter for budget enforcement. */
  mcpCallCount?: number;
  /** Whether this run is a test run — propagated from agentRun.isTestRun. */
  isTestRun?: boolean;
  /**
   * Loaded context data for this run — populated by agentExecutionService
   * via loadRunContextData before the loop starts. Used by the
   * read_data_source skill handler to answer list/read ops against the
   * same pool that was used to build the system prompt. See spec §8.2.
   */
  runContextData?: import('./runContextLoader.js').RunContextData;
  /**
   * Running count of read_data_source `op: 'read'` calls made during
   * this run. Enforced against MAX_READ_DATA_SOURCE_CALLS_PER_RUN.
   * Lives on the context so it survives across tool-call iterations.
   */
  readDataSourceCallCount?: number;
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

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
  /**
   * Tool call ID from the LLM response. Sprint 2 P1.1 Layer 3 requires a
   * deterministic idempotency key so the proposeActionMiddleware and the
   * per-case action wrappers both resolve to the same action row. When
   * omitted (legacy callers), the wrappers fall back to a non-deterministic
   * key. The middleware + wrapper coexistence relies on this being set.
   */
  toolCallId?: string;
}

/**
 * Asserts that the skill execution context has a subaccountId.
 * Call this at the top of any skill that requires subaccount scope.
 * Returns the subaccountId as a non-null string for downstream use.
 */
function requireSubaccountContext(context: SkillExecutionContext, skillName: string): string {
  if (!context.subaccountId) {
    throw new Error(`Skill '${skillName}' requires a subaccount context but this is an org-level run. Use a subaccount-scoped agent or specify a targetSubaccountId.`);
  }
  return context.subaccountId;
}

// ---------------------------------------------------------------------------
// onFailure dispatch (P0.2 Slice C of docs/improvements-roadmap-spec.md)
//
// When a skill handler throws or returns { success: false, ... }, look up
// the action definition's `onFailure` directive and dispatch:
//
//   - 'retry' (default)  — propagate the original error / failure object
//                          unchanged. Caller is responsible for retry logic
//                          (withBackoff / TripWire / agent loop).
//   - 'skip'             — return { success: false, skipped: true, reason }
//                          to the LLM. The agent loop continues without the
//                          result. Used for non-essential reads.
//   - 'fail_run'         — terminate the entire agent run via the closed
//                          FailureReason enum. Caller catches via FailureError.
//   - 'fallback'         — return actionDef.fallbackValue as the result
//                          instead of failing. Used for read-only tools where
//                          a stale or empty value is preferable.
// ---------------------------------------------------------------------------

import {
  applyOnFailurePure,
  applyOnFailureForStructuredFailurePure,
  type OnFailureDirective,
} from './skillExecutorPure.js';

function applyOnFailure(toolSlug: string, err: unknown): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive: OnFailureDirective = actionDef?.onFailure ?? 'retry';
  return applyOnFailurePure(toolSlug, directive, actionDef?.fallbackValue, err);
}

function applyOnFailureForStructuredFailure(
  toolSlug: string,
  result: Record<string, unknown>,
): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive: OnFailureDirective = actionDef?.onFailure ?? 'retry';
  return applyOnFailureForStructuredFailurePure(toolSlug, directive, actionDef?.fallbackValue, result);
}

// ---------------------------------------------------------------------------
// Per-tool processor hooks registry
// Maps action type slug → ProcessorHooks (input/output transform pipeline)
// ---------------------------------------------------------------------------

const processorRegistry: Map<string, ProcessorHooks> = new Map();

/** Register processor hooks for a tool slug. Called at module load time. */
export function registerProcessor(toolSlug: string, hooks: ProcessorHooks): void {
  processorRegistry.set(toolSlug, hooks);
}

/** Internal: run registered processor phases around a tool executor. */
async function runWithProcessors(
  toolSlug: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  executor: (processedInput: Record<string, unknown>) => Promise<unknown>,
  actionId?: string,
): Promise<unknown> {
  const hooks = processorRegistry.get(toolSlug);
  const processorCtx: ProcessorContext = {
    toolSlug,
    input,
    subaccountId: context.subaccountId,
    organisationId: context.organisationId,
    agentRunId: context.runId,
    actionId,
  };

  let processedInput = input;

  // Phase 1: processInput (before gate)
  if (hooks?.processInput) {
    try {
      processedInput = (await hooks.processInput({ ...processorCtx, input: processedInput })) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;  // fatal — propagate to caller
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  // Phase 2: processInputStep (after gate, before execute)
  if (hooks?.processInputStep) {
    try {
      processedInput = (await hooks.processInputStep({ ...processorCtx, input: processedInput })) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  // Execute — dispatch on actionDef.onFailure (P0.2 Slice C) for failures.
  let result: unknown;
  try {
    result = await executor(processedInput);
  } catch (err) {
    if (err instanceof TripWire) {
      return { success: false, error: err.reason, retryable: err.options.retry };
    }
    // Non-TripWire failure — apply the action's onFailure directive if declared.
    return applyOnFailure(toolSlug, err);
  }

  // Successful return value but the executor signalled a structured failure.
  // Apply onFailure here too so 'skip' / 'fallback' fire on either error path.
  if (
    result !== null &&
    typeof result === 'object' &&
    (result as { success?: unknown }).success === false
  ) {
    // Symmetric with the thrown-error path: the pure helper already handles
    // 'retry' / unset by returning the result unchanged.
    result = applyOnFailureForStructuredFailure(toolSlug, result as Record<string, unknown>);
  }

  // Phase 3: processOutputStep (after execute)
  if (hooks?.processOutputStep) {
    try {
      result = await hooks.processOutputStep({ ...processorCtx, input: processedInput, actionId }, result);
    } catch (err) {
      if (err instanceof TripWire) {
        if (!err.options.retry) throw err;
        return { success: false, error: err.reason, retryable: true };
      }
      throw err;
    }
  }

  return result;
}

// Handoff job queue name
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';

// pg-boss reference for enqueueing handoff jobs (set by agentScheduleService)
let pgBossSend: ((name: string, data: object) => Promise<string | null>) | null = null;

export function setHandoffJobSender(sender: (name: string, data: object) => Promise<string | null>) {
  pgBossSend = sender;
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
) => Promise<unknown>;

/**
 * Registry of skill handlers keyed by skill name. The `skillExecutor.execute`
 * method dispatches to an entry here after handling the MCP prefix and the
 * toolCallId stash. Previously this was a 770-line switch statement; it now
 * lives as a module-level constant so other modules (notably the
 * skill-analyzer) can enumerate the supported skill names without having to
 * parse source code.
 */
export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  // ── Meta tools — BM25 tool discovery (no action record) ─────────────
  search_tools: async (input, context) => {
    const { executeSearchTools } = await import('../tools/meta/searchTools.js');
    return executeSearchTools(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
  },
  load_tool: async (input, context) => {
    const { executeLoadTool } = await import('../tools/meta/searchTools.js');
    return executeLoadTool(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
  },

  // ── Direct skills (no action record) ──────────────────────────────
  web_search: async (input, context) => {
    return executeWebSearch(input, context);
  },
  read_workspace: async (input, context) => {
    requireSubaccountContext(context, 'read_workspace');
    return executeReadWorkspace(input, context);
  },
  write_workspace: async (input, context) => {
    requireSubaccountContext(context, 'write_workspace');
    return executeWriteWorkspace(input, context);
  },
  search_agent_history: async (input, context) => {
    const op = input.op as string;
    if (op === 'search') {
      const results = await workspaceMemoryService.semanticSearchMemories({
        query: input.query as string,
        orgId: context.organisationId,
        subaccountId: context.subaccountId ?? '',
        includeOtherSubaccounts: (input.includeOtherSubaccounts as boolean) ?? !context.subaccountId,
        topK: (input.topK as number) ?? 10,
        domain: context.agentDomain,
      });
      return { success: true, results };
    } else if (op === 'read') {
      const entry = await workspaceMemoryService.getMemoryEntry(
        input.memoryId as string,
        context.organisationId,
      );
      if (!entry) return { success: false, error: 'Memory entry not found' };
      return { success: true, entry };
    }
    return { success: false, error: `Unknown op: ${op}` };
  },
  read_priority_feed: async (input, context) => {
    const op = input.op as string;
    if (op === 'list') {
      const items = await priorityFeedService.listFeed(
        { orgId: context.organisationId, subaccountId: context.subaccountId ?? undefined, agentRunId: context.runId },
        { limit: (input.limit as number) ?? 20 },
      );
      return { success: true, items };
    } else if (op === 'claim') {
      const result = await priorityFeedService.claimItem(
        input.source as string,
        input.itemId as string,
        context.runId,
        (input.ttlMinutes as number) ?? 30,
      );
      return { success: result.claimed, ...result };
    } else if (op === 'release') {
      await priorityFeedService.releaseItem(
        input.source as string,
        input.itemId as string,
        context.runId,
      );
      return { success: true };
    }
    return { success: false, error: `Unknown op: ${op}` };
  },
  // ── Skill Studio skills (Feature 3) ──────────────────────────────────
  skill_read_existing: async (input, context) => {
    const ctx = await skillStudioService.getSkillStudioContext(
      input.skillId as string, input.scope as 'system' | 'org', context.organisationId,
    );
    if (!ctx) return { success: false, error: 'Skill not found' };
    return { success: true, skill: { id: ctx.id, slug: ctx.slug, name: ctx.name, definition: ctx.definition, instructions: ctx.instructions } };
  },
  skill_read_regressions: async (input, context) => {
    const ctx = await skillStudioService.getSkillStudioContext(
      input.skillId as string ?? '', 'system', context.organisationId,
    );
    return { success: true, regressions: ctx?.regressions ?? [] };
  },
  skill_validate: async (input) => {
    const result = await skillStudioService.validateSkillDefinition(input.definition, input.handlerKey as string);
    return { success: result.valid, ...result };
  },
  skill_simulate: async (input, context) => {
    const results = await skillStudioService.simulateSkillVersion(
      input.definition as object, (input.instructions as string) ?? null,
      (input.regressionCaseIds as string[]) ?? [], context.organisationId,
    );
    return { success: true, results };
  },
  skill_propose_save: async (input, context) => {
    const version = await skillStudioService.saveSkillVersion(
      input.skillId as string, input.scope as 'system' | 'org',
      context.organisationId, {
        name: input.name as string,
        definition: input.definition as object,
        instructions: (input.instructions as string) ?? null,
        changeSummary: (input.changeSummary as string) ?? undefined,
        regressionIds: (input.regressionIds as string[]) ?? undefined,
        simulationPassCount: (input.simulationPassCount as number) ?? 0,
        simulationTotalCount: (input.simulationTotalCount as number) ?? 0,
      }, context.userId ?? '',
    );
    return { success: true, version };
  },
  trigger_process: async (input, context) => {
    requireSubaccountContext(context, 'trigger_process');
    return executeTriggerProcess(input, context);
  },
  spawn_sub_agents: async (input, context) => {
    requireSubaccountContext(context, 'spawn_sub_agents');
    return executeSpawnSubAgents(input, context);
  },

  // ── Context data source retrieval (spec §8.2) ────────────────────────
  read_data_source: async (input, context) => {
    const { executeReadDataSource } = await import('../tools/readDataSource.js');
    return executeReadDataSource(input, context);
  },

  // ── Auto-gated skills (action record for audit, executes synchronously) ──
  create_task: async (input, context) => {
    requireSubaccountContext(context, 'create_task');
    return executeWithActionAudit('create_task', input, context, () => executeCreateTask(input, context));
  },
  triage_intake: async (input, context) => {
    requireSubaccountContext(context, 'triage_intake');
    return executeWithActionAudit('triage_intake', input, context, () => executeTriageIntake(input, context));
  },
  move_task: async (input, context) => {
    return executeWithActionAudit('move_task', input, context, () => executeMoveTask(input, context));
  },
  add_deliverable: async (input, context) => {
    return executeWithActionAudit('add_deliverable', input, context, () => executeAddDeliverable(input, context));
  },
  reassign_task: async (input, context) => {
    requireSubaccountContext(context, 'reassign_task');
    return executeWithActionAudit('reassign_task', input, context, () => executeReassignTask(input, context));
  },
  update_task: async (input, context) => {
    return executeWithActionAudit('update_task', input, context, () => executeUpdateTask(input, context));
  },
  read_inbox: async (input, context) => {
    return executeWithActionAudit('read_inbox', input, context, () => executeReadInbox(input, context));
  },
  fetch_url: async (input, context) => {
    return executeWithActionAudit('fetch_url', input, context, () => executeFetchUrl(input, context));
  },
  scrape_url: async (input, context) => {
    return executeWithActionAudit('scrape_url', input, context, () => executeScrapeUrl(input, context));
  },
  scrape_structured: async (input, context) => {
    return executeWithActionAudit('scrape_structured', input, context, () => executeScrapeStructured(input, context));
  },
  monitor_webpage: async (input, context) => {
    return executeWithActionAudit('monitor_webpage', input, context, () => executeMonitorWebpage(input, context));
  },

  // ── Playbook Studio tools (system-admin only; agent: playbook-author) ──
  playbook_read_existing: async (input) => {
    return executePlaybookReadExisting(input);
  },
  playbook_validate: async (input) => {
    return executePlaybookValidate(input);
  },
  playbook_simulate: async (input) => {
    return executePlaybookSimulate(input);
  },
  playbook_estimate_cost: async (input) => {
    return executePlaybookEstimateCost(input);
  },
  playbook_propose_save: async (input, context) => {
    return executePlaybookProposeSave(input, context);
  },
  import_n8n_workflow: async (input) => {
    return executeImportN8nWorkflow(input);
  },

  // ── Review-gated skills (proposes action, does NOT execute immediately) ──
  send_email: async (input, context) => {
    return proposeReviewGatedAction('send_email', input, context);
  },
  update_record: async (input, context) => {
    return proposeReviewGatedAction('update_record', input, context);
  },
  request_approval: async (input, context) => {
    return proposeReviewGatedAction('request_approval', input, context);
  },

  // ── Dev/QA auto-gated skills (all require subaccount context) ─────────
  read_codebase: async (input, context) => {
    requireSubaccountContext(context, 'read_codebase');
    return executeWithActionAudit('read_codebase', input, context, () => executeReadCodebase(input, context));
  },
  search_codebase: async (input, context) => {
    requireSubaccountContext(context, 'search_codebase');
    return executeWithActionAudit('search_codebase', input, context, () => executeSearchCodebase(input, context));
  },
  run_tests: async (input, context) => {
    requireSubaccountContext(context, 'run_tests');
    return executeWithActionAudit('run_tests', input, context, () => executeRunTests(input, context));
  },
  analyze_endpoint: async (input, context) => {
    requireSubaccountContext(context, 'analyze_endpoint');
    return executeWithActionAudit('analyze_endpoint', input, context, () => executeAnalyzeEndpoint(input, context));
  },
  report_bug: async (input, context) => {
    requireSubaccountContext(context, 'report_bug');
    return executeWithActionAudit('report_bug', input, context, () => executeReportBug(input, context));
  },
  capture_screenshot: async (input, context) => {
    requireSubaccountContext(context, 'capture_screenshot');
    return executeWithActionAudit('capture_screenshot', input, context, () => executeCaptureScreenshot(input, context));
  },
  run_playwright_test: async (input, context) => {
    requireSubaccountContext(context, 'run_playwright_test');
    return executeWithActionAudit('run_playwright_test', input, context, () => executeRunPlaywrightTest(input, context));
  },

  // ── Dev review-gated skills (safeMode-checked, require subaccount) ───
  write_patch: async (input, context) => {
    requireSubaccountContext(context, 'write_patch');
    return proposeDevopsAction('write_patch', input, context);
  },
  run_command: async (input, context) => {
    requireSubaccountContext(context, 'run_command');
    return proposeDevopsAction('run_command', input, context);
  },
  create_pr: async (input, context) => {
    requireSubaccountContext(context, 'create_pr');
    return proposeDevopsAction('create_pr', input, context);
  },

  // ── Page infrastructure skills (require subaccount) ────────────────
  create_page: async (input, context) => {
    requireSubaccountContext(context, 'create_page');
    return proposeReviewGatedAction('create_page', input, context);
  },
  update_page: async (input, context) => {
    requireSubaccountContext(context, 'update_page');
    return proposeReviewGatedAction('update_page', input, context);
  },
  publish_page: async (input, context) => {
    requireSubaccountContext(context, 'publish_page');
    return proposeReviewGatedAction('publish_page', input, context);
  },

  // ── Methodology skills — LLM-guided reasoning; executor returns a
  //    structured scaffold the agent fills using the injected instructions ─
  draft_architecture_plan: async (input) => {
    return executeMethodologySkill('draft_architecture_plan', input, {
      template: {
        intent: '',
        classification: '',
        implementationChunks: [],
        contracts: [],
        failureModes: [],
        openQuestions: [],
        affectedFiles: [],
        testStrategy: '',
      },
      guidance: 'Fill in each section of the architecture plan template above. Use the methodology instructions in your context. Return the completed plan as your tool result.',
    });
  },
  draft_tech_spec: async (input) => {
    return executeMethodologySkill('draft_tech_spec', input, {
      template: {
        openApiChanges: '',
        schemaChanges: '',
        sequenceDiagram: '',
        migrationPlan: '',
        breakingChanges: [],
        envVarChanges: [],
      },
      guidance: 'Fill in each section of the tech spec template. Omit sections not applicable to this change.',
    });
  },
  review_ux: async (input) => {
    return executeMethodologySkill('review_ux', input, {
      template: {
        findings: [],
        highPriority: [],
        mediumPriority: [],
        lowPriority: [],
        recommendation: 'proceed | revise | escalate',
      },
      guidance: 'Evaluate each changed UI surface against the UX checklist in your context. Populate findings by priority.',
    });
  },
  review_code: async (input) => {
    return executeMethodologySkill('review_code', input, {
      template: {
        blocking: [],
        nonBlocking: [],
        securityIssues: [],
        planComplianceIssues: [],
        acCoverageGaps: [],
        recommendation: 'approve | revise | escalate',
      },
      guidance: 'Review each changed file against the checklist in your context. Only blocking issues prevent submission.',
    });
  },
  write_tests: async (input) => {
    return executeMethodologySkill('write_tests', input, {
      template: {
        targetFile: '',
        framework: '',
        testCases: [],
        coveredScenarios: [],
        deferredScenarios: [],
        estimatedCoverageDelta: '',
      },
      guidance: 'Follow the test authorship methodology in your context. For each scenario, write the test case and submit via write_patch.',
    });
  },

  // ── BA / QA MVP skills ───────────────────────────────────────────────
  draft_requirements: async (input) => {
    return executeMethodologySkill('draft_requirements', input, {
      template: {
        taskId: '',
        status: 'draft',
        userStories: [],
        openQuestions: [],
        definitionOfDone: [],
        traceability: [],
      },
      guidance: 'Follow the draft_requirements methodology in your skill context. Produce a structured requirements spec with INVEST user stories, Gherkin ACs (AC-X.Y format, Type: positive/negative), ranked open questions, and a Definition of Done. If the brief is too ambiguous, return a clarification_required response instead of a partial spec.',
    });
  },
  derive_test_cases: async (input) => {
    return executeMethodologySkill('derive_test_cases', input, {
      template: {
        specReferenceId: '',
        manifestValidFor: '',
        taskId: '',
        testCases: [],
        coverageMatrix: [],
        untestableAcs: [],
      },
      guidance: 'Follow the derive_test_cases methodology in your skill context. For each Gherkin AC in the spec, produce a test case with a stable TC-[task_id]-NNN ID, preconditions, action, and expected result. Write the completed manifest to workspace memory via write_workspace.',
    });
  },
  write_spec: async (input, context) => {
    return proposeReviewGatedAction('write_spec', input, context);
  },

  // ── Support Agent skills ─────────────────────────────────────────────
  classify_email: async (input) => {
    return executeMethodologySkill('classify_email', input, {
      template: {
        emailReference: '',
        primaryIntent: '',
        urgency: '',
        sentiment: '',
        routingAction: '',
        isAutomated: false,
        keySignals: [],
        classificationNotes: '',
        suggestedReplyTone: '',
      },
      guidance: 'Follow the classify_email methodology in your skill context. Classify the email by intent category, urgency, sentiment, and routing action. Return the structured classification result.',
    });
  },
  draft_reply: async (input) => {
    return executeMethodologySkill('draft_reply', input, {
      template: {
        to: '',
        subject: '',
        confidence: '',
        routingAction: '',
        body: '',
        confidenceFlags: [],
        draftingNotes: '',
      },
      guidance: 'Follow the draft_reply methodology in your skill context. Use the classification output and knowledge base context to draft a concise, on-brand reply. If routing_action is escalate, return an escalation response instead of a draft.',
    });
  },
  search_knowledge_base: async (input, context) => {
    // Auto-gated stub — integration not yet wired
    const searchQuery = typeof input.query === 'string' ? input.query : '';
    const searchCategory = typeof input.intent_category === 'string' ? input.intent_category : undefined;
    return executeWithActionAudit('search_knowledge_base', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      query: searchQuery,
      intent_category: searchCategory ?? null,
      results: [],
      message: 'Knowledge base integration not yet configured. Downstream draft_reply will flag replies as confidence: low.',
    }));
  },

  // ── Social Media Agent skills ────────────────────────────────────────
  draft_post: async (input) => {
    return executeMethodologySkill('draft_post', input, {
      template: {
        brief: '',
        platforms: [],
        brandVoice: '',
        drafts: {},
        sharedNotes: '',
        verifyItems: [],
      },
      guidance: 'Follow the draft_post methodology in your skill context. Produce platform-specific post variants for each requested platform, respecting character limits, hashtag strategies, and brand voice. Flag any claims that need verification with [VERIFY] placeholders.',
    });
  },
  publish_post: async (input, context) => {
    return proposeReviewGatedAction('publish_post', input, context);
  },
  read_analytics: async (input, context) => {
    // Auto-gated stub — platform integrations not yet wired
    const analyticsplatforms = Array.isArray(input.platforms) ? input.platforms : [];
    const dateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const dateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_analytics', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      platforms: analyticsplatforms,
      date_from: dateFrom,
      date_to: dateTo,
      results: [],
      message: 'Social media analytics integration not yet configured. Downstream skills should handle stub status by noting data unavailability.',
    }));
  },

  // ── Ads Management Agent skills ──────────────────────────────────────
  read_campaigns: async (input, context) => {
    // Auto-gated stub — ads platform integrations not yet wired
    const adsPlatform = typeof input.platform === 'string' ? input.platform : '';
    const adsDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const adsDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (adsDateFrom && adsDateTo && new Date(adsDateFrom) > new Date(adsDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_campaigns', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      platform: adsPlatform,
      date_from: adsDateFrom,
      date_to: adsDateTo,
      campaigns: [],
      message: `The ${adsPlatform} integration has not been configured. Downstream skills should handle stub status by noting data unavailability.`,
    }));
  },
  analyse_performance: async (input) => {
    return executeMethodologySkill('analyse_performance', input, {
      template: {
        period: '',
        campaignsAnalysed: 0,
        executiveSummary: '',
        campaigns: [],
        anomalies: [],
        rankedActions: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_performance methodology in your skill context. Analyse the campaign data from read_campaigns, identify underperformers and anomalies, and produce ranked recommendations (pause, reduce_bid, increase_budget, test_copy, monitor).',
    });
  },
  draft_ad_copy: async (input) => {
    return executeMethodologySkill('draft_ad_copy', input, {
      template: {
        campaignName: '',
        platform: '',
        adFormat: '',
        variants: [],
        copyNotes: '',
        verifyItems: [],
      },
      guidance: 'Follow the draft_ad_copy methodology in your skill context. Produce the requested number of meaningfully different ad copy variants within platform character limits. State the test hypothesis for each variant. Use [VERIFY] for unconfirmed claims.',
    });
  },
  update_bid: async (input, context) => {
    return proposeReviewGatedAction('update_bid', input, context);
  },
  update_copy: async (input, context) => {
    return proposeReviewGatedAction('update_copy', input, context);
  },
  pause_campaign: async (input, context) => {
    return proposeReviewGatedAction('pause_campaign', input, context);
  },
  increase_budget: async (input, context) => {
    return proposeReviewGatedAction('increase_budget', input, context);
  },

  // ── Email Outreach Agent skills ──────────────────────────────────────
  enrich_contact: async (input, context) => {
    // Auto-gated stub — enrichment integration not yet wired
    const enrichEmail = typeof input.contact_email === 'string' ? input.contact_email : '';
    return executeWithActionAudit('enrich_contact', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      contact: enrichEmail,
      matched: false,
      fields: {},
      message: 'Data enrichment integration not configured. Downstream draft_sequence should apply generic personalisation.',
    }));
  },
  draft_sequence: async (input) => {
    return executeMethodologySkill('draft_sequence', input, {
      template: {
        contactEmail: '',
        goal: '',
        steps: [],
        draftingNotes: '',
        unresolvedTokens: [],
        verifyItems: [],
      },
      guidance: 'Follow the draft_sequence methodology in your skill context. Produce a multi-step outreach sequence with distinct purpose per step. Use enrichment data for personalisation if available; fall back to generic copy if enrichment is a stub. Flag all [VERIFY] items and unresolved personalisation tokens.',
    });
  },

  // ── Generic methodology handler ──────────────────────────────────────────
  // Used by imported LLM-guided skills. All behaviour comes from the skill's
  // instructions field, which is injected into the agent's context before any
  // tool call. No hardcoded template or guidance strings per skill.
  generic_methodology: async (input) => {
    const skillName = typeof input.skillName === 'string' ? input.skillName : 'unknown';
    return {
      success: true,
      skillName,
      guidance: 'Follow the methodology instructions in your skill context to complete this task.',
    };
  },

  update_crm: async (input, context) => {
    return proposeReviewGatedAction('update_crm', input, context);
  },

  // ── Finance Agent skills ─────────────────────────────────────────────
  read_revenue: async (input, context) => {
    const revDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const revDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (revDateFrom && revDateTo && new Date(revDateFrom) > new Date(revDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_revenue', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      date_from: revDateFrom,
      date_to: revDateTo,
      total_revenue: null,
      message: 'Accounting/billing integration not configured. Downstream analyse_financials will note data unavailability.',
    }));
  },
  read_expenses: async (input, context) => {
    const expDateFrom = typeof input.date_from === 'string' ? input.date_from : '';
    const expDateTo = typeof input.date_to === 'string' ? input.date_to : new Date().toISOString().slice(0, 10);
    if (expDateFrom && expDateTo && new Date(expDateFrom) > new Date(expDateTo)) {
      return { success: false, error: 'validation_error', message: 'date_from must be before date_to' };
    }
    return executeWithActionAudit('read_expenses', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      date_from: expDateFrom,
      date_to: expDateTo,
      total_expenses: null,
      message: 'Accounting integration not configured. Downstream analyse_financials will note data unavailability.',
    }));
  },
  analyse_financials: async (input) => {
    return executeMethodologySkill('analyse_financials', input, {
      template: {
        period: '',
        dataQuality: '',
        executiveSummary: '',
        keyMetrics: {},
        revenueAnalysis: '',
        expenseAnalysis: '',
        anomalies: [],
        recommendations: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_financials methodology in your skill context. Compute key ratios from the revenue and expense data, identify anomalies, and produce ranked recommendations. If either data source is a stub, note unavailability and compute only what is possible.',
    });
  },
  update_financial_record: async (input, context) => {
    return proposeReviewGatedAction('update_financial_record', input, context);
  },

  // ── Strategic Intelligence Agent skills ──────────────────────────────
  generate_competitor_brief: async (input) => {
    return executeMethodologySkill('generate_competitor_brief', input, {
      template: {
        competitor: '',
        researchDate: '',
        executiveSummary: '',
        productAndPricing: {},
        recentDevelopments: [],
        strengths: [],
        weaknesses: [],
        competitiveImplications: '',
        sources: [],
        gaps: [],
      },
      guidance: 'Follow the generate_competitor_brief methodology in your skill context. Use web_search to retrieve current competitor pricing, product info, and recent news. Do not rely on training data for facts that change frequently. Mark unverifiable claims with [VERIFY].',
    });
  },
  synthesise_voc: async (input) => {
    return executeMethodologySkill('synthesise_voc', input, {
      template: {
        sources: [],
        period: '',
        dataPoints: 0,
        executiveSummary: '',
        sentimentBreakdown: {},
        topThemes: [],
        topPraise: [],
        topPainPoints: [],
        featureRequests: [],
        churnSignals: [],
        focusQuestionAnswers: [],
        strategicImplications: [],
        dataCaveats: [],
      },
      guidance: 'Follow the synthesise_voc methodology in your skill context. Extract recurring themes from the VoC data, compute sentiment breakdown, and answer any focus questions explicitly. Do not fabricate quotes — paraphrase only from the actual voc_data input.',
    });
  },

  // ── Content/SEO Agent skills ─────────────────────────────────────────
  draft_content: async (input) => {
    return executeMethodologySkill('draft_content', input, {
      template: {
        contentType: '',
        title: '',
        primaryKeyword: '',
        wordCount: 0,
        body: '',
        draftingNotes: '',
        verifyItems: [],
        todoItems: [],
      },
      guidance: 'Follow the draft_content methodology in your skill context. Produce a structured draft for the requested content type within the target word count. Apply brand voice, include SEO recommendations if a primary keyword is provided, and mark unverifiable claims with [VERIFY].',
    });
  },
  audit_seo: async (input) => {
    return executeMethodologySkill('audit_seo', input, {
      template: {
        page: '',
        targetKeyword: '',
        overallScore: 0,
        summary: '',
        criticalIssues: [],
        highPriority: [],
        mediumPriority: [],
        lowPriority: [],
        quickWins: [],
        notes: '',
      },
      guidance: 'Follow the audit_seo methodology in your skill context. Evaluate the page content against the on-page SEO checklist, score based on findings, and produce a prioritised list of specific recommendations.',
    });
  },

  // ── GEO (Generative Engine Optimisation) skills ─────────────────────
  audit_geo: async (input) => {
    return executeMethodologySkill('audit_geo', input, {
      template: {
        url: '',
        targetKeyword: '',
        geoScore: 0,
        executiveSummary: '',
        dimensionScores: {
          aiCitability: { score: 0, findings: [], recommendations: [] },
          brandAuthority: { score: 0, findings: [], recommendations: [] },
          contentQuality: { score: 0, findings: [], recommendations: [] },
          technicalInfrastructure: { score: 0, findings: [], recommendations: [] },
          structuredData: { score: 0, findings: [], recommendations: [] },
          platformSpecific: { score: 0, findings: [], recommendations: [] },
        },
        priorityRecommendations: [],
        thirtyDayRoadmap: { week1: [], week2to3: [], week4: [] },
        competitiveBenchmark: null,
        notes: '',
      },
      guidance: 'Follow the audit_geo methodology in your skill context. Use fetch_url to retrieve the page, then evaluate all six GEO dimensions. Compute the composite GEO Score as a weighted sum. Produce specific, actionable recommendations ranked by impact.',
    });
  },
  geo_citability: async (input) => {
    return executeMethodologySkill('geo_citability', input, {
      template: {
        url: '',
        citabilityScore: 0,
        passageAnalysis: { total: 0, optimalRange: 0, averageLength: 0 },
        claimDensity: { verifiableClaims: 0, claimsPer200Words: 0 },
        quotableStructures: { definitions: 0, faqPairs: 0, lists: 0, summaries: 0 },
        findings: [],
        recommendations: [],
      },
      guidance: 'Follow the geo_citability methodology. Analyse content for AI citation extractability — focus on passage length (134-167 words optimal), claim density, quotable structures, and semantic clarity.',
    });
  },
  geo_crawlers: async (input) => {
    return executeMethodologySkill('geo_crawlers', input, {
      template: {
        domain: '',
        accessScore: 0,
        crawlerMatrix: [],
        robotsTxtSummary: { found: false, globalBlock: false, aiDirectives: 0 },
        httpHeaders: { xRobotsTag: '', metaRobotsAi: '' },
        llmsTxtPresent: false,
        recommendations: [],
      },
      guidance: 'Follow the geo_crawlers methodology. Use fetch_url to check robots.txt and the target page. Evaluate access for all 14+ AI crawlers listed in the methodology. Report the crawler access matrix.',
    });
  },
  geo_schema: async (input) => {
    return executeMethodologySkill('geo_schema', input, {
      template: {
        url: '',
        pageType: '',
        schemaScore: 0,
        schemasFound: [],
        missingSchemas: [],
        qualityIssues: [],
        recommendations: [],
        jsonLdTemplate: '',
      },
      guidance: 'Follow the geo_schema methodology. Use fetch_url to retrieve the page HTML, extract all JSON-LD blocks, validate structure and coverage against page type expectations, and provide ready-to-use templates for missing schemas.',
    });
  },
  geo_platform_optimizer: async (input) => {
    return executeMethodologySkill('geo_platform_optimizer', input, {
      template: {
        url: '',
        targetKeyword: '',
        overallScore: 0,
        platforms: {
          googleAio: { score: 0, findings: [], topRecommendation: '' },
          chatgpt: { score: 0, findings: [], topRecommendation: '' },
          perplexity: { score: 0, findings: [], topRecommendation: '' },
          gemini: { score: 0, findings: [], topRecommendation: '' },
          bingCopilot: { score: 0, findings: [], topRecommendation: '' },
        },
        crossPlatformRecommendations: [],
      },
      guidance: 'Follow the geo_platform_optimizer methodology. Evaluate the page against each AI search platform\'s specific preferences — content format, source signals, and crawler access. Produce per-platform scores and cross-platform recommendations.',
    });
  },
  geo_brand_authority: async (input) => {
    return executeMethodologySkill('geo_brand_authority', input, {
      template: {
        brandName: '',
        authorityScore: 0,
        entityRecognition: { wikipedia: false, wikidata: '', knowledgePanel: false, otherSources: [] },
        mentionAnalysis: { count: 0, topSources: [], sentiment: '', mostRecent: '' },
        citationProfile: { citationMentions: 0, expertQuotes: 0, originalResearch: 0 },
        authorSignals: { namedAuthors: 0, withCredentials: 0, schemaMarkup: false },
        recommendations: [],
      },
      guidance: 'Follow the geo_brand_authority methodology. Use web_search to research brand presence across Wikipedia, Wikidata, Knowledge Panel, and authoritative publications. Assess entity recognition, mention density, and citation patterns.',
    });
  },
  geo_llmstxt: async (input) => {
    return executeMethodologySkill('geo_llmstxt', input, {
      template: {
        domain: '',
        mode: 'analyse',
        llmsTxtStatus: 'not_found',
        llmsFullTxtStatus: 'not_found',
        score: 0,
        assessment: { structure: '', completeness: '', accuracy: '', length: 0 },
        issues: [],
        recommendedContent: '',
        recommendations: [],
      },
      guidance: 'Follow the geo_llmstxt methodology. Use fetch_url to check for llms.txt and llms-full.txt at the domain root. In analyse mode, evaluate structure and quality. In generate mode, produce a complete recommended llms.txt.',
    });
  },
  geo_compare: async (input) => {
    return executeMethodologySkill('geo_compare', input, {
      template: {
        clientUrl: '',
        competitorUrls: [],
        targetKeyword: '',
        comparisonMatrix: [],
        clientStrengths: [],
        clientGaps: [],
        quickWins: [],
        strategicRecommendations: [],
        notes: '',
      },
      guidance: 'Follow the geo_compare methodology. Use fetch_url to retrieve all pages (client + competitors). Score each across the six comparison dimensions and produce a side-by-side matrix with specific gap analysis and actionable recommendations.',
    });
  },

  create_lead_magnet: async (input, context) => {
    return proposeReviewGatedAction('create_lead_magnet', input, context);
  },

  // ── Client Reporting Agent skills ────────────────────────────────────
  draft_report: async (input) => {
    return executeMethodologySkill('draft_report', input, {
      template: {
        reportType: '',
        clientName: '',
        reportingPeriod: '',
        executiveSummary: [],
        sections: [],
        recommendations: [],
        draftingNotes: '',
        verifyItems: [],
        todoItems: [],
      },
      guidance: 'Follow the draft_report methodology in your skill context. Produce a structured client-facing report from the provided data sections. Lead each section with the key finding, compare to targets where available, and write recommendations specific to this client\'s data.',
    });
  },
  deliver_report: async (input, context) => {
    return proposeReviewGatedAction('deliver_report', input, context);
  },

  // ── Onboarding Agent skills ──────────────────────────────────────────
  configure_integration: async (input, context) => {
    return proposeReviewGatedAction('configure_integration', input, context);
  },

  // ── CRM/Pipeline Agent skills ────────────────────────────────────────
  read_crm: async (input, context) => {
    // Auto-gated stub — CRM integration not yet wired
    const crmQueryType = typeof input.query_type === 'string' ? input.query_type : '';
    return executeWithActionAudit('read_crm', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      query_type: crmQueryType,
      records: [],
      message: 'CRM integration not configured. Downstream analyse_pipeline, detect_churn_risk, and draft_followup should handle stub status by noting data unavailability.',
    }));
  },
  analyse_pipeline: async (input) => {
    return executeMethodologySkill('analyse_pipeline', input, {
      template: {
        period: '',
        dataQuality: '',
        executiveSummary: '',
        keyMetrics: {},
        stageBreakdown: [],
        staleDeals: [],
        rankedActions: [],
        caveats: [],
      },
      guidance: 'Follow the analyse_pipeline methodology in your skill context. Compute pipeline velocity, stage conversion, and stale deal metrics from the CRM data. Identify deals requiring follow-up and produce ranked actions.',
    });
  },
  draft_followup: async (input) => {
    return executeMethodologySkill('draft_followup', input, {
      template: {
        contactEmail: '',
        dealName: '',
        goal: '',
        subject: '',
        body: '',
        draftingNotes: '',
      },
      guidance: 'Follow the draft_followup methodology in your skill context. Draft a short (3–5 sentence) follow-up email referencing the last activity. Match tone to days-since-activity. Include a single, clear CTA matching the follow_up_goal.',
    });
  },
  detect_churn_risk: async (input) => {
    return executeMethodologySkill('detect_churn_risk', input, {
      template: {
        accountsAnalysed: 0,
        atRiskAccounts: [],
        healthyAccounts: [],
        summary: '',
        caveats: [],
      },
      guidance: 'Follow the detect_churn_risk methodology in your skill context. Score each account based on engagement, commercial, and relationship signals. Never assign HIGH or CRITICAL risk without 2+ supporting signals. Produce specific recommended interventions per at-risk account.',
    });
  },

  // ── Knowledge Management Agent skills ────────────────────────────────
  read_docs: async (input, context) => {
    // Auto-gated stub — documentation integration not yet wired
    const docPageId = typeof input.page_id === 'string' ? input.page_id : '';
    const docPageTitle = typeof input.page_title === 'string' ? input.page_title : '';
    return executeWithActionAudit('read_docs', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      page_id: docPageId,
      page_title: docPageTitle,
      content: null,
      message: 'Documentation integration not configured. Connect the documentation system in workspace settings to enable page retrieval.',
    }));
  },
  propose_doc_update: async (input, context) => {
    return proposeReviewGatedAction('propose_doc_update', input, context);
  },
  write_docs: async (input, context) => {
    return proposeReviewGatedAction('write_docs', input, context);
  },

  // ── Phase 2: Workflow orchestration ──────────────────────────────────
  assign_task: async (input, context) => {
    const { executeAssignTask } = await import('../tools/internal/assignTask.js');
    return executeWithActionAudit('assign_task', input, context, () =>
      executeAssignTask(input, { runId: context.runId, organisationId: context.organisationId, subaccountId: context.subaccountId!, agentId: context.agentId }),
    );
  },

  // ── Phase 3: Cross-subaccount intelligence skills ───────────────────
  query_subaccount_cohort: async (input, context) => {
    const { executeQuerySubaccountCohort } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('query_subaccount_cohort', input, context, () =>
      executeQuerySubaccountCohort(input, context));
  },
  read_org_insights: async (input, context) => {
    const { executeReadOrgInsights } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('read_org_insights', input, context, () =>
      executeReadOrgInsights(input, context));
  },
  write_org_insight: async (input, context) => {
    const { executeWriteOrgInsight } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('write_org_insight', input, context, () =>
      executeWriteOrgInsight(input, context));
  },
  compute_health_score: async (input, context) => {
    const { executeComputeHealthScore } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('compute_health_score', input, context, () =>
      executeComputeHealthScore(input, context));
  },
  detect_anomaly: async (input, context) => {
    const { executeDetectAnomaly } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('detect_anomaly', input, context, () =>
      executeDetectAnomaly(input, context));
  },
  compute_churn_risk: async (input, context) => {
    const { executeComputeChurnRisk } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('compute_churn_risk', input, context, () =>
      executeComputeChurnRisk(input, context));
  },
  generate_portfolio_report: async (input, context) => {
    const { executeGeneratePortfolioReport } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('generate_portfolio_report', input, context, () =>
      executeGeneratePortfolioReport(input, context));
  },
  trigger_account_intervention: async (input, context) => {
    return proposeReviewGatedAction('trigger_account_intervention', input, context);
  },

  // ── 42 Macro analysis (custom prompt skill, scoped to Breakout Solutions) ──
  analyse_42macro_transcript: async (input) => {
    return executeMethodologySkill('analyse_42macro_transcript', input, {
      template: {
        filename: 'YYYYMMDD_Report_Name.md',
        tier1Dashboard: '',
        tier2ExecutiveSummary: '',
        tier3FullAnalysis: {
          section1MacroSnapshot: '',
          section2BitcoinAndDigitalAssets: '',
          section3TheBottomLine: '',
        },
      },
      guidance:
        'Follow the 42 Macro A-Player Brain instructions injected into your system prompt. Output the three tiers (Dashboard, Executive Summary, Full Analysis) in plain language. Return the completed markdown content as the value of the tier3FullAnalysis fields and the rendered filename. The agent will pass the result to send_to_slack.',
    });
  },

  // ── Reporting Agent paywall workflow skills ───────────────────────────
  // Spec: docs/reporting-agent-paywall-workflow-spec.md §4 / Code Change B
  transcribe_audio: async (input, context) => {
    const { transcribeAudio } = await import('./transcribeAudioService.js');
    return transcribeAudio(
      input as Parameters<typeof transcribeAudio>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },
  // Spec: docs/reporting-agent-paywall-workflow-spec.md §6 / Code Change D
  fetch_paywalled_content: async (input, context) => {
    const { fetchPaywalledContent } = await import('./fetchPaywalledContentService.js');
    return fetchPaywalledContent(
      input as unknown as Parameters<typeof fetchPaywalledContent>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },
  // Spec: docs/reporting-agent-paywall-workflow-spec.md §5 / Code Change C
  send_to_slack: async (input, context) => {
    const { sendToSlack } = await import('./sendToSlackService.js');
    return sendToSlack(
      input as unknown as Parameters<typeof sendToSlack>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },

  // ── Sprint 5 P4.1: Clarification escape hatch ──────────────────
  ask_clarifying_question: async (input, context) => {
    const { executeAskClarifyingQuestion } = await import('../tools/internal/askClarifyingQuestion.js');
    return executeAskClarifyingQuestion(input, {
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? undefined,
    });
  },

  // ── Phase 2 S8: Real-time clarification routing ──────────────────
  request_clarification: async (input, context) => {
    const { executeRequestClarification } = await import('../tools/internal/requestClarification.js');
    return executeRequestClarification(input, {
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? null,
      agentId: context.agentId,
      stepId: (context as { stepId?: string | null }).stepId ?? null,
    });
  },

  // ── Phase 3 S19: Weekly Digest Gather ────────────────────────────
  weekly_digest_gather: async (input) => {
    const { executeWeeklyDigestGather } = await import('../tools/internal/weeklyDigestGather.js');
    return executeWeeklyDigestGather(input);
  },

  // Action-call alias used by the playbook runner (see weekly-digest.playbook.ts)
  config_weekly_digest_gather: async (input) => {
    const { executeWeeklyDigestGather } = await import('../tools/internal/weeklyDigestGather.js');
    return executeWeeklyDigestGather(input);
  },

  // ── Phase 3 S22: Deliver playbook output via deliveryService ─────
  config_deliver_playbook_output: async (input, context) => {
    const { deliveryService } = await import('./deliveryService.js');
    const {
      subaccountId,
      organisationId,
      artefactTitle,
      artefactContent,
      deliveryChannels,
    } = input as Record<string, unknown>;

    if (!subaccountId || !organisationId || !artefactTitle || !artefactContent) {
      return { success: false, error: 'subaccountId, organisationId, artefactTitle, artefactContent required' };
    }

    const config =
      (deliveryChannels as { email?: boolean; portal?: boolean; slack?: boolean } | undefined) ??
      { email: true, portal: true, slack: false };

    const result = await deliveryService.deliver(
      {
        title: String(artefactTitle),
        content: String(artefactContent),
        createdByAgentId: context.agentId,
      },
      {
        email: Boolean(config.email ?? true),
        portal: Boolean(config.portal ?? true),
        slack: Boolean(config.slack ?? false),
      },
      String(subaccountId),
      String(organisationId),
    );

    return {
      success: true,
      taskId: result.taskId,
      channels: result.channels,
    };
  },

  // ── Sprint 5 P4.2: Memory block write path ─────────────────────
  update_memory_block: async (input, context) => {
    const { updateBlock } = await import('./memoryBlockService.js');
    const blockName = (input as Record<string, unknown>).block_name as string;
    const newContent = (input as Record<string, unknown>).new_content as string;
    if (!blockName || !newContent) {
      return { success: false, error: 'block_name and new_content are required' };
    }
    return updateBlock(blockName, newContent, context.agentId, context.organisationId);
  },

  // ── Configuration Assistant skill handlers ────────────────────
  // Mutation tools (review-gated via action registry)
  config_create_agent: async (input, context) => {
    const { executeConfigCreateAgent } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_agent', input, context, () => executeConfigCreateAgent(input, context));
  },
  config_update_agent: async (input, context) => {
    const { executeConfigUpdateAgent } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_agent', input, context, () => executeConfigUpdateAgent(input, context));
  },
  config_activate_agent: async (input, context) => {
    const { executeConfigActivateAgent } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_activate_agent', input, context, () => executeConfigActivateAgent(input, context));
  },
  config_link_agent: async (input, context) => {
    const { executeConfigLinkAgent } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_link_agent', input, context, () => executeConfigLinkAgent(input, context));
  },
  config_update_link: async (input, context) => {
    const { executeConfigUpdateLink } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_link', input, context, () => executeConfigUpdateLink(input, context));
  },
  config_set_link_skills: async (input, context) => {
    const { executeConfigSetLinkSkills } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_skills', input, context, () => executeConfigSetLinkSkills(input, context));
  },
  config_set_link_instructions: async (input, context) => {
    const { executeConfigSetLinkInstructions } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_instructions', input, context, () => executeConfigSetLinkInstructions(input, context));
  },
  config_set_link_schedule: async (input, context) => {
    const { executeConfigSetLinkSchedule } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_schedule', input, context, () => executeConfigSetLinkSchedule(input, context));
  },
  config_set_link_limits: async (input, context) => {
    const { executeConfigSetLinkLimits } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_limits', input, context, () => executeConfigSetLinkLimits(input, context));
  },
  config_create_subaccount: async (input, context) => {
    const { executeConfigCreateSubaccount } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_subaccount', input, context, () => executeConfigCreateSubaccount(input, context));
  },
  config_create_scheduled_task: async (input, context) => {
    const { executeConfigCreateScheduledTask } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_scheduled_task', input, context, () => executeConfigCreateScheduledTask(input, context));
  },
  config_update_scheduled_task: async (input, context) => {
    const { executeConfigUpdateScheduledTask } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_scheduled_task', input, context, () => executeConfigUpdateScheduledTask(input, context));
  },
  config_attach_data_source: async (input, context) => {
    const { executeConfigAttachDataSource } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_attach_data_source', input, context, () => executeConfigAttachDataSource(input, context));
  },
  config_update_data_source: async (input, context) => {
    const { executeConfigUpdateDataSource } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_data_source', input, context, () => executeConfigUpdateDataSource(input, context));
  },
  config_remove_data_source: async (input, context) => {
    const { executeConfigRemoveDataSource } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_remove_data_source', input, context, () => executeConfigRemoveDataSource(input, context));
  },
  config_restore_version: async (input, context) => {
    const { executeConfigRestoreVersion } = await import('../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_restore_version', input, context, () => executeConfigRestoreVersion(input, context));
  },

  // Capability discovery (Orchestrator routing spec §4) — read-only, no action audit needed
  list_platform_capabilities: async (input, context) => {
    const { executeListPlatformCapabilities } = await import('../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeListPlatformCapabilities(input, context);
  },
  list_connections: async (input, context) => {
    const { executeListConnections } = await import('../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeListConnections(input, context);
  },
  check_capability_gap: async (input, context) => {
    const { executeCheckCapabilityGap } = await import('../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeCheckCapabilityGap(input, context);
  },
  request_feature: async (input, context) => {
    const { executeRequestFeature } = await import('../tools/capabilities/requestFeatureHandler.js');
    return executeRequestFeature(input, context);
  },

  // Read-only config tools (no action audit needed)
  config_list_agents: async (input, context) => {
    const { executeConfigListAgents } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListAgents(input, context);
  },
  config_list_subaccounts: async (input, context) => {
    const { executeConfigListSubaccounts } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListSubaccounts(input, context);
  },
  config_list_links: async (input, context) => {
    const { executeConfigListLinks } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListLinks(input, context);
  },
  config_list_scheduled_tasks: async (input, context) => {
    const { executeConfigListScheduledTasks } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListScheduledTasks(input, context);
  },
  config_list_data_sources: async (input, context) => {
    const { executeConfigListDataSources } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListDataSources(input, context);
  },
  config_list_system_skills: async (input, context) => {
    const { executeConfigListSystemSkills } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListSystemSkills(input, context);
  },
  config_list_org_skills: async (input, context) => {
    const { executeConfigListOrgSkills } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigListOrgSkills(input, context);
  },
  config_get_agent_detail: async (input, context) => {
    const { executeConfigGetAgentDetail } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigGetAgentDetail(input, context);
  },
  config_get_link_detail: async (input, context) => {
    const { executeConfigGetLinkDetail } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigGetLinkDetail(input, context);
  },

  // Validation and history tools
  config_run_health_check: async (input, context) => {
    const { executeConfigRunHealthCheck } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigRunHealthCheck(input, context);
  },
  config_preview_plan: async (input, context) => {
    const { executeConfigPreviewPlan } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigPreviewPlan(input, context);
  },
  config_view_history: async (input, context) => {
    const { executeConfigViewHistory } = await import('../tools/config/configSkillHandlers.js');
    return executeConfigViewHistory(input, context);
  },

  // Phase G — portal / email skills (spec §11.6) — action_call only.
  config_publish_playbook_output_to_portal: async (input, context) => {
    const { executeConfigPublishPlaybookOutputToPortal } = await import('../tools/config/playbookSkillHandlers.js');
    return executeWithActionAudit('config_publish_playbook_output_to_portal', input, context, () => executeConfigPublishPlaybookOutputToPortal(input, context));
  },
  config_send_playbook_email_digest: async (input, context) => {
    const { executeConfigSendPlaybookEmailDigest } = await import('../tools/config/playbookSkillHandlers.js');
    return executeWithActionAudit('config_send_playbook_email_digest', input, context, () => executeConfigSendPlaybookEmailDigest(input, context));
  },

  // Onboarding smart-skip — scrapes website to pre-fill brand/audience signals.
  // Implementation pending; returns a not-yet-available error so onboarding
  // falls back to asking the question directly.
  smart_skip_from_website: async (_input, _context) => {
    return { success: false, error: 'smart_skip_from_website is not yet implemented' };
  },
};

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context, toolCallId } = params;
    // Stash the current tool call id on the context so the per-case
    // action wrappers below can build the same deterministic idempotency
    // key that proposeActionMiddleware wrote for this call (Sprint 2 P1.1
    // Layer 3). Mutation is safe — the context is scoped to one run and
    // one tool call at a time.
    if (toolCallId !== undefined) {
      context.toolCallId = toolCallId;
    }

    // MCP tool dispatch — tool slugs start with "mcp."
    if (skillName.startsWith('mcp.') && context._mcpClients) {
      const { mcpClientManager } = await import('./mcpClientManager.js');
      return mcpClientManager.callTool(
        context._mcpClients,
        context._mcpLazyRegistry ?? new Map(),
        skillName,
        input,
        {
          runId: context.runId,
          organisationId: context.organisationId,
          agentId: context.agentId,
          subaccountId: context.subaccountId,
          isTestRun: context.isTestRun ?? false,
          taskId: context.taskId,
          mcpCallCount: context.mcpCallCount,
        },
      );
    }

    const handler = SKILL_HANDLERS[skillName];
    if (!handler) {
      return { success: false, error: `Unknown skill: ${skillName}` };
    }
    return handler(input, context);
  },
};


// ---------------------------------------------------------------------------
// Action-gated execution helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an auto-gated internal skill: creates an action record for auditability,
 * executes synchronously, and records the result.
 *
 * If the policy engine has escalated this skill to review (returns pending_approval),
 * we fall through to the review-gate path so the agent still gets a proper result.
 */
async function executeWithActionAudit(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  executor: () => Promise<unknown>
): Promise<unknown> {
  // Sprint 2 P1.1 Layer 3: when a toolCallId is on the context, build a
  // deterministic key that matches the one proposeActionMiddleware already
  // wrote for this call. proposeAction() short-circuits on the existing
  // row (isNew === false) and the wrapper moves on to execution. Legacy
  // callers without a toolCallId fall back to the old timestamp key.
  const idempotencyKey = context.toolCallId
    ? buildActionIdempotencyKey({
        runId: context.runId,
        toolCallId: context.toolCallId,
        args: input,
      })
    : `${actionType}:${context.runId}:${Date.now()}`;
  const pipelineSpan = createSpan('skill.pipeline.run', { skillName: actionType, gateLevel: 'auto' }, { input });

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      taskId: context.taskId,
    });

    createEvent('skill.action.proposed', {
      skillName: actionType, actionId: proposed.actionId, status: proposed.status,
    }, { parentSpan: pipelineSpan });

    // Duplicate detected — return existing status
    if (!proposed.isNew) {
      const dupeResult = { success: true, action_id: proposed.actionId, status: proposed.status, message: 'Duplicate action detected' };
      pipelineSpan.end({ output: dupeResult });
      return dupeResult;
    }

    // Policy engine escalated to block — return denial immediately
    if (proposed.status === 'blocked') {
      createEvent('skill.gate.decision', {
        gateLevel: 'block', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const denial = buildDenialMessage(actionType, 'This action is blocked by policy for this account.');
      pipelineSpan.end({ output: denial });
      return denial;
    }

    // Policy engine escalated to review — block and await human decision
    if (proposed.status === 'pending_approval') {
      createEvent('skill.gate.decision', {
        gateLevel: 'review', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const action = await actionService.getAction(proposed.actionId, context.organisationId);
      await reviewService.createReviewItem(action, {
        actionType,
        reasoning: input.metadata ? String((input.metadata as Record<string, unknown>).reasoning ?? '') : undefined,
        proposedPayload: input,
      });
      const reviewResult = await awaitReviewDecision(proposed.actionId, actionType, context);
      pipelineSpan.end({ output: reviewResult });
      return reviewResult;
    }

    createEvent('skill.gate.decision', {
      gateLevel: 'auto', skillName: actionType, actionId: proposed.actionId,
    }, { parentSpan: pipelineSpan });

    // Auto-approved — execute inline with processor pipeline
    const locked = await actionService.lockForExecution(proposed.actionId, context.organisationId);
    if (!locked) {
      pipelineSpan.end({ output: { success: false, error: 'Failed to acquire execution lock' } });
      return { success: false, error: 'Failed to acquire execution lock' };
    }

    const executeSpan = createSpan('skill.phase.execute', { skillName: actionType }, { parentSpan: pipelineSpan });
    const result = await runWithProcessors(
      actionType,
      input,
      context,
      (_processedInput) => executor(),
      proposed.actionId,
    );
    executeSpan.end({ output: result });

    const resultObj = result as Record<string, unknown>;
    if (resultObj?.success) {
      await actionService.markCompleted(proposed.actionId, context.organisationId, result);
    } else {
      await actionService.markFailed(proposed.actionId, context.organisationId, String(resultObj?.error ?? 'Unknown error'));
    }

    pipelineSpan.end({ output: result });
    return result;
  } catch (err) {
    if (err instanceof TripWire && !err.options.retry) {
      createEvent('skill.tripwire.triggered', {
        skillName: actionType, fatal: true, reason: err.reason, code: err.options.code,
      }, { parentSpan: pipelineSpan, level: 'ERROR' });
      pipelineSpan.end({ output: { success: false, error: err.reason } });
      return { success: false, error: `Action halted: ${err.reason}`, code: err.options.code };
    }
    createEvent('skill.action.failed', {
      skillName: actionType, error: String(err).slice(0, 200),
    }, { parentSpan: pipelineSpan, level: 'ERROR' });
    console.error(`[ActionAudit] Failed to track ${actionType}, executing directly:`, err);
    pipelineSpan.end({ output: { error: String(err) } });
    return executor();
  }
}

/**
 * Proposes a review-gated action and BLOCKS until a human decides.
 *
 * Returns:
 *   - On approval: the execution result from the adapter (via hitlService)
 *   - On rejection/timeout: a structured denial observation (not an exception)
 *
 * The agent receives this as a normal tool call result and continues its loop.
 */
async function proposeReviewGatedAction(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const definition = getActionDefinition(actionType);
  if (!definition) {
    return { success: false, error: `Unknown action type: ${actionType}` };
  }

  const pipelineSpan = createSpan('skill.pipeline.run', { skillName: actionType, gateLevel: 'review' }, { input });

  // Sprint 2 P1.1 Layer 3: deterministic key matches the middleware's so
  // both paths resolve to the same action row. Legacy fallback preserves
  // the old per-field key for callers that still lack a toolCallId.
  let idempotencyKey: string;
  if (context.toolCallId) {
    idempotencyKey = buildActionIdempotencyKey({
      runId: context.runId,
      toolCallId: context.toolCallId,
      args: input,
    });
  } else {
    const keyParts = [actionType, context.subaccountId ?? `org:${context.organisationId}`];
    if (input.thread_id) keyParts.push(String(input.thread_id));
    if (input.record_id) keyParts.push(String(input.record_id));
    keyParts.push(String(Date.now()));
    idempotencyKey = keyParts.join(':');
  }

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      metadata: input.metadata as Record<string, unknown> | undefined,
      taskId: context.taskId,
    });

    createEvent('skill.action.proposed', {
      skillName: actionType, actionId: proposed.actionId, status: proposed.status,
    }, { parentSpan: pipelineSpan });

    // Duplicate — return its current status
    if (!proposed.isNew) {
      const result = { success: true, action_id: proposed.actionId, status: proposed.status, message: 'Action already exists (duplicate detected)' };
      pipelineSpan.end({ output: result });
      return result;
    }

    // Policy engine blocked it — return denial immediately, no review queue entry
    if (proposed.status === 'blocked') {
      createEvent('skill.gate.decision', {
        gateLevel: 'block', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const denial = buildDenialMessage(actionType, 'This action is blocked by policy for this account.');
      pipelineSpan.end({ output: denial });
      return denial;
    }

    // Policy engine auto-approved it — should not happen for review-gated skills,
    // but handle it gracefully by dispatching immediately
    if (proposed.status === 'approved') {
      createEvent('skill.gate.decision', {
        gateLevel: 'auto', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      await executionLayerService.executeAction(proposed.actionId, context.organisationId);
      const result = { success: true, action_id: proposed.actionId, status: 'completed', message: 'Action auto-approved and executed.' };
      pipelineSpan.end({ output: result });
      return result;
    }

    createEvent('skill.gate.decision', {
      gateLevel: 'review', skillName: actionType, actionId: proposed.actionId,
    }, { parentSpan: pipelineSpan });

    // pending_approval — create review item, then block until decision
    const action = await actionService.getAction(proposed.actionId, context.organisationId);
    await reviewService.createReviewItem(action, {
      actionType,
      reasoning: input.metadata ? String((input.metadata as Record<string, unknown>).reasoning ?? '') : undefined,
      proposedPayload: input,
    });

    const reviewStartTime = Date.now();
    const reviewSpan = createSpan('skill.review.wait', {
      skillName: actionType, actionId: proposed.actionId, criticalPath: true,
    }, { parentSpan: pipelineSpan });

    const reviewResult = await awaitReviewDecision(proposed.actionId, actionType, context);

    reviewSpan.end({
      output: {
        approved: !!(reviewResult && typeof reviewResult === 'object' && (reviewResult as Record<string, unknown>).success),
        waitDurationMs: Date.now() - reviewStartTime,
      },
    });
    pipelineSpan.end({ output: reviewResult });
    return reviewResult;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    createEvent('skill.action.failed', {
      skillName: actionType, error: errMsg.slice(0, 200),
    }, { parentSpan: pipelineSpan, level: 'ERROR' });
    pipelineSpan.end({ output: { success: false, error: errMsg } });
    return { success: false, error: `Failed to propose ${actionType}: ${errMsg}` };
  }
}

/**
 * Shared await logic: blocks until hitlService resolves the decision,
 * then returns the execution result or a denial observation.
 */
async function awaitReviewDecision(
  actionId: string,
  actionType: string,
  context: SkillExecutionContext
): Promise<unknown> {
  const decision = await hitlService.awaitDecision(actionId, HITL_REVIEW_TIMEOUT_MS);

  if (!decision.approved) {
    return buildDenialMessage(actionType, decision.comment ?? 'No reason provided');
  }

  // Return the execution result that reviewService ran via executionLayerService
  return {
    success: true,
    action_id: actionId,
    status: 'completed',
    result: decision.result,
    edited: decision.editedArgs ? true : undefined,
  };
}

/**
 * Builds a structured denial observation that the agent receives as a tool result.
 * The agent continues its loop — this is never thrown as an exception.
 * Pattern from n8n: inject the denial as a tool output, not an error.
 */
function buildDenialMessage(actionType: string, comment: string): Record<string, unknown> {
  return {
    success: false,
    status: 'denied',
    action_type: actionType,
    message: `Action '${actionType}' was not approved. Reason: ${comment}`,
    instruction: 'Do not retry this action automatically. Inform the user or adjust your approach based on the feedback.',
  };
}

// ---------------------------------------------------------------------------
// Web Search (Tavily)
// ---------------------------------------------------------------------------

async function executeWebSearch(input: Record<string, unknown>, context: SkillExecutionContext): Promise<unknown> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Web search is not configured (TAVILY_API_KEY not set)' };
  }

  const query = String(input.query ?? '');
  const maxResults = Math.min(Number(input.max_results ?? 5), 10);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { success: false, error: `Search API error: ${errorText}` };
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    // Per-subaccount Tavily usage logging for billing
    logSearchUsage(context.subaccountId, context.organisationId, context.runId).catch((err) => console.error('[SkillExecutor] Failed to log search usage:', err));

    return {
      success: true,
      answer: data.answer ?? null,
      results: (data.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        relevance_score: r.score,
      })),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

function logSearchUsage(subaccountId: string | null, organisationId: string, runId: string): Promise<void> {
  // Structured usage log for per-subaccount Tavily billing tracking.
  // Log aggregation (e.g. Datadog, CloudWatch) captures this for billing.
  console.log(JSON.stringify({
    event: 'platform_usage',
    service: 'tavily_search',
    calls: 1,
    subaccountId,
    organisationId,
    runId,
    timestamp: new Date().toISOString(),
  }));
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Read Workspace
// ---------------------------------------------------------------------------

async function executeReadWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const limit = Math.min(Number(input.limit ?? 20), 50);
  const includeActivities = Boolean(input.include_activities);

  try {
    // Single-task lookup by ID
    if (input.task_id) {
      const task = await taskService.getTask(String(input.task_id), context.organisationId);
      return { success: true, item: serializeTask(task), total: 1 };
    }

    // Subtask listing by parent
    if (input.parent_task_id) {
      const parentId = String(input.parent_task_id);
      const allItems = await taskService.listTasks(context.organisationId, context.subaccountId!, {});
      const subtasks = allItems.filter(t => (t as { parentTaskId?: string | null }).parentTaskId === parentId);
      return {
        success: true,
        items: subtasks.map(serializeTask),
        total: subtasks.length,
        allDone: subtasks.length > 0 && subtasks.every(t => t.status === 'done'),
        anyBlocked: subtasks.some(t => t.status === 'blocked'),
      };
    }

    // Standard filtered listing
    const filters: { status?: string; assignedAgentId?: string } = {};
    if (input.status) filters.status = String(input.status);
    if (input.assigned_to_me) filters.assignedAgentId = context.agentId;

    const items = await taskService.listTasks(context.organisationId, context.subaccountId!, filters);
    const sliced = items.slice(0, limit);

    if (includeActivities) {
      const enriched = await Promise.all(sliced.map(async (item) => {
        const activities = await taskService.listActivities(item.id, context.organisationId);
        return {
          ...serializeTask(item),
          activities: activities.slice(0, 5).map(a => ({
            type: a.activityType,
            message: a.message,
            createdAt: a.createdAt,
          })),
        };
      }));
      return { success: true, items: enriched, total: items.length };
    }

    return { success: true, items: sliced.map(serializeTask), total: items.length };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read board: ${errMsg}` };
  }
}

function serializeTask(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    brief: item.brief,
    status: item.status,
    priority: item.priority,
    isSubTask: (item as { isSubTask?: boolean }).isSubTask ?? false,
    parentTaskId: (item as { parentTaskId?: string | null }).parentTaskId ?? null,
    assignedAgent: item.assignedAgent,
    createdAt: item.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Write Workspace (add activity)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// write_spec — post-approval executor
// Writes the approved spec to workspace memory and marks the task spec-approved.
// ---------------------------------------------------------------------------

async function executeWriteSpecApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(payload.task_id ?? '');
  const specContent = String(payload.spec_content ?? '');
  const reasoning = String(payload.reasoning ?? '');
  const storiesCount = Number(payload.user_stories_count ?? 0);
  const acCount = Number(payload.ac_count ?? 0);

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!specContent) return { success: false, error: 'spec_content is required' };

  // Build a stable spec reference ID so QA / Dev can retrieve this spec by key.
  // Pattern: SPEC-<taskId>-v<N> — we derive N from activity count to ensure
  // monotonically increasing version without a dedicated DB column.
  let version = 1;
  try {
    const existing = await taskService.listActivities(taskId, context.organisationId);
    const priorSpecs = existing.filter((a: { activityType: string; message: string }) =>
      a.activityType === 'note' && a.message.startsWith('SPEC_APPROVED:')
    );
    version = priorSpecs.length + 1;
  } catch { /* treat as first version */ }

  const specReferenceId = `SPEC-${taskId}-v${version}`;

  try {
    // 1. Write the spec to workspace memory as a structured activity.
    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'note',
      message: `SPEC_APPROVED:${specReferenceId}\n\n${specContent}`,
      agentId: context.agentId,
    });

    // 2. Write a human-readable summary activity for the board.
    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'completed',
      message: `Requirements spec approved.\nReference: ${specReferenceId}\nStories: ${storiesCount} | ACs: ${acCount}\nReasoning: ${reasoning}`,
      agentId: context.agentId,
    });

    // 3. Advance task status to spec-approved.
    await taskService.updateTask(taskId, context.organisationId, { status: 'spec-approved' });

    return {
      success: true,
      spec_reference_id: specReferenceId,
      task_id: taskId,
      message: `Spec ${specReferenceId} approved and written to workspace memory. Task status updated to spec-approved.`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to persist approved spec: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// executePublishPostApproved — MVP stub for the publish_post worker handler.
// Platform API integrations are not yet wired. Logs the intended publish action
// and returns pending_integration status.
// ---------------------------------------------------------------------------

async function executePublishPostApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const platform = String(payload.platform ?? '');
  const postContent = String(payload.post_content ?? '');
  const scheduleAt = payload.schedule_at ? String(payload.schedule_at) : null;
  const campaignTag = payload.campaign_tag ? String(payload.campaign_tag) : null;
  const reasoning = String(payload.reasoning ?? '');

  if (!platform) return { success: false, error: 'platform is required' };
  if (!postContent) return { success: false, error: 'post_content is required' };

  // Log publish action to workspace memory if a taskId is available
  if (context.taskId) {
    try {
      const logMsg = [
        `PUBLISH_POST_APPROVED:${platform}`,
        `campaign: ${campaignTag ?? 'none'}`,
        scheduleAt ? `scheduled: ${scheduleAt}` : 'publish: immediate',
        `reasoning: ${reasoning}`,
        `---\n${postContent}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal — log failure does not block publish response */ }
  }

  return {
    success: true,
    platform,
    publish_status: 'pending_integration',
    scheduled_for: scheduleAt,
    campaign_tag: campaignTag,
    message: `Publish approved for ${platform}. Platform integration not yet connected — action logged. When integration is live, this will ${scheduleAt ? `schedule the post for ${scheduleAt}` : 'publish immediately'}.`,
  };
}

// ---------------------------------------------------------------------------
// executeAdsActionApproved — MVP stub for ads platform write actions.
// Platform APIs are not yet connected. Logs intended action and returns
// pending_integration status. Handles: update_bid, update_copy,
// pause_campaign, increase_budget.
// ---------------------------------------------------------------------------

async function executeAdsActionApproved(
  actionType: string,
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const platform = String(payload.platform ?? '');
  const campaignId = String(payload.campaign_id ?? '');
  const campaignName = String(payload.campaign_name ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!platform) return { success: false, error: 'platform is required' };
  if (!campaignId) return { success: false, error: 'campaign_id is required' };

  if (context.taskId) {
    try {
      const logMsg = [
        `ADS_ACTION_APPROVED:${actionType}`,
        `platform: ${platform}`,
        `campaign_id: ${campaignId}`,
        `campaign: ${campaignName}`,
        `reasoning: ${reasoning}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    action_type: actionType,
    platform,
    campaign_id: campaignId,
    status: 'pending_integration',
    message: `${actionType} approved for campaign ${campaignName} on ${platform}. Platform integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeCrmUpdateApproved — MVP stub for update_crm worker handler.
// CRM write APIs not yet connected. Logs intended field changes.
// ---------------------------------------------------------------------------

async function executeCrmUpdateApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const recordType = String(payload.record_type ?? '');
  const recordId = String(payload.record_id ?? '');
  const recordIdentifier = String(payload.record_identifier ?? '');
  const updates = payload.updates as Record<string, unknown> ?? {};
  const reasoning = String(payload.reasoning ?? '');

  if (!recordType) return { success: false, error: 'record_type is required' };
  if (!recordId) return { success: false, error: 'record_id is required' };

  if (context.taskId) {
    try {
      const fieldsUpdated = Object.keys(updates).join(', ');
      const logMsg = [
        `CRM_UPDATE_APPROVED:${recordType}:${recordId}`,
        `identifier: ${recordIdentifier}`,
        `fields: ${fieldsUpdated}`,
        `reasoning: ${reasoning}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    record_type: recordType,
    record_id: recordId,
    fields_updated: Object.keys(updates),
    status: 'pending_integration',
    message: `CRM update approved for ${recordType} ${recordIdentifier}. Integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeFinancialRecordUpdateApproved — MVP stub for update_financial_record.
// ---------------------------------------------------------------------------

async function executeFinancialRecordUpdateApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const recordType = String(payload.record_type ?? '');
  const recordDescription = String(payload.record_description ?? '');
  const updates = payload.updates as Record<string, unknown> ?? {};
  const reasoning = String(payload.reasoning ?? '');

  if (!recordType) return { success: false, error: 'record_type is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: [
          `FINANCIAL_RECORD_UPDATE_APPROVED:${recordType}`,
          `description: ${recordDescription}`,
          `fields: ${Object.keys(updates).join(', ')}`,
          `reasoning: ${reasoning}`,
        ].join('\n'),
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    record_type: recordType,
    fields_written: Object.keys(updates),
    status: 'pending_integration',
    message: `Financial record update approved (${recordType}: ${recordDescription}). Accounting integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeLeadMagnetApproved — MVP stub for create_lead_magnet worker handler.
// ---------------------------------------------------------------------------

async function executeLeadMagnetApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const assetType = String(payload.asset_type ?? '');
  const topic = String(payload.topic ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!assetType) return { success: false, error: 'asset_type is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `LEAD_MAGNET_APPROVED:${assetType}\ntopic: ${topic}\nreasoning: ${reasoning}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    asset_type: assetType,
    topic,
    status: 'approved',
    message: `Lead magnet approved (${assetType}: ${topic}). Attach to task deliverables via add_deliverable.`,
  };
}

// ---------------------------------------------------------------------------
// executeDeliverReportApproved — MVP stub for deliver_report worker handler.
// ---------------------------------------------------------------------------

async function executeDeliverReportApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const reportTitle = String(payload.report_title ?? '');
  const clientName = String(payload.client_name ?? '');
  const clientEmail = String(payload.client_email ?? '');
  const deliveryChannel = String(payload.delivery_channel ?? 'email');
  const reportingPeriod = payload.reporting_period ? String(payload.reporting_period) : null;

  if (!reportTitle) return { success: false, error: 'report_title is required' };
  if (!clientEmail) return { success: false, error: 'client_email is required' };

  const deliveredAt = new Date().toISOString();

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: [
          `REPORT_DELIVERED:${reportTitle}`,
          `client: ${clientName} <${clientEmail}>`,
          `channel: ${deliveryChannel}`,
          reportingPeriod ? `period: ${reportingPeriod}` : '',
          `delivered_at: ${deliveredAt}`,
        ].filter(Boolean).join('\n'),
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    client_name: clientName,
    delivery_channel: deliveryChannel,
    delivered_at: deliveredAt,
    status: 'pending_integration',
    message: `Report delivery approved for ${clientName} via ${deliveryChannel}. Delivery integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeConfigureIntegrationApproved — MVP stub for configure_integration.
// ---------------------------------------------------------------------------

/** Redact fields whose keys match common credential patterns before storage. */
const SENSITIVE_KEY_PATTERN = /(^|_)(key|secret|token|password|credential|auth|bearer)|api_key|client_secret|access_token|refresh_token/i;

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function executeConfigureIntegrationApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const integrationType = String(payload.integration_type ?? '');
  const providerName = String(payload.provider_name ?? '');
  const reasoning = String(payload.reasoning ?? '');
  const configuration = (payload.configuration as Record<string, unknown>) ?? {};

  if (!integrationType) return { success: false, error: 'integration_type is required' };
  if (!providerName) return { success: false, error: 'provider_name is required' };

  // Redact sensitive fields before any storage
  const redactedConfig = redactSensitiveFields(configuration);

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `INTEGRATION_APPROVED:${integrationType}:${providerName}\nreasoning: ${reasoning}\nconfig: ${JSON.stringify(redactedConfig)}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    integration_type: integrationType,
    provider_name: providerName,
    configuration: redactedConfig,
    status: 'pending_integration',
    message: `Integration configuration approved (${integrationType}: ${providerName}). Integration storage not yet connected — configuration logged with credentials redacted.`,
  };
}

// ---------------------------------------------------------------------------
// executeDocProposalApproved — signals approval of propose_doc_update.
// The actual write is performed by a subsequent write_docs call.
// ---------------------------------------------------------------------------

async function executeDocProposalApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageTitle = String(payload.page_title ?? '');
  const changeType = String(payload.change_type ?? '');
  const changesCount = Array.isArray(payload.proposed_changes) ? payload.proposed_changes.length : 0;

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `DOC_PROPOSAL_APPROVED:${pageTitle}\nchange_type: ${changeType}\nchanges: ${changesCount}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    page_title: pageTitle,
    changes_approved: changesCount,
    message: `Doc update proposal approved for "${pageTitle}". Invoke write_docs with the full updated content to apply the changes.`,
  };
}

// ---------------------------------------------------------------------------
// executeWriteDocsApproved — MVP stub for write_docs worker handler.
// ---------------------------------------------------------------------------

async function executeWriteDocsApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageTitle = String(payload.page_title ?? '');
  const changeSummary = String(payload.change_summary ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!pageTitle) return { success: false, error: 'page_title is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `DOCS_WRITE_APPROVED:${pageTitle}\nchange_summary: ${changeSummary}\nreasoning: ${reasoning}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    page_title: pageTitle,
    status: 'pending_integration',
    message: `Documentation write approved for "${pageTitle}". Documentation integration not yet connected — update logged.`,
  };
}

// ---------------------------------------------------------------------------

async function executeWriteWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const activityType = String(input.activity_type ?? 'progress') as 'progress' | 'note' | 'completed' | 'blocked';
  const message = String(input.message ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!message) return { success: false, error: 'message is required' };

  try {
    const activity = await taskService.addActivity(taskId, context.organisationId, {
      activityType,
      message,
      agentId: context.agentId,
    });

    return { success: true, activity_id: activity.id, _updated_task: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write to board: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Trigger Task
// ---------------------------------------------------------------------------

async function executeTriggerProcess(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const processId = String(input.process_id ?? '');
  const inputData = String(input.input_data ?? '{}');
  const reason = String(input.reason ?? '');
  const configOverridesStr = String(input.config_overrides ?? '{}');

  if (!processId) return { success: false, error: 'process_id is required' };

  let configOverrides: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(configOverridesStr);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      configOverrides = parsed;
    }
  } catch { /* ignore parse errors */ }

  try {
    const result = await executeTriggerredProcess(
      context.organisationId,
      processId,
      context.agentId,
      inputData,
      {
        subaccountId: context.subaccountId ?? undefined,
        triggerType: 'agent',
        triggerSourceId: context.runId,
        configOverrides,
      }
    );

    return {
      success: true,
      execution_id: result.executionId,
      process_name: result.processName,
      status: result.status,
      message: `Process "${result.processName}" has been queued. Execution ID: ${result.executionId}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to trigger process: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Create Task — with handoff support
// ---------------------------------------------------------------------------

async function executeCreateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '').slice(0, MAX_TASK_TITLE_LENGTH);
  if (!title) return { success: false, error: 'title is required' };

  // Support both singular assigned_agent_id and plural assigned_agent_ids array
  const rawSingular = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;
  const rawPlural = Array.isArray(input.assigned_agent_ids)
    ? (input.assigned_agent_ids as unknown[]).map(String)
    : rawSingular ? [rawSingular] : [];
  const assignedAgentIds = [...new Set(rawPlural.filter(Boolean))];

  // Self-assignment prevention
  if (assignedAgentIds.includes(context.agentId)) {
    return { success: false, error: 'Cannot assign a task to yourself — this would create an infinite loop. Assign to a different agent or leave unassigned.' };
  }

  // Validate priority
  const rawPriority = String(input.priority ?? 'normal');
  const priority: TaskPriority = (VALID_PRIORITIES as readonly string[]).includes(rawPriority)
    ? rawPriority as TaskPriority
    : 'normal';

  const description = input.description ? String(input.description).slice(0, MAX_TASK_DESCRIPTION_LENGTH) : undefined;
  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;
  const currentDepth = context.handoffDepth ?? 0;

  // Check handoff depth BEFORE creating the task to avoid orphans
  if (assignedAgentIds.length > 0 && currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return {
      success: false,
      error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot assign task to another agent at this depth. Create the task without assignment instead.`,
    };
  }

  try {
    const item = await taskService.createTask(
      context.organisationId,
      context.subaccountId!,
      {
        title,
        description,
        brief: input.brief ? String(input.brief) : undefined,
        priority,
        status: input.status ? String(input.status) : 'inbox',
        assignedAgentIds: assignedAgentIds.length ? assignedAgentIds : undefined,
        createdByAgentId: context.agentId,
        handoffSourceRunId: context.runId,
        handoffContext: handoffContext ? { message: handoffContext } : undefined,
        handoffDepth: assignedAgentIds.length ? currentDepth + 1 : 0,
      }
    );

    // Trigger a handoff for every assigned agent
    const handoffResults = await Promise.all(
      assignedAgentIds.map(agentId =>
        enqueueHandoff({
          taskId: item.id,
          agentId,
          subaccountId: context.subaccountId!,
          organisationId: context.organisationId,
          sourceRunId: context.runId,
          handoffDepth: currentDepth + 1,
          handoffContext,
        })
      )
    );
    const handoffsEnqueued = handoffResults.filter(Boolean).length;

    return {
      success: true,
      task_id: item.id,
      title: item.title,
      status: item.status,
      assigned_agent_ids: assignedAgentIds,
      handoffs_enqueued: handoffsEnqueued,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Triage Intake — capture and route ideas/bugs into the inbox
//
// Two modes:
//   - capture: fast, judgement-free intake of one item. Builds a structured
//              description and creates a task in the 'inbox' status column.
//              Bugs that mention data corruption/data loss are auto-escalated
//              to priority='urgent'.
//   - triage:  scans the inbox for tasks lacking a triage disposition and
//              returns a structured proposal list (type_inferred, suggested
//              disposition, rationale). The skill is a *proposer*, not an
//              applier — the caller (orchestrator or human) decides which
//              dispositions to apply via move_task / update_task.
//
// Spec: server/skills/triage_intake.md
// ---------------------------------------------------------------------------

const DATA_LOSS_PATTERN =
  /\b(data\s*loss|data\s*corruption|corrupted|lost\s+data|wrong\s+data\s+written|cannot\s+recover|deleted\s+(?:rows?|records?)|overwritten|stale\s+writes?)\b/i;

const TRIAGE_DECISION_MARKER = 'Triage decision:';

function buildIdeaDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
}): string {
  return [
    `Task type: idea`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Problem / Opportunity:`,
    args.rawInput.trim(),
    ``,
    `Notes:`,
    `Captured via triage_intake (capture mode). Awaiting triage disposition — the orchestrator or a human will assess scope, value, and routing in the next triage pass.`,
  ].join('\n');
}

function buildBugDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
  dataLossEscalated: boolean;
}): string {
  return [
    `Task type: bug`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Reported behaviour:`,
    args.rawInput.trim(),
    ``,
    `Expected behaviour:`,
    `(to be filled in during triage)`,
    ``,
    `Reproduction steps:`,
    `(to be filled in during triage)`,
    ``,
    `Impact estimate:`,
    `- Users affected: Unknown`,
    `- Data impact: ${args.dataLossEscalated ? 'POSSIBLE DATA LOSS — escalated to urgent priority' : 'Unknown'}`,
    `- Workaround exists: Unknown`,
    args.dataLossEscalated
      ? `\n⚠ AUTO-ESCALATED: data-loss/corruption keywords detected in raw input. Priority set to urgent. Human review required before fix work begins.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildChoreDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
}): string {
  return [
    `Task type: chore`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Description:`,
    args.rawInput.trim(),
    ``,
    `Notes:`,
    `Captured via triage_intake (capture mode). Awaiting scheduling decision.`,
  ].join('\n');
}

function inferTypeFromDescription(description: string | null): 'idea' | 'bug' | 'chore' | 'unknown' {
  if (!description) return 'unknown';
  const match = description.match(/^Task type:\s*(idea|bug|chore)/im);
  return (match?.[1]?.toLowerCase() as 'idea' | 'bug' | 'chore' | undefined) ?? 'unknown';
}

function suggestDisposition(args: {
  type: ReturnType<typeof inferTypeFromDescription>;
  priority: string;
  description: string | null;
  title: string;
}): { disposition: 'Defer' | 'Assess' | 'Schedule' | 'Close'; rationale: string } {
  // Urgent items always get Schedule (they need to be acted on, not deferred)
  if (args.priority === 'urgent') {
    return {
      disposition: 'Schedule',
      rationale: 'Urgent priority — requires immediate scheduling, not deferral.',
    };
  }

  // Bugs with data-loss markers — already escalated above. Ordinary bugs → Schedule.
  if (args.type === 'bug') {
    return {
      disposition: 'Schedule',
      rationale: 'Bug reports default to schedule for fix work — defer only after explicit assessment.',
    };
  }

  // Chores → Schedule (small, predictable work)
  if (args.type === 'chore') {
    return {
      disposition: 'Schedule',
      rationale: 'Chore tasks are small and predictable — schedule directly without spec work.',
    };
  }

  // Ideas → Assess (need BA evaluation before sizing)
  if (args.type === 'idea') {
    return {
      disposition: 'Assess',
      rationale: 'Idea/feature request — route to Business Analyst for scope and value assessment before scheduling.',
    };
  }

  // Unknown type — default to Defer (safer than guessing)
  return {
    disposition: 'Defer',
    rationale: 'Unknown task type — defer until reclassified or human reviews.',
  };
}

async function executeTriageIntake(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const mode = String(input.mode ?? '');
  if (mode !== 'capture' && mode !== 'triage') {
    return { success: false, error: "mode must be 'capture' or 'triage'" };
  }

  // ── CAPTURE MODE ──────────────────────────────────────────────────────
  if (mode === 'capture') {
    const rawInput = String(input.raw_input ?? '').trim();
    const inputType = String(input.input_type ?? '').toLowerCase();
    const source = String(input.source ?? '').trim();
    const relatedTaskId = input.related_task_id ? String(input.related_task_id) : undefined;

    if (!rawInput) {
      return { success: false, error: "'raw_input' is required in capture mode" };
    }
    if (inputType !== 'idea' && inputType !== 'bug' && inputType !== 'chore') {
      return {
        success: false,
        error: "'input_type' must be one of: idea, bug, chore",
      };
    }
    if (!source) {
      return { success: false, error: "'source' is required in capture mode" };
    }

    // Detect data-loss escalation for bugs (per spec escalation rule)
    const dataLossEscalated = inputType === 'bug' && DATA_LOSS_PATTERN.test(rawInput);

    // Map intake type → runtime priority. Bugs with data-loss markers escalate
    // to 'urgent'; everything else defaults to 'normal'. Triage mode is the
    // place where priorities get adjusted further if needed.
    const priority: TaskPriority = dataLossEscalated ? 'urgent' : 'normal';

    // Build the structured description per the spec template
    let description: string;
    if (inputType === 'idea') {
      description = buildIdeaDescription({ source, rawInput, relatedTaskId });
    } else if (inputType === 'bug') {
      description = buildBugDescription({ source, rawInput, relatedTaskId, dataLossEscalated });
    } else {
      description = buildChoreDescription({ source, rawInput, relatedTaskId });
    }

    // Title: first line of raw input, truncated. Capture mode is allowed to
    // be lossy here — the structured description carries the full content.
    const title = rawInput.split(/\n/, 1)[0]!.slice(0, MAX_TASK_TITLE_LENGTH).trim() || `${inputType} from ${source}`;

    try {
      const item = await taskService.createTask(
        context.organisationId,
        context.subaccountId!,
        {
          title,
          description: description.slice(0, MAX_TASK_DESCRIPTION_LENGTH),
          priority,
          status: 'inbox',
          createdByAgentId: context.agentId,
        }
      );

      return {
        success: true,
        mode: 'capture' as const,
        task_id: item.id,
        title: item.title,
        captured_type: inputType,
        priority,
        escalated: dataLossEscalated,
        _created_task: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to capture task: ${errMsg}` };
    }
  }

  // ── TRIAGE MODE ───────────────────────────────────────────────────────
  // Scan the inbox for items lacking a triage disposition and return a
  // structured proposal list. This skill does NOT apply dispositions —
  // the caller (orchestrator or human) does that via move_task/update_task.
  const scope = String(input.scope ?? 'all');
  const relatedTaskId = input.related_task_id ? String(input.related_task_id) : undefined;

  if (scope === 'single' && !relatedTaskId) {
    return { success: false, error: "'related_task_id' is required when scope='single'" };
  }

  try {
    const conditions = [
      eq(tasks.subaccountId, context.subaccountId!),
      eq(tasks.status, 'inbox'),
      isNull(tasks.deletedAt),
    ];
    if (scope === 'single' && relatedTaskId) {
      conditions.push(eq(tasks.id, relatedTaskId));
    }

    const inboxRows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(and(...conditions));

    // Filter out items that already carry a triage decision marker — those
    // have been triaged in a previous pass and are awaiting application.
    const untriaged = inboxRows.filter(
      (row) => !row.description?.includes(TRIAGE_DECISION_MARKER)
    );

    const proposals = untriaged.map((row) => {
      const type = inferTypeFromDescription(row.description);
      const { disposition, rationale } = suggestDisposition({
        type,
        priority: row.priority,
        description: row.description,
        title: row.title,
      });
      return {
        task_id: row.id,
        title: row.title,
        type_inferred: type,
        priority: row.priority,
        suggested_disposition: disposition,
        rationale,
      };
    });

    // Group counts for the summary block
    const byDisposition = proposals.reduce<Record<string, number>>((acc, p) => {
      acc[p.suggested_disposition] = (acc[p.suggested_disposition] ?? 0) + 1;
      return acc;
    }, {});

    return {
      success: true,
      mode: 'triage' as const,
      scope,
      scanned: inboxRows.length,
      already_triaged: inboxRows.length - untriaged.length,
      proposals_returned: proposals.length,
      summary: byDisposition,
      proposals,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to scan inbox for triage: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Move Task
// ---------------------------------------------------------------------------

async function executeMoveTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const status = String(input.status ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!status) return { success: false, error: 'status is required' };

  try {
    // Get current item to find subaccount
    const item = await taskService.getTask(taskId, context.organisationId);
    const position = await taskService._nextPosition(item.subaccountId!, status);

    const updated = await taskService.moveTask(
      taskId,
      context.organisationId,
      { status, position }
    );

    return {
      success: true,
      task_id: updated.id,
      new_status: updated.status,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to move task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Add Deliverable
// ---------------------------------------------------------------------------

async function executeAddDeliverable(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const title = String(input.title ?? '');
  const deliverableType = String(input.deliverable_type ?? 'artifact') as 'file' | 'url' | 'artifact';
  const description = String(input.description ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!title) return { success: false, error: 'title is required' };

  try {
    const deliverable = await taskService.addDeliverable(taskId, context.organisationId, {
      deliverableType,
      title,
      description: description || undefined,
    });

    // Also log an activity
    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'deliverable_added',
      message: `Deliverable added: "${title}"`,
      agentId: context.agentId,
    });

    return {
      success: true,
      deliverable_id: deliverable.id,
      _created_deliverable: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to add deliverable: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Handoff enqueuing
// ---------------------------------------------------------------------------

interface HandoffRequest {
  taskId: string;
  agentId: string;
  subaccountId: string;
  organisationId: string;
  sourceRunId: string;
  handoffDepth: number;
  handoffContext?: string;
}

async function enqueueHandoff(req: HandoffRequest): Promise<boolean> {
  // Depth cap
  if (req.handoffDepth > MAX_HANDOFF_DEPTH) {
    console.warn(`[Handoff] Depth ${req.handoffDepth} exceeds max ${MAX_HANDOFF_DEPTH}, skipping`);
    return false;
  }

  // Look up the subaccount agent link for the target agent
  const [saLink] = await db
    .select({
      sa: subaccountAgents,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.subaccountId, req.subaccountId),
        eq(subaccountAgents.agentId, req.agentId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
        isNull(agents.deletedAt)
      )
    );

  if (!saLink) {
    console.warn(`[Handoff] No active subaccount agent link for agent ${req.agentId} in subaccount ${req.subaccountId}`);
    return false;
  }

  // Duplicate prevention: check for running/pending runs for same agent+task
  const [existingRun] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, req.agentId),
        eq(agentRuns.taskId, req.taskId),
        eq(agentRuns.subaccountId, req.subaccountId)
      )
    )
    .limit(1);

  if (existingRun && (existingRun.status === 'running' || existingRun.status === 'pending')) {
    console.warn(`[Handoff] Agent ${req.agentId} already has a ${existingRun.status} run for task ${req.taskId}, skipping`);
    return false;
  }

  if (!pgBossSend) {
    console.warn('[Handoff] pg-boss sender not configured, cannot enqueue handoff');
    return false;
  }

  try {
    await pgBossSend(AGENT_HANDOFF_QUEUE, {
      taskId: req.taskId,
      agentId: req.agentId,
      subaccountAgentId: saLink.sa.id,
      subaccountId: req.subaccountId,
      organisationId: req.organisationId,
      sourceRunId: req.sourceRunId,
      handoffDepth: req.handoffDepth,
      handoffContext: req.handoffContext,
    });
    createEvent('agent.handoff.enqueued', {
      targetAgentId: req.agentId,
      sourceRunId: req.sourceRunId,
      handoffDepth: req.handoffDepth,
      taskId: req.taskId,
    });
    return true;
  } catch (err) {
    console.error('[Handoff] Failed to enqueue handoff job:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Update Task — update content fields (title, description, brief, priority)
// ---------------------------------------------------------------------------

async function executeUpdateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  if (!taskId) return { success: false, error: 'task_id is required' };

  const reasoning = String(input.reasoning ?? '').trim();
  if (!reasoning) return { success: false, error: 'reasoning is required' };

  const update: {
    title?: string;
    description?: string;
    brief?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  } = {};

  if (input.title !== undefined) update.title = String(input.title).slice(0, 255);
  if (input.description !== undefined) update.description = String(input.description);
  if (input.brief !== undefined) update.brief = String(input.brief);
  if (input.priority !== undefined) {
    const p = String(input.priority);
    if (!['low', 'normal', 'high', 'urgent'].includes(p)) {
      return { success: false, error: `Invalid priority: ${p}` };
    }
    update.priority = p as 'low' | 'normal' | 'high' | 'urgent';
  }

  if (!Object.keys(update).length) {
    return { success: false, error: 'At least one field (title, description, brief, priority) must be provided' };
  }

  try {
    const updated = await taskService.updateTask(taskId, context.organisationId, update);

    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'note',
      message: `Updated by agent: ${reasoning}`,
      agentId: context.agentId,
    });

    return {
      success: true,
      task_id: updated.id,
      updated_fields: Object.keys(update),
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to update task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Reassign Task — hand current task to another agent
// ---------------------------------------------------------------------------

async function executeReassignTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;

  if (!taskId) return { success: false, error: 'task_id is required' };

  // Support both singular and plural agent assignment
  const rawSingular = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;
  const rawPlural = Array.isArray(input.assigned_agent_ids)
    ? (input.assigned_agent_ids as unknown[]).map(String)
    : rawSingular ? [rawSingular] : [];
  const assignedAgentIds = [...new Set(rawPlural.filter(Boolean))];

  if (!assignedAgentIds.length) return { success: false, error: 'assigned_agent_id or assigned_agent_ids is required' };

  // Self-assignment prevention
  if (assignedAgentIds.includes(context.agentId)) {
    return { success: false, error: 'Cannot reassign a task to yourself. Choose a different agent.' };
  }

  const currentDepth = context.handoffDepth ?? 0;
  if (currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return { success: false, error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot reassign further.` };
  }

  try {
    await taskService.updateTask(taskId, context.organisationId, {
      assignedAgentIds,
    });

    await db.update(tasks).set({
      handoffSourceRunId: context.runId,
      handoffContext: handoffContext ? { message: handoffContext } : null,
      handoffDepth: currentDepth + 1,
      updatedAt: new Date(),
    // guard-ignore-next-line: org-scoped-writes reason="taskId passed through taskService.updateTask above which verifies org membership; this is a supplemental metadata update on the same task"
    }).where(eq(tasks.id, taskId));

    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'assigned',
      message: `Reassigned to ${assignedAgentIds.length} agent${assignedAgentIds.length > 1 ? 's' : ''}${handoffContext ? ` — ${handoffContext}` : ''}`,
      agentId: context.agentId,
    });

    // Trigger a handoff for every assigned agent
    const handoffResults = await Promise.all(
      assignedAgentIds.map(agentId =>
        enqueueHandoff({
          taskId,
          agentId,
          subaccountId: context.subaccountId!,
          organisationId: context.organisationId,
          sourceRunId: context.runId,
          handoffDepth: currentDepth + 1,
          handoffContext,
        })
      )
    );
    const handoffsEnqueued = handoffResults.filter(Boolean).length;

    return {
      success: true,
      task_id: taskId,
      assigned_agent_ids: assignedAgentIds,
      handoffs_enqueued: handoffsEnqueued,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to reassign task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Spawn Sub-Agents — parallel execution of 2-3 sub-tasks
// ---------------------------------------------------------------------------

async function executeSpawnSubAgents(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // Prevent nesting
  if (context.isSubAgent) {
    return { success: false, error: 'Sub-agents cannot spawn their own sub-agents. Only one level of nesting is allowed.' };
  }

  const subTasks = input.sub_tasks as Array<{ title: string; brief: string; assigned_agent_id: string }> | undefined;

  if (!subTasks || !Array.isArray(subTasks)) {
    return { success: false, error: 'sub_tasks array is required' };
  }
  if (subTasks.length < 2 || subTasks.length > MAX_SUB_AGENTS) {
    return { success: false, error: `sub_tasks must contain 2-${MAX_SUB_AGENTS} items` };
  }

  // Validate each sub-task
  for (const st of subTasks) {
    if (!st.title || !st.brief || !st.assigned_agent_id) {
      return { success: false, error: 'Each sub-task requires title, brief, and assigned_agent_id' };
    }
  }

  // Calculate per-child budget
  const totalBudget = context.tokenBudget ?? 30000;
  const elapsed = context.startTime ? Date.now() - context.startTime : 0;
  const totalTimeout = context.timeoutMs ?? 300000;
  const remainingTimeMs = Math.max(totalTimeout - elapsed, 30000);
  const perChildBudget = Math.floor(totalBudget / subTasks.length);
  const perChildTimeout = Math.floor(remainingTimeMs / SUB_AGENT_TIMEOUT_BUFFER);

  if (perChildBudget < MIN_SUB_AGENT_TOKEN_BUDGET) {
    return { success: false, error: `Insufficient token budget remaining for ${subTasks.length} sub-agents. Need at least ${MIN_SUB_AGENT_TOKEN_BUDGET * subTasks.length} tokens.` };
  }

  try {
    // Create task cards and resolve agent links
    const childJobs: Array<{
      task: { id: string; title: string };
      saLink: { id: string; agentId: string };
    }> = [];

    for (const st of subTasks) {
      const task = await taskService.createTask(
        context.organisationId,
        context.subaccountId!,
        {
          title: st.title.slice(0, MAX_TASK_TITLE_LENGTH),
          brief: st.brief.slice(0, MAX_TASK_DESCRIPTION_LENGTH),
          status: 'in_progress',
          assignedAgentId: st.assigned_agent_id,
          createdByAgentId: context.agentId,
          isSubTask: true,
          parentTaskId: context.runId, // Link to parent's task context
        }
      );

      // Find subaccount agent link
      const [saLink] = await db
        .select({ sa: subaccountAgents })
        .from(subaccountAgents)
        .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
        .where(
          and(
            eq(subaccountAgents.subaccountId, context.subaccountId!),
            eq(subaccountAgents.agentId, st.assigned_agent_id),
            eq(subaccountAgents.isActive, true),
            eq(agents.status, 'active'),
            isNull(agents.deletedAt)
          )
        );

      if (!saLink) {
        return { success: false, error: `Agent ${st.assigned_agent_id} not found or inactive in this subaccount` };
      }

      childJobs.push({ task, saLink: { id: saLink.sa.id, agentId: st.assigned_agent_id } });
    }

    // Execute all children in parallel
    createEvent('agent.spawn.fanout', {
      fanOutCount: childJobs.length,
      perChildBudget,
      perChildTimeoutMs: perChildTimeout,
    });
    const childResults = await Promise.all(
      childJobs.map(async (job) => {
        try {
          const result = await agentExecutionService.executeRun({
            agentId: job.saLink.agentId,
            subaccountId: context.subaccountId,
            subaccountAgentId: job.saLink.id,
            organisationId: context.organisationId,
            executionScope: 'subaccount',
            runType: 'triggered',
            runSource: 'sub_agent',
            executionMode: 'api',
            taskId: job.task.id,
            triggerContext: {
              type: 'sub_agent',
              parentRunId: context.runId,
            },
            isSubAgent: true,
            parentSpawnRunId: context.runId,
          });

          return {
            title: job.task.title,
            status: result.status,
            summary: result.summary,
            task_id: job.task.id,
            agent_run_id: result.runId,
            tokens_used: result.totalTokens,
          };
        } catch (err) {
          return {
            title: job.task.title,
            status: 'failed' as const,
            summary: null,
            error: err instanceof Error ? err.message : String(err),
            task_id: job.task.id,
            agent_run_id: null,
            tokens_used: 0,
          };
        }
      })
    );

    const totalTokens = childResults.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

    return {
      success: true,
      results: childResults,
      total_tokens: totalTokens,
      total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to spawn sub-agents: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Read Inbox — stub (provider integration pending)
// ---------------------------------------------------------------------------

async function executeReadInbox(
  _input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  return {
    success: true,
    result: {
      messages: [],
      note: 'read_inbox: provider integration pending',
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch URL — HTTP GET/POST with response truncation
// ---------------------------------------------------------------------------

async function executeFetchUrl(
  input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const method = (String(input.method ?? 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { success: false, error: 'method must be GET or POST' };
  }

  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === 'object') {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if (method === 'POST' && input.body) {
      fetchOptions.body = String(input.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    const bodyText = await response.text();
    const truncated = bodyText.length > 10000;
    const content = truncated ? bodyText.slice(0, 10000) : bodyText;

    return {
      success: true,
      status_code: response.status,
      content,
      truncated,
      content_type: response.headers.get('content-type') ?? undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Fetch failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Scrape URL — tiered web scraping with automatic escalation
// ---------------------------------------------------------------------------

async function executeScrapeUrl(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const result = await scrapingEngine.scrape({
    url,
    extract: input.extract ? String(input.extract) : undefined,
    outputFormat: (input.output_format as 'text' | 'markdown' | 'json') ?? 'markdown',
    selectors: input.css_selectors as string[] | undefined,
    adaptive: true,
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? undefined,
    _mcpCallContext: context._mcpClients ? {
      clients: context._mcpClients,
      lazyRegistry: context._mcpLazyRegistry ?? new Map(),
      runContext: {
        runId: context.runId,
        organisationId: context.organisationId,
        agentId: context.agentId,
        subaccountId: context.subaccountId,
        isTestRun: context.isTestRun ?? false,
        taskId: context.taskId,
        mcpCallCount: context.mcpCallCount,
      },
    } : undefined,
  });

  return {
    success: result.success,
    content: result.content,
    tier_used: result.tierUsed,
    content_hash: result.contentHash,
    extracted_data: result.extractedData,
    url: result.url,
    metadata: result.metadata,
  };
}

// ---------------------------------------------------------------------------
// Scrape Structured — adaptive selector extraction with LLM first-run learning
// ---------------------------------------------------------------------------

const SCRAPE_STRUCTURED_MAX_HTML_CHARS = 40_000; // ~4000 tokens of focused DOM
const SCRAPE_STRUCTURED_RETURN_LIMIT = 50_000;   // max response chars returned to agent

/**
 * Derive a deterministic selectorGroup from the site hostname and field string.
 * Format: "<hostname>:<sha256(fields.trim().lower).slice(0,8)>"
 */
function deriveSelectorGroup(hostname: string, fields: string): string {
  const hash = createHash('sha256')
    .update(fields.trim().toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `${hostname}:${hash}`;
}

async function executeScrapeStructured(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  const fields = String(input.fields ?? '');
  const remember = input.remember !== false; // default true
  const selectorGroupInput = input.selector_group ? String(input.selector_group) : null;

  if (!url) return { success: false, error: 'url is required' };
  if (!fields) return { success: false, error: 'fields is required' };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const selectorGroup = selectorGroupInput ?? deriveSelectorGroup(hostname, fields);
  const urlPattern = hostname; // Use hostname as URL pattern for Phase 2

  // Canonicalize field names
  const canonicalFields = fields
    .split(',')
    .map(f => canonicalizeFieldKey(f))
    .filter(Boolean);

  // ── 1. Check for existing selectors ──────────────────────────────────────
  const storedSelectors = await loadSelectors({
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? null,
    urlPattern,
    selectorGroup,
  });

  // ── 2. Fetch the page (max Tier 2 — need raw HTML for DOM extraction) ────
  const scrapeResult = await scrapingEngine.scrape({
    url,
    outputFormat: 'text',
    maxTier: 2,
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? undefined,
  });

  if (!scrapeResult.success || !scrapeResult.rawHtml) {
    return { success: false, error: `Failed to fetch page: ${url}` };
  }

  const contentHash = computeContentHash(scrapeResult.content);

  // ── 3a. Stored selectors exist — DOM extraction path ─────────────────────
  if (storedSelectors.length > 0) {
    try {
      const { JSDOM } = await import('jsdom');
      const { document } = new JSDOM(scrapeResult.rawHtml!).window;

      const extracted: Record<string, string[]> = {};
      let overallScore = 1.0;
      let adaptiveMatchUsed = false;
      let selectorUncertain = false;
      const selectorUpdates: Array<{ id: string; newSelector: string; newFingerprint: import('./scrapingEngine/adaptiveSelector.js').ElementFingerprint }> = [];

      for (const stored of storedSelectors) {
        const fieldKey = stored.selectorName;
        const resolution = resolveSelector(document, stored.cssSelector, stored.elementFingerprint);

        if (!resolution.found) {
          await incrementMiss(stored.id);
          extracted[fieldKey] = [];
          overallScore = Math.min(overallScore, 0);
          continue;
        }

        if (resolution.adaptiveMatchUsed) {
          adaptiveMatchUsed = true;
          if (resolution.cssSelector && resolution.fingerprint) {
            selectorUpdates.push({
              id: stored.id,
              newSelector: resolution.cssSelector,
              newFingerprint: resolution.fingerprint,
            });
          }
        }

        overallScore = Math.min(overallScore, resolution.score);
        if (resolution.uncertain) selectorUncertain = true;

        // Extract all matching elements for this selector (per-field try/catch
        // so a broken selector for one field doesn't discard the rest)
        try {
          const matchedEls = document.querySelectorAll(resolution.cssSelector!);
          const values: string[] = [];
          matchedEls.forEach((el: Element) => {
            const text = (el.textContent ?? '').trim();
            if (text) values.push(text);
          });
          extracted[fieldKey] = values;
          await incrementHit(stored.id);
        } catch {
          await incrementMiss(stored.id);
          extracted[fieldKey] = [];
          overallScore = Math.min(overallScore, 0);
        }
      }

      // Apply adaptive updates if any
      for (const upd of selectorUpdates) {
        await updateSelector(upd.id, upd.newSelector, upd.newFingerprint);
      }

      return {
        success: true,
        ...extracted,
        selector_confidence: overallScore,
        adaptive_match_used: adaptiveMatchUsed,
        selector_uncertain: selectorUncertain,
        content_hash: contentHash,
        url,
      };
    } catch (err) {
      // If DOM extraction fails, fall through to LLM path
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[scrape_structured] DOM extraction failed, falling back to LLM: ${errMsg}`);
    }
  }

  // ── 3b. No stored selectors — LLM extraction path ────────────────────────
  // Build a focused DOM excerpt for the LLM
  const htmlForLlm = (scrapeResult.rawHtml ?? '').slice(0, SCRAPE_STRUCTURED_MAX_HTML_CHARS);
  const fieldList = canonicalFields.join(', ');

  const extractionPrompt = `You are a data extraction assistant. Given the HTML below, extract structured data.

Fields to extract: ${fieldList}

Rules:
- Return ONLY valid JSON with exactly these keys: ${fieldList}
- Each key maps to an ARRAY of values (even if there is only one value)
- For multiple records on the page (e.g. pricing tiers), each field array has one entry per record in the same order
- Also return a "css_selectors" key mapping each field to the CSS selector that targets those elements
- If a field cannot be found, use an empty array []

Example response for fields "plan_name, price":
{"plan_name":["Starter","Pro"],"price":["$9","$29"],"css_selectors":{"plan_name":"h3.plan-name","price":"span.price"}}

HTML:
${htmlForLlm}`;

  const llmResponse = await routeCall({
    messages: [{ role: 'user', content: extractionPrompt }],
    maxTokens: 2000,
    context: {
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? '',
      runId: context.runId,
      sourceType: 'system',
      agentName: 'scrape_structured',
      taskType: 'general',
      executionPhase: 'execution',
      routingMode: 'ceiling',
    },
  });

  // Parse LLM response
  let extracted: Record<string, unknown> = {};
  let cssSelectorsFromLlm: Record<string, string> = {};

  try {
    const responseText = typeof llmResponse.content === 'string' ? llmResponse.content : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      cssSelectorsFromLlm = (parsed.css_selectors as Record<string, string>) ?? {};
      delete parsed.css_selectors;
      extracted = parsed;
    }
  } catch {
    return { success: false, error: 'LLM extraction failed to return valid JSON' };
  }

  // ── 4. Learn selectors for next time ────────────────────────────────────
  if (remember && Object.keys(cssSelectorsFromLlm).length > 0 && scrapeResult.rawHtml) {
    try {
      const { JSDOM } = await import('jsdom');
      const { document: learnDoc } = new JSDOM(scrapeResult.rawHtml).window;

      for (const [fieldName, selector] of Object.entries(cssSelectorsFromLlm)) {
        if (!selector || typeof selector !== 'string') continue;
        let el: Element | null = null;
        try { el = learnDoc.querySelector(selector); } catch { continue; }
        if (el === null) continue;

        const fingerprint = buildFingerprint(el);

        await saveSelector({
          orgId: context.organisationId,
          subaccountId: context.subaccountId ?? null,
          urlPattern,
          selectorGroup,
          selectorName: fieldName,
          cssSelector: selector,
          fingerprint,
        }).catch(err => {
          console.warn(`[scrape_structured] Failed to save selector for "${fieldName}": ${err}`);
        });
      }
    } catch (err) {
      // Selector learning is best-effort — don't fail the extraction
      console.warn(`[scrape_structured] Selector learning failed: ${err}`);
    }
  }

  const dataWasTruncated = JSON.stringify(extracted).length > SCRAPE_STRUCTURED_RETURN_LIMIT;

  return {
    success: true,
    ...extracted,
    ...(dataWasTruncated ? { data_truncated: true } : {}),
    selector_confidence: 0,        // 0 = LLM extraction (no stored selectors)
    adaptive_match_used: false,
    selector_uncertain: false,
    content_hash: contentHash,
    url,
  };
}

// ---------------------------------------------------------------------------
// Monitor Webpage — set up recurring monitoring with change detection
// ---------------------------------------------------------------------------

const MONITOR_SCHEDULE_TIME_DEFAULT = '00:00';

async function executeMonitorWebpage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  const watchFor = String(input.watch_for ?? '');
  const frequency = String(input.frequency ?? '');
  const fields = input.fields ? String(input.fields) : null;

  if (!url) return { success: false, error: 'url is required' };
  if (!watchFor) return { success: false, error: 'watch_for is required' };
  if (!frequency) return { success: false, error: 'frequency is required' };

  // requireSubaccountContext check — monitor_webpage needs a subaccount to attach the scheduled task
  if (!context.subaccountId) {
    return { success: false, error: 'monitor_webpage requires a subaccount context' };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  // ── 0. Deduplication — return existing task if one already monitors this URL ──
  const existingTasks = await db
    .select({ id: scheduledTasks.id, brief: scheduledTasks.brief })
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.organisationId, context.organisationId),
        eq(scheduledTasks.subaccountId, context.subaccountId),
        eq(scheduledTasks.assignedAgentId, context.agentId),
        eq(scheduledTasks.isActive, true),
      ),
    );

  const duplicate = existingTasks.find(t => {
    try {
      return parseMonitorBrief(t.brief ?? '').monitorUrl === url;
    } catch {
      return false;
    }
  });

  if (duplicate) {
    return {
      success: true,
      scheduled_task_id: duplicate.id,
      already_existed: true,
      message: `Monitor for ${url} already exists (task ${duplicate.id})`,
    };
  }

  // ── 1. Parse frequency to rrule ──────────────────────────────────────────
  let rrule: string;
  try {
    rrule = parseFrequencyToRRule(frequency);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? `Unsupported frequency: "${frequency}"`;
    return { success: false, error: msg };
  }

  // Derive scheduleTime from rrule (default 00:00 for simple frequencies)
  const scheduleTime = MONITOR_SCHEDULE_TIME_DEFAULT;

  // ── 2. Derive selectorGroup ──────────────────────────────────────────────
  let selectorGroup: string | null = null;
  if (fields) {
    selectorGroup = deriveSelectorGroup(hostname, fields);
  }

  // ── 3. Establish initial baseline ────────────────────────────────────────
  let baselineContentHash = '';
  let baselineExtractedData: Record<string, unknown> | null = null;

  if (fields) {
    // Structured monitoring — use LLM extraction for first run
    const structuredResult = await executeScrapeStructured(
      { url, fields, remember: true, selector_group: selectorGroup },
      context
    ) as Record<string, unknown>;

    if (structuredResult.success === false) {
      return {
        success: false,
        error: `Failed to establish structured baseline: ${structuredResult.error}`,
      };
    }

    baselineContentHash = String(structuredResult.content_hash ?? '');
    const {
      success: _s,
      content_hash: _ch,
      url: _u,
      selector_confidence: _sc,
      adaptive_match_used: _am,
      selector_uncertain: _su,
      data_truncated: _dt,
      ...dataFields
    } = structuredResult;
    baselineExtractedData = dataFields as Record<string, unknown>;
  } else {
    // Hash-based monitoring
    const scrapeResult = await scrapingEngine.scrape({
      url,
      outputFormat: 'markdown',
      orgId: context.organisationId,
      subaccountId: context.subaccountId ?? undefined,
    });

    if (!scrapeResult.success) {
      return { success: false, error: `Failed to establish baseline — page could not be fetched: ${url}` };
    }

    baselineContentHash = scrapeResult.contentHash;
  }

  // ── 4. Create scheduled task ─────────────────────────────────────────────
  // The brief carries all config needed by subsequent runs.
  // A temporary ID placeholder — replaced after insert with actual ID.
  const briefPlaceholder = serializeMonitorBrief({
    type: 'monitor_webpage_run',
    monitorUrl: url,
    watchFor,
    fields,
    selectorGroup,
    scheduledTaskId: '__PLACEHOLDER__',
  });

  const title = `Monitor: ${hostname} — ${watchFor.slice(0, 50)}`;

  const scheduledTask = await scheduledTaskService.create(
    context.organisationId,
    context.subaccountId,
    {
      title,
      brief: briefPlaceholder, // updated below
      assignedAgentId: context.agentId, // Strategic Intelligence Agent
      rrule,
      timezone: 'UTC',
      scheduleTime,
    },
  );

  // ── 5. Update brief with actual scheduledTaskId ──────────────────────────
  const finalBrief = serializeMonitorBrief({
    type: 'monitor_webpage_run',
    monitorUrl: url,
    watchFor,
    fields,
    selectorGroup,
    scheduledTaskId: scheduledTask.id,
    baseline: {
      contentHash: baselineContentHash,
      extractedData: baselineExtractedData,
    },
  });

  await scheduledTaskService.update(scheduledTask.id, context.organisationId, { brief: finalBrief });

  return {
    success: true,
    scheduled_task_id: scheduledTask.id,
    title,
    rrule,
    frequency,
    url,
    watch_for: watchFor,
    fields: fields ?? null,
    baseline_content_hash: baselineContentHash,
    message: `Monitoring scheduled. The "${title}" task will run ${frequency} and alert you when ${watchFor} changes.`,
  };
}

// ---------------------------------------------------------------------------
// proposeDevopsAction — safeMode-checked proposal for write_patch / run_command / create_pr
// ---------------------------------------------------------------------------

async function proposeDevopsAction(
  actionType: 'write_patch' | 'run_command' | 'create_pr',
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  // safeMode blocks all code-modification actions
  if (devCtx.safeMode) {
    return {
      success: false,
      error: `safeMode is enabled for this subaccount. ${actionType} is not allowed. Disable safeMode in devContext settings to permit code changes.`,
      errorCode: 'permission_failure',
    };
  }

  // write_patch: validate patchLimits + maxPatchAttemptsPerTask before proposing
  if (actionType === 'write_patch') {
    const diff = String(input.diff ?? '');
    const lineCount = diff.split('\n').length;
    if (lineCount > devCtx.patchLimits.maxLinesChanged) {
      return {
        success: false,
        error: `Patch exceeds maxLinesChanged limit (${lineCount} lines > ${devCtx.patchLimits.maxLinesChanged}). Split the change into smaller patches.`,
        errorCode: 'patch_size_exceeded',
      };
    }

    // Enforce maxPatchAttemptsPerTask across all runs for this task
    if (context.taskId) {
      const taskRunRows = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.taskId, context.taskId));
      const taskRunIds = taskRunRows.map(r => r.id);
      const patchCount = taskRunIds.length
        ? await db
            .select({ total: count() })
            .from(actions)
            .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'write_patch')))
            .then(rows => Number(rows[0]?.total ?? 0))
        : 0;
      if (patchCount >= devCtx.costLimits.maxPatchAttemptsPerTask) {
        return {
          success: false,
          error: `Patch attempt limit reached (${patchCount}/${devCtx.costLimits.maxPatchAttemptsPerTask} per task). Cannot propose more patches for this task without human review.`,
          errorCode: 'permission_failure',
        };
      }
    }

    // Auto-inject task_id so devopsAdapter can manage the correct branch
    if (context.taskId) {
      input = { ...input, task_id: context.taskId };
    }
  }

  // run_command: enforce maxCommandsPerRun cost limit
  if (actionType === 'run_command') {
    const [countRow] = await db
      .select({ total: count() })
      .from(actions)
      .where(
        and(
          eq(actions.agentRunId, context.runId),
          eq(actions.actionType, 'run_command')
        )
      );
    const commandCount = Number(countRow?.total ?? 0);
    if (commandCount >= devCtx.costLimits.maxCommandsPerRun) {
      return {
        success: false,
        error: `Command limit reached (${commandCount}/${devCtx.costLimits.maxCommandsPerRun} per run). Cannot run more commands in this agent run.`,
        errorCode: 'permission_failure',
      };
    }
  }

  return proposeReviewGatedAction(actionType, input, context);
}

// ---------------------------------------------------------------------------
// Read Codebase — read a file from DEC projectRoot with path validation
// ---------------------------------------------------------------------------

const READ_CODEBASE_MAX_BYTES = 50 * 1024; // 50 KB

async function executeReadCodebase(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const filePath = String(input.file_path ?? '');
  if (!filePath) return { success: false, error: 'file_path is required' };

  try {
    const { context: devCtx } = await devContextService.getContext(context.subaccountId!);
    const absolutePath = resolve(devCtx.projectRoot, filePath);

    assertPathInRoot(absolutePath, devCtx.projectRoot);

    const raw = await readFile(absolutePath, 'utf8');
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const truncated = rawBytes > READ_CODEBASE_MAX_BYTES;
    const content = truncated
      ? Buffer.from(raw, 'utf8').slice(0, READ_CODEBASE_MAX_BYTES).toString('utf8')
      : raw;

    return {
      success: true,
      file_path: filePath,
      content,
      truncated,
      size_bytes: rawBytes,
    };
  } catch (err) {
    const e = err as { message?: string; code?: string; statusCode?: number };
    if (e.statusCode === 403) return { success: false, error: e.message ?? 'Access denied' };
    if (e.code === 'ENOENT') return { success: false, error: `File not found: ${filePath}` };
    return { success: false, error: e.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Search Codebase — grep content or glob filenames, scoped to projectRoot
// ---------------------------------------------------------------------------

async function executeSearchCodebase(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const query = String(input.query ?? '');
  const searchType = String(input.search_type ?? 'content'); // 'content' | 'filename'
  const filePattern = input.file_pattern ? String(input.file_pattern) : undefined;
  const maxResults = Math.min(Number(input.max_results ?? 20), 50);

  if (!query) return { success: false, error: 'query is required' };

  try {
    const { context: devCtx } = await devContextService.getContext(context.subaccountId!);
    const root = devCtx.projectRoot;

    if (searchType === 'filename') {
      const pattern = filePattern ?? `**/*${query}*`;
      const matches: string[] = [];
      for (const file of await glob(pattern, { cwd: root })) {
        const strFile = String(file);
        matches.push(strFile);
        if (matches.length >= maxResults) break;
      }
      return {
        success: true,
        search_type: 'filename',
        query,
        results: matches.map(f => ({ file: f })),
        total: matches.length,
      };
    }

    // Content search using grep
    const includeArg = filePattern ? `--include=${filePattern}` : '--include=*';
    const grepArgs = ['-r', '-n', '--max-count=5', includeArg, query, root];

    const { stdout } = await execFileAsync('grep', grepArgs, {
      cwd: root,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }).catch((err: { stdout?: string; code?: number }) => {
      // grep exits 1 when no matches — not a real failure
      if (err.code === 1) return { stdout: '' };
      throw err;
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = lines.slice(0, maxResults).map(line => {
      const colonIdx = line.indexOf(':');
      const secondColon = line.indexOf(':', colonIdx + 1);
      const file = line.slice(root.length + 1, colonIdx);
      const lineNum = secondColon !== -1 ? line.slice(colonIdx + 1, secondColon) : '';
      const content = secondColon !== -1 ? line.slice(secondColon + 1) : line.slice(colonIdx + 1);
      return { file, line: lineNum ? Number(lineNum) : undefined, content: content.trim() };
    });

    return {
      success: true,
      search_type: 'content',
      query,
      results,
      total: results.length,
      truncated: lines.length > maxResults,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Run Tests — execute DEC testCommand, enforce maxTestRunsPerTask limit
// ---------------------------------------------------------------------------

async function executeRunTests(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  // Enforce maxTestRunsPerTask cost limit
  // actions table has no taskId column; count via agentRuns.taskId → actions.agentRunId
  if (context.taskId) {
    const taskRunRows = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.taskId, context.taskId));
    const taskRunIds = taskRunRows.map(r => r.id);
    const runCount = taskRunIds.length
      ? await db
          .select({ total: count() })
          .from(actions)
          .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'run_tests')))
          .then(rows => Number(rows[0]?.total ?? 0))
      : 0;
    if (runCount >= devCtx.costLimits.maxTestRunsPerTask) {
      return {
        success: false,
        error: `Test run limit reached (${runCount}/${devCtx.costLimits.maxTestRunsPerTask} per task). Cannot run more tests for this task.`,
        errorCode: 'permission_failure',
      };
    }
  }

  const testFilter = input.test_filter ? String(input.test_filter) : undefined;
  const baseCommand = devCtx.testCommand;
  const command = testFilter ? `${baseCommand} ${testFilter}` : baseCommand;

  const [cmd, ...args] = command.split(' ');
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: devCtx.projectRoot,
      timeout: devCtx.resourceLimits.commandTimeoutMs,
      maxBuffer: devCtx.resourceLimits.maxOutputBytes,
      env: { ...process.env, ...devCtx.env },
    }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
      // Non-zero exit = test failures; still capture output
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    });

    const durationMs = Date.now() - start;
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(
      0,
      devCtx.resourceLimits.maxOutputBytes
    );
    const truncated = (stdout + stderr).length > devCtx.resourceLimits.maxOutputBytes;

    // Basic pass/fail detection from output
    const passed = /\d+ passed/.exec(output)?.[0] ?? null;
    const failed = /\d+ failed/.exec(output)?.[0] ?? null;

    return {
      success: true,
      command,
      output,
      truncated,
      duration_ms: durationMs,
      passed,
      failed,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Test execution failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Analyze Endpoint — HTTP request with timing and expected-status validation
// ---------------------------------------------------------------------------

async function executeAnalyzeEndpoint(
  input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const method = String(input.method ?? 'GET').toUpperCase();
  const expectedStatus = input.expected_status ? Number(input.expected_status) : undefined;
  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === 'object') {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }

  const start = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && input.body) {
      fetchOptions.body = String(input.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const durationMs = Date.now() - start;
    const bodyText = await response.text();
    const truncated = bodyText.length > 10000;
    const content = truncated ? bodyText.slice(0, 10000) : bodyText;

    const statusOk = expectedStatus !== undefined
      ? response.status === expectedStatus
      : response.ok;

    return {
      success: true,
      url,
      method,
      status_code: response.status,
      status_ok: statusOk,
      expected_status: expectedStatus,
      content,
      truncated,
      content_type: response.headers.get('content-type') ?? undefined,
      duration_ms: durationMs,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Endpoint analysis failed: ${errMsg}`, duration_ms: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Report Bug — create a structured board task with severity/confidence metadata
// ---------------------------------------------------------------------------

async function executeReportBug(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '').slice(0, MAX_TASK_TITLE_LENGTH);
  if (!title) return { success: false, error: 'title is required' };

  const description = input.description ? String(input.description).slice(0, MAX_TASK_DESCRIPTION_LENGTH) : undefined;
  const severity = String(input.severity ?? 'medium'); // low | medium | high | critical
  const confidence = Number(input.confidence ?? 0.8);
  const stepsToReproduce = input.steps_to_reproduce ? String(input.steps_to_reproduce) : undefined;
  const expectedBehavior = input.expected_behavior ? String(input.expected_behavior) : undefined;
  const actualBehavior = input.actual_behavior ? String(input.actual_behavior) : undefined;

  const brief = [
    description,
    stepsToReproduce ? `**Steps to reproduce:**\n${stepsToReproduce}` : null,
    expectedBehavior ? `**Expected:** ${expectedBehavior}` : null,
    actualBehavior ? `**Actual:** ${actualBehavior}` : null,
    `**Severity:** ${severity}`,
    `**Confidence:** ${(confidence * 100).toFixed(0)}%`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_TASK_DESCRIPTION_LENGTH);

  // Map severity to task priority
  const priorityMap: Record<string, string> = {
    critical: 'urgent',
    high: 'high',
    medium: 'normal',
    low: 'low',
  };
  const priority = (priorityMap[severity] ?? 'normal') as 'urgent' | 'high' | 'normal' | 'low';

  try {
    const task = await taskService.createTask(
      context.organisationId,
      context.subaccountId!,
      {
        title: `[BUG] ${title}`,
        description,
        brief,
        status: 'inbox',
        priority,
        createdByAgentId: context.agentId,
      }
    );

    await taskService.addActivity(task.id, context.organisationId, {
      activityType: 'note',
      message: `Bug reported by QA agent — severity: ${severity}, confidence: ${(confidence * 100).toFixed(0)}%`,
      agentId: context.agentId,
    });

    return {
      success: true,
      task_id: task.id,
      title: task.title,
      severity,
      confidence,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to report bug: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Capture Screenshot — launch headless browser, navigate, capture
// ---------------------------------------------------------------------------

async function executeCaptureScreenshot(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  if (!devCtx.playwright) {
    return {
      success: false,
      error: 'Playwright is not configured for this subaccount. Add a "playwright" section to devContext settings with at minimum a baseUrl.',
    };
  }

  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const reasoning = String(input.reasoning ?? '');
  if (!reasoning) return { success: false, error: 'reasoning is required' };

  const selector = input.selector ? String(input.selector) : null;
  const viewport = input.viewport as { width?: number; height?: number } | undefined;

  // Resolve screenshot output directory (must be inside projectRoot)
  const screenshotDirRelative = devCtx.playwright.screenshotDir;
  const screenshotDir = resolve(devCtx.projectRoot, screenshotDirRelative);
  assertPathInRoot(screenshotDir, devCtx.projectRoot);

  const timestamp = Date.now();
  const filename = `screenshot_${timestamp}.png`;
  const screenshotPath = join(screenshotDir, filename);

  try {
    const { mkdir } = await import('fs/promises');
    await mkdir(screenshotDir, { recursive: true });

    const playwright = await import('playwright');
    const browserType = playwright[devCtx.playwright.browser] ?? playwright.chromium;

    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewport?.width ?? 1280,
          height: viewport?.height ?? 720,
        },
      });

      page.setDefaultTimeout(devCtx.playwright.timeoutMs);

      await page.goto(url, { waitUntil: 'networkidle', timeout: devCtx.playwright.timeoutMs });

      let screenshotOptions: { path: string; fullPage?: boolean } = { path: screenshotPath };

      if (selector) {
        const element = await page.locator(selector).first();
        const box = await element.boundingBox();
        if (!box) return { success: false, error: `Selector "${selector}" found no visible element` };
        await element.screenshot({ path: screenshotPath });
      } else {
        screenshotOptions = { path: screenshotPath, fullPage: !viewport };
        await page.screenshot(screenshotOptions);
      }

      // Read back as base64 for inline delivery
      const { readFile } = await import('fs/promises');
      const imageBuffer = await readFile(screenshotPath);
      const base64 = imageBuffer.toString('base64');

      return {
        success: true,
        url,
        selector: selector ?? null,
        screenshot_path: screenshotPath.replace(devCtx.projectRoot, '').replace(/\\/g, '/'),
        screenshot_base64: `data:image/png;base64,${base64}`,
        size_bytes: imageBuffer.length,
        reasoning,
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Diagnose common failure: browsers not installed
    if (errMsg.includes('Executable doesn\'t exist') || errMsg.includes('browserType.launch')) {
      return {
        success: false,
        error: `Playwright browser binaries not installed. Run: npx playwright install ${devCtx.playwright.browser}. Original error: ${errMsg}`,
      };
    }
    return { success: false, error: `Screenshot failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Run Playwright Test — execute a specific Playwright test file via CLI
// ---------------------------------------------------------------------------

async function executeRunPlaywrightTest(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  if (!devCtx.playwright) {
    return {
      success: false,
      error: 'Playwright is not configured for this subaccount. Add a "playwright" section to devContext settings with at minimum a baseUrl.',
    };
  }

  // Enforce the same maxTestRunsPerTask limit as run_tests
  if (context.taskId) {
    const taskRunRows = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.taskId, context.taskId));
    const taskRunIds = taskRunRows.map(r => r.id);
    const runCount = taskRunIds.length
      ? await db
          .select({ total: count() })
          .from(actions)
          .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'run_playwright_test')))
          .then(rows => Number(rows[0]?.total ?? 0))
      : 0;
    if (runCount >= devCtx.costLimits.maxTestRunsPerTask) {
      return {
        success: false,
        error: `Playwright test run limit reached (${runCount}/${devCtx.costLimits.maxTestRunsPerTask} per task).`,
        errorCode: 'permission_failure',
      };
    }
  }

  const testFile = String(input.test_file ?? '');
  if (!testFile) return { success: false, error: 'test_file is required' };

  const baseUrl = String(input.base_url ?? devCtx.playwright.baseUrl);
  const testName = input.test_name ? String(input.test_name) : null;

  // Validate test file is inside projectRoot
  const absoluteTestPath = resolve(devCtx.projectRoot, testFile);
  assertPathInRoot(absoluteTestPath, devCtx.projectRoot);

  // Build the Playwright CLI command
  const args = ['playwright', 'test', testFile, '--reporter=line'];
  if (testName) args.push('--grep', testName);
  // Pass baseUrl via env so playwright.config.ts can pick it up
  const env = { ...process.env, ...devCtx.env, PLAYWRIGHT_BASE_URL: baseUrl, BASE_URL: baseUrl };

  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      cwd: devCtx.projectRoot,
      timeout: devCtx.playwright.timeoutMs * 3, // E2E tests take longer
      maxBuffer: devCtx.resourceLimits.maxOutputBytes,
      env,
    }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    });

    const durationMs = Date.now() - start;
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(0, devCtx.resourceLimits.maxOutputBytes);
    const truncated = (stdout + stderr).length > devCtx.resourceLimits.maxOutputBytes;

    const passed = /(\d+) passed/.exec(output)?.[1] ?? null;
    const failed = /(\d+) failed/.exec(output)?.[1] ?? null;
    const skipped = /(\d+) skipped/.exec(output)?.[1] ?? null;

    return {
      success: true,
      test_file: testFile,
      test_name: testName,
      base_url: baseUrl,
      output,
      truncated,
      duration_ms: durationMs,
      passed: passed ? Number(passed) : null,
      failed: failed ? Number(failed) : null,
      skipped: skipped ? Number(skipped) : null,
      all_passed: failed === null && passed !== null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('Executable doesn\'t exist') || errMsg.includes('browserType.launch')) {
      return {
        success: false,
        error: `Playwright browser binaries not installed. Run: npx playwright install ${devCtx.playwright.browser}. Original error: ${errMsg}`,
      };
    }
    return { success: false, error: `Playwright test execution failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Page infrastructure skills
// ---------------------------------------------------------------------------

async function executeCreatePage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const projectId = String(input.projectId ?? '');
  const slug = String(input.slug ?? '');
  const pageType = String(input.pageType ?? 'website') as 'website' | 'landing';
  if (!projectId || !slug) return { success: false, error: 'projectId and slug are required' };

  const { pageProjectService } = await import('./pageProjectService.js');
  const { pageService } = await import('./pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found' };

  const page = await pageService.create(
    {
      projectId,
      slug,
      pageType,
      title: input.title ? String(input.title) : undefined,
      html: input.html ? String(input.html) : '',
      meta: (input.meta as Record<string, unknown>) ?? undefined,
      formConfig: (input.formConfig as Record<string, unknown>) ?? undefined,
      createdByAgentId: context.agentId,
    },
    project.slug
  );

  return { success: true, pageId: page.id, previewUrl: page.previewUrl, status: 'draft' };
}

async function executeUpdatePage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageId = String(input.pageId ?? '');
  const projectId = String(input.projectId ?? '');
  if (!pageId || !projectId) return { success: false, error: 'pageId and projectId are required' };

  const { pageProjectService } = await import('./pageProjectService.js');
  const { pageService } = await import('./pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found' };

  const result = await pageService.update(
    pageId,
    projectId,
    {
      html: input.html ? String(input.html) : undefined,
      meta: input.meta as Record<string, unknown> | undefined,
      formConfig: input.formConfig as Record<string, unknown> | undefined,
      changeNote: input.changeNote ? String(input.changeNote) : undefined,
    },
    project.slug
  );

  return { success: true, pageId: result.id, previewUrl: result.previewUrl };
}

async function executePublishPage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageId = String(input.pageId ?? '');
  const projectId = String(input.projectId ?? '');
  if (!pageId || !projectId) return { success: false, error: 'pageId and projectId are required' };

  const { pageProjectService } = await import('./pageProjectService.js');
  const { pageService } = await import('./pageService.js');

  const project = await pageProjectService.getById(projectId, context.subaccountId!, context.organisationId);
  if (!project) return { success: false, error: 'Page project not found or access denied' };

  const page = await pageService.publish(pageId, projectId);

  return { success: true, pageId: page.id, status: page.status, publishedAt: page.publishedAt };
}

// ---------------------------------------------------------------------------
// Methodology skills — return a structured scaffold the LLM fills in.
// The actual reasoning is performed by the agent using its injected instructions.
// ---------------------------------------------------------------------------

function executeMethodologySkill(
  skillName: string,
  _input: Record<string, unknown>,
  scaffold: { template: Record<string, unknown>; guidance: string }
): { success: true; skillName: string; template: Record<string, unknown>; guidance: string } {
  return {
    success: true,
    skillName,
    template: scaffold.template,
    guidance: scaffold.guidance,
  };
}

// ─── Playbook Studio tool executors ──────────────────────────────────────────
// Spec: tasks/playbooks-spec.md §10.8.4 — the five tools the Playbook
// Author agent calls. All five delegate to playbookStudioService.
//
// Dynamic-imported on first call to avoid pulling the playbook services
// into the eager skillExecutor graph (which is loaded by every agent run).

async function executePlaybookReadExisting(
  input: Record<string, unknown>
): Promise<unknown> {
  const slug = String(input.slug ?? '');
  if (!slug) return { success: false, error: 'slug is required' };
  const { playbookStudioService } = await import('./playbookStudioService.js');
  try {
    return playbookStudioService.readExistingPlaybook(slug);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executePlaybookValidate(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const { playbookStudioService } = await import('./playbookStudioService.js');
  return playbookStudioService.validateCandidate(definition);
}

async function executePlaybookSimulate(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const { playbookStudioService } = await import('./playbookStudioService.js');
  return playbookStudioService.simulateRun(definition);
}

async function executePlaybookEstimateCost(
  input: Record<string, unknown>
): Promise<unknown> {
  const definition = input.definition;
  if (!definition) return { success: false, error: 'definition is required' };
  const mode = (input.mode as 'optimistic' | 'pessimistic' | undefined) ?? 'pessimistic';
  const { playbookStudioService } = await import('./playbookStudioService.js');
  return playbookStudioService.estimateCost(definition, { mode });
}

async function executePlaybookProposeSave(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // Definition-only API. The agent supplies the validated definition
  // object (NOT raw file contents) and the server renders the
  // .playbook.ts file deterministically. There is no input the agent
  // can use to inject arbitrary file content — that's the whole point
  // of spec invariant 14 in the post-round-3 design.
  const sessionId = String(input.sessionId ?? '');
  const definition = input.definition;
  if (!sessionId) {
    return { success: false, error: 'sessionId is required' };
  }
  if (!definition || typeof definition !== 'object') {
    return {
      success: false,
      error:
        'definition object is required. propose_save no longer accepts fileContents — the server renders the playbook file deterministically from the validated definition.',
    };
  }
  // Feature 3 §5.6 — high-severity gate for n8n imports.
  // If the caller passes unresolved_high_severity_count > 0, the import
  // session still has unacknowledged high-severity mapping items (disconnected
  // nodes, unconvertible code/function nodes). Block until the admin resolves
  // or explicitly dismisses each item.
  if (
    typeof input.unresolved_high_severity_count === 'number' &&
    input.unresolved_high_severity_count > 0
  ) {
    return {
      success: false,
      error: `Cannot save: ${input.unresolved_high_severity_count} high-severity item(s) from the n8n import are unresolved. Review the ⚠ rows in the mapping report, resolve or explicitly dismiss each one with the admin, then call playbook_propose_save again with unresolved_high_severity_count: 0.`,
    };
  }
  // Strict user-scope enforcement (review finding #3 from the previous
  // round). The agent run's initiating principal MUST be present on the
  // SkillExecutionContext; if it's missing (e.g. a scheduled / system
  // run that has no user identity), we refuse to write to user-owned
  // session rows.
  if (!context.userId) {
    return {
      success: false,
      error:
        'playbook_propose_save requires a user-scoped agent run. The current run has no userId on its SkillExecutionContext (likely a scheduled or system run). Studio sessions can only be modified by their owners.',
    };
  }
  const { playbookStudioService } = await import('./playbookStudioService.js');
  // Validate + render in one call. This re-uses the exact same code
  // path the /render endpoint uses, so the server's view of the
  // canonical file body is consistent everywhere.
  const rendered = playbookStudioService.validateAndRender(definition);
  if (!rendered.ok) {
    return {
      success: false,
      error: 'Definition failed validation',
      validationErrors: rendered.errors,
    };
  }
  // Persist the rendered file as the session's candidate, scoped by
  // (sessionId, userId). Returns false when the session doesn't exist
  // OR isn't owned by the calling user.
  const updated = await playbookStudioService.updateCandidate(
    sessionId,
    context.userId,
    rendered.fileContents,
    'valid'
  );
  if (!updated) {
    return {
      success: false,
      error:
        'Session not found or not owned by the calling user. The agent can only update its own session.',
    };
  }
  return {
    success: true,
    message:
      'Candidate rendered and recorded. The human admin must click Save & Open PR in the Studio UI to commit this file via their GitHub identity.',
    sessionId,
    definitionHash: rendered.definitionHash,
  };
}

// ---------------------------------------------------------------------------
// Feature 3 — n8n Workflow Import (admin-callable Studio skill)
// ---------------------------------------------------------------------------

async function executeImportN8nWorkflow(
  input: Record<string, unknown>,
): Promise<unknown> {
  const { importN8nWorkflow, renderMappingReport } = await import('./n8nImportServicePure.js');

  const workflowJsonRaw = input.workflow_json;
  if (!workflowJsonRaw || typeof workflowJsonRaw !== 'string') {
    return { success: false, error: 'workflow_json is required and must be a string' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(workflowJsonRaw);
  } catch {
    return { success: false, error: 'workflow_json is not valid JSON. Paste the full exported n8n workflow JSON.' };
  }

  const result = importN8nWorkflow(parsed);
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  const reportMarkdown = renderMappingReport(result.report);
  const highSeverityCount = result.report.filter(
    (r) => r.warning?.severity === 'high',
  ).length;

  return {
    success: true,
    workflowName: result.workflowName,
    steps: result.steps,
    report: reportMarkdown,
    credentialChecklist: result.credentialChecklist,
    highSeverityCount,
    summary: `Imported "${result.workflowName}": ${result.steps.length} steps, ${highSeverityCount} high-severity items requiring resolution before save.`,
  };
}
