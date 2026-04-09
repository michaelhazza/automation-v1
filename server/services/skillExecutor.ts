import { eq, and, isNull, count, inArray } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { glob } from 'glob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env } from '../lib/env.js';
import { createSpan, createEvent } from '../lib/tracing.js';
import { TripWire } from '../lib/tripwire.js';
import type { ProcessorHooks, ProcessorContext } from '../types/processor.js';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentRuns, tasks, actions } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { executeTriggerredProcess } from './llmService.js';
import { agentExecutionService } from './agentExecutionService.js';
import { actionService } from './actionService.js';
import { executionLayerService, registerAdapter } from './executionLayerService.js';
import { reviewService } from './reviewService.js';
import { hitlService } from './hitlService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import { devContextService, assertPathInRoot } from './devContextService.js';
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
    default: return { success: false, error: `No worker handler for: ${actionType}` };
  }
}));

// ---------------------------------------------------------------------------
// Skill Executor — executes tool calls for autonomous agent runs
// ---------------------------------------------------------------------------

export interface SkillExecutionContext {
  runId: string;
  organisationId: string;
  /** Null for org-level agent runs */
  subaccountId: string | null;
  agentId: string;
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
}

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
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

import { failure, FailureError } from '../../shared/iee/failure.js';

function applyOnFailure(toolSlug: string, err: unknown, _input: Record<string, unknown>): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive = actionDef?.onFailure ?? 'retry';

  switch (directive) {
    case 'skip':
      return {
        success: false,
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    case 'fail_run':
      throw new FailureError(failure(
        'execution_error',
        `${toolSlug}: ${err instanceof Error ? err.message : String(err)}`,
        { toolSlug, source: 'onFailure:fail_run' },
      ));
    case 'fallback':
      return {
        success: true,
        usedFallback: true,
        value: actionDef?.fallbackValue,
      };
    case 'retry':
    default:
      // Propagate — let the caller's retry logic handle it.
      throw err;
  }
}

function applyOnFailureForStructuredFailure(
  toolSlug: string,
  result: Record<string, unknown>,
): unknown {
  const actionDef = getActionDefinition(toolSlug);
  const directive = actionDef?.onFailure ?? 'retry';

  switch (directive) {
    case 'skip':
      return {
        success: false,
        skipped: true,
        reason: String(result.error ?? 'skill returned success: false'),
      };
    case 'fail_run':
      throw new FailureError(failure(
        'execution_error',
        `${toolSlug}: ${String(result.error ?? 'structured failure')}`,
        { toolSlug, source: 'onFailure:fail_run' },
      ));
    case 'fallback':
      return {
        success: true,
        usedFallback: true,
        value: actionDef?.fallbackValue,
      };
    case 'retry':
    default:
      return result; // unchanged — pass the structured failure to the caller
  }
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
    return applyOnFailure(toolSlug, err, processedInput);
  }

  // Successful return value but the executor signalled a structured failure.
  // Apply onFailure here too so 'skip' / 'fallback' fire on either error path.
  if (
    result !== null &&
    typeof result === 'object' &&
    (result as { success?: unknown }).success === false
  ) {
    const directive = getActionDefinition(toolSlug)?.onFailure;
    if (directive && directive !== 'retry') {
      return applyOnFailureForStructuredFailure(toolSlug, result as Record<string, unknown>);
    }
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

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context } = params;

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
          taskId: context.taskId,
          mcpCallCount: context.mcpCallCount,
        },
      );
    }

    switch (skillName) {
      // ── Meta tools — BM25 tool discovery (no action record) ─────────────
      case 'search_tools': {
        const { executeSearchTools } = await import('../tools/meta/searchTools.js');
        return executeSearchTools(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
      }
      case 'load_tool': {
        const { executeLoadTool } = await import('../tools/meta/searchTools.js');
        return executeLoadTool(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
      }

      // ── Direct skills (no action record) ──────────────────────────────
      case 'web_search':
        return executeWebSearch(input, context);
      case 'read_workspace': {
        requireSubaccountContext(context, 'read_workspace');
        return executeReadWorkspace(input, context);
      }
      case 'write_workspace': {
        requireSubaccountContext(context, 'write_workspace');
        return executeWriteWorkspace(input, context);
      }
      case 'trigger_process': {
        requireSubaccountContext(context, 'trigger_process');
        return executeTriggerProcess(input, context);
      }
      case 'spawn_sub_agents': {
        requireSubaccountContext(context, 'spawn_sub_agents');
        return executeSpawnSubAgents(input, context);
      }

      // ── Context data source retrieval (spec §8.2) ────────────────────────
      case 'read_data_source': {
        const { executeReadDataSource } = await import('../tools/readDataSource.js');
        return executeReadDataSource(input, context);
      }

      // ── Auto-gated skills (action record for audit, executes synchronously) ──
      case 'create_task': {
        requireSubaccountContext(context, 'create_task');
        return executeWithActionAudit('create_task', input, context, () => executeCreateTask(input, context));
      }
      case 'move_task':
        return executeWithActionAudit('move_task', input, context, () => executeMoveTask(input, context));
      case 'add_deliverable':
        return executeWithActionAudit('add_deliverable', input, context, () => executeAddDeliverable(input, context));
      case 'reassign_task': {
        requireSubaccountContext(context, 'reassign_task');
        return executeWithActionAudit('reassign_task', input, context, () => executeReassignTask(input, context));
      }
      case 'update_task':
        return executeWithActionAudit('update_task', input, context, () => executeUpdateTask(input, context));
      case 'read_inbox':
        return executeWithActionAudit('read_inbox', input, context, () => executeReadInbox(input, context));
      case 'fetch_url':
        return executeWithActionAudit('fetch_url', input, context, () => executeFetchUrl(input, context));

      // ── Playbook Studio tools (system-admin only; agent: playbook-author) ──
      case 'playbook_read_existing':
        return executePlaybookReadExisting(input);
      case 'playbook_validate':
        return executePlaybookValidate(input);
      case 'playbook_simulate':
        return executePlaybookSimulate(input);
      case 'playbook_estimate_cost':
        return executePlaybookEstimateCost(input);
      case 'playbook_propose_save':
        return executePlaybookProposeSave(input, context);

      // ── Review-gated skills (proposes action, does NOT execute immediately) ──
      case 'send_email':
        return proposeReviewGatedAction('send_email', input, context);
      case 'update_record':
        return proposeReviewGatedAction('update_record', input, context);
      case 'request_approval':
        return proposeReviewGatedAction('request_approval', input, context);

      // ── Dev/QA auto-gated skills (all require subaccount context) ─────────
      case 'read_codebase': {
        requireSubaccountContext(context, 'read_codebase');
        return executeWithActionAudit('read_codebase', input, context, () => executeReadCodebase(input, context));
      }
      case 'search_codebase': {
        requireSubaccountContext(context, 'search_codebase');
        return executeWithActionAudit('search_codebase', input, context, () => executeSearchCodebase(input, context));
      }
      case 'run_tests': {
        requireSubaccountContext(context, 'run_tests');
        return executeWithActionAudit('run_tests', input, context, () => executeRunTests(input, context));
      }
      case 'analyze_endpoint': {
        requireSubaccountContext(context, 'analyze_endpoint');
        return executeWithActionAudit('analyze_endpoint', input, context, () => executeAnalyzeEndpoint(input, context));
      }
      case 'report_bug': {
        requireSubaccountContext(context, 'report_bug');
        return executeWithActionAudit('report_bug', input, context, () => executeReportBug(input, context));
      }
      case 'capture_screenshot': {
        requireSubaccountContext(context, 'capture_screenshot');
        return executeWithActionAudit('capture_screenshot', input, context, () => executeCaptureScreenshot(input, context));
      }
      case 'run_playwright_test': {
        requireSubaccountContext(context, 'run_playwright_test');
        return executeWithActionAudit('run_playwright_test', input, context, () => executeRunPlaywrightTest(input, context));
      }

      // ── Dev review-gated skills (safeMode-checked, require subaccount) ───
      case 'write_patch': {
        requireSubaccountContext(context, 'write_patch');
        return proposeDevopsAction('write_patch', input, context);
      }
      case 'run_command': {
        requireSubaccountContext(context, 'run_command');
        return proposeDevopsAction('run_command', input, context);
      }
      case 'create_pr': {
        requireSubaccountContext(context, 'create_pr');
        return proposeDevopsAction('create_pr', input, context);
      }

      // ── Page infrastructure skills (require subaccount) ────────────────
      case 'create_page': {
        requireSubaccountContext(context, 'create_page');
        return proposeReviewGatedAction('create_page', input, context);
      }
      case 'update_page': {
        requireSubaccountContext(context, 'update_page');
        return proposeReviewGatedAction('update_page', input, context);
      }
      case 'publish_page': {
        requireSubaccountContext(context, 'publish_page');
        return proposeReviewGatedAction('publish_page', input, context);
      }

      // ── Methodology skills — LLM-guided reasoning; executor returns a
      //    structured scaffold the agent fills using the injected instructions ─
      case 'draft_architecture_plan':
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
      case 'draft_tech_spec':
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
      case 'review_ux':
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
      case 'review_code':
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
      case 'write_tests':
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

      // ── Phase 2: Workflow orchestration ──────────────────────────────────
      case 'assign_task': {
        const { executeAssignTask } = await import('../tools/internal/assignTask.js');
        return executeWithActionAudit('assign_task', input, context, () =>
          executeAssignTask(input, { runId: context.runId, organisationId: context.organisationId, subaccountId: context.subaccountId!, agentId: context.agentId }),
        );
      }

      // ── Phase 3: Cross-subaccount intelligence skills ───────────────────
      case 'query_subaccount_cohort': {
        const { executeQuerySubaccountCohort } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('query_subaccount_cohort', input, context, () =>
          executeQuerySubaccountCohort(input, context));
      }
      case 'read_org_insights': {
        const { executeReadOrgInsights } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('read_org_insights', input, context, () =>
          executeReadOrgInsights(input, context));
      }
      case 'write_org_insight': {
        const { executeWriteOrgInsight } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('write_org_insight', input, context, () =>
          executeWriteOrgInsight(input, context));
      }
      case 'compute_health_score': {
        const { executeComputeHealthScore } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('compute_health_score', input, context, () =>
          executeComputeHealthScore(input, context));
      }
      case 'detect_anomaly': {
        const { executeDetectAnomaly } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('detect_anomaly', input, context, () =>
          executeDetectAnomaly(input, context));
      }
      case 'compute_churn_risk': {
        const { executeComputeChurnRisk } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('compute_churn_risk', input, context, () =>
          executeComputeChurnRisk(input, context));
      }
      case 'generate_portfolio_report': {
        const { executeGeneratePortfolioReport } = await import('./intelligenceSkillExecutor.js');
        return executeWithActionAudit('generate_portfolio_report', input, context, () =>
          executeGeneratePortfolioReport(input, context));
      }
      case 'trigger_account_intervention':
        return proposeReviewGatedAction('trigger_account_intervention', input, context);

      // ── 42 Macro analysis (custom prompt skill, scoped to Breakout Solutions) ──
      case 'analyse_42macro_transcript':
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

      // ── Reporting Agent paywall workflow skills ───────────────────────────
      // Spec: docs/reporting-agent-paywall-workflow-spec.md §4 / Code Change B
      case 'transcribe_audio': {
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
      }
      // Spec: docs/reporting-agent-paywall-workflow-spec.md §6 / Code Change D
      case 'fetch_paywalled_content': {
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
      }
      // Spec: docs/reporting-agent-paywall-workflow-spec.md §5 / Code Change C
      case 'send_to_slack': {
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
      }

      default:
        return { success: false, error: `Unknown skill: ${skillName}` };
    }
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
  const idempotencyKey = `${actionType}:${context.runId}:${Date.now()}`;
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

  const keyParts = [actionType, context.subaccountId ?? `org:${context.organisationId}`];
  if (input.thread_id) keyParts.push(String(input.thread_id));
  if (input.record_id) keyParts.push(String(input.record_id));
  keyParts.push(String(Date.now()));
  const idempotencyKey = keyParts.join(':');

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
    const activity = await taskService.addActivity(taskId, {
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
    const deliverable = await taskService.addDeliverable(taskId, {
      deliverableType,
      title,
      description: description || undefined,
    });

    // Also log an activity
    await taskService.addActivity(taskId, {
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

    await taskService.addActivity(taskId, {
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
    }).where(eq(tasks.id, taskId));

    await taskService.addActivity(taskId, {
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
            executionScope: context.subaccountId ? 'subaccount' : 'org',
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

    await taskService.addActivity(task.id, {
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
