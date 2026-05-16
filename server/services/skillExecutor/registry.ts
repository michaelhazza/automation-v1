import type { SkillExecutionContext, SkillHandler } from './context.js';
import type { HandlerContext } from '../handlerContextTypes.js';
import { requireSubaccountContext } from './context.js';
import { tryEmitAgentEvent } from '../agentExecutionEventEmitter.js';
import { executeWithActionAudit, proposeReviewGatedAction } from './gating.js';
import {
  executeWebSearch,
  executeFetchUrl,
  executeScrapeUrl,
  executeScrapeStructured,
  executeMonitorWebpage,
  executeCaptureScreenshot,
  executeRunPlaywrightTest,
  executeAnalyzeEndpoint,
} from './handlers/web.js';
import {
  executeReadWorkspace,
  executeWriteWorkspace,
} from './handlers/workspace.js';
import {
  executeCreateTask,
  executeTriageIntake,
  executeMoveTask,
  executeAddDeliverable,
  executeUpdateTask,
  executeReassignTask,
  executeReadInbox,
  executeReportBug,
} from './handlers/tasks.js';
import {
  executeSpawnSubAgents,
  executeTriggerProcess,
} from './handlers/handoff.js';
import {
  executeReadCodebase,
  executeSearchCodebase,
  executeRunTests,
  proposeDevopsAction,
} from './handlers/devContext.js';
import {
  executeWorkflowReadExisting,
  executeWorkflowValidate,
  executeWorkflowSimulate,
  executeWorkflowEstimateCost,
  executeWorkflowProposeSave,
  executeImportN8nWorkflow,
} from './handlers/workflowStudio.js';
import { skillStudioHandlers } from './handlers/skillStudio.js';
import { methodologyStubHandlers } from './handlers/methodologyStubs.js';
import { autoGatedStubHandlers } from './handlers/autoGatedStubs.js';
import { reviewGatedProposerHandlers } from './handlers/reviewGatedProposers.js';
import { thinDispatcherHandlers } from './handlers/thinDispatchers.js';
import { systemMonitorShellHandlers } from './handlers/systemMonitorShells.js';
import { optimiserShellHandlers } from './handlers/optimiserShells.js';
import { spendShellHandlers } from './handlers/spendShells.js';
import { configShellHandlers } from './handlers/configShells.js';
import { memoryHandlers } from './handlers/memory.js';
import { supportHandlers } from './handlers/support.js';
import { calendarHandlers } from './handlers/calendar.js';
import { slackHandlers } from './handlers/slack.js';
import { metaHandlers } from './handlers/meta.js';
import { capabilityDiscoveryHandlers } from './handlers/capabilityDiscovery.js';
import { crmHandlers } from './handlers/crm.js';
import { orgInsightHandlers } from './handlers/orgInsights.js';
import { outputHandlers } from './handlers/output.js';
import { threadContextHandlers } from './handlers/threadContext.js';
import { notifyOperatorHandlers } from './handlers/notifyOperator.js';
import { mediaTranscriptionHandlers } from './handlers/mediaTranscription.js';
import { digestHandlers } from './handlers/digest.js';
import { memoryBlockHandlers } from './handlers/memoryBlock.js';
import { financialReportingHandlers } from './handlers/financialReporting.js';

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
  /**
   * Injected handler context. Required for skills that cross the
   * skillExecutor <-> workflowEngine boundary (e.g. workflow.run.start).
   * Callers without handlerContext wired yet (pre-Chunk-4) must not invoke
   * those skills. Chunk 4 makes this required for all entry points.
   */
  handlerContext?: HandlerContext;
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
 * Registry of skill handlers keyed by skill name. The `skillExecutor.execute`
 * method dispatches to an entry here after handling the MCP prefix and the
 * toolCallId stash. Previously this was a 770-line switch statement; it now
 * lives as a module-level constant so other modules (notably the
 * skill-analyzer) can enumerate the supported skill names without having to
 * parse source code.
 */
export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  // ── Meta tools — BM25 tool discovery (no action record) ─────────────
  ...metaHandlers,

  // ── Direct skills (no action record) ──────────────────────────────
  web_search: async (input, context, _handlerContext) => {
    return executeWebSearch(input, context);
  },
  read_workspace: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'read_workspace');
    return executeReadWorkspace(input, context);
  },
  write_workspace: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'write_workspace');
    return executeWriteWorkspace(input, context);
  },
  // ── Memory skills ─────────────────────────────────────────────────────────
  ...memoryHandlers,
  // ── Skill Studio skills (Feature 3) ──────────────────────────────────
  ...skillStudioHandlers,
  // ── Methodology skills — LLM-guided scaffold handlers ─────────────────
  ...methodologyStubHandlers,
  // ── Auto-gated stubs — unwired integrations returning {status:'stub'} ──
  ...autoGatedStubHandlers,
  // ── Review-gated proposers — single-line proposeReviewGatedAction wraps ─
  ...reviewGatedProposerHandlers,
  // ── Thin dispatchers — dynamic-import forwarding (none remain post-split) ─
  ...thinDispatcherHandlers,
  // ── System Monitor shells ─────────────────────────────────────────────────
  ...systemMonitorShellHandlers,
  // ── Optimiser shells ─────────────────────────────────────────────────────
  ...optimiserShellHandlers,
  // ── Spend shells ──────────────────────────────────────────────────────────
  ...spendShellHandlers,
  // ── Config shells ────────────────────────────────────────────────────────
  ...configShellHandlers,
  trigger_process: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'trigger_process');
    return executeTriggerProcess(input, context);
  },
  spawn_sub_agents: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'spawn_sub_agents');
    return executeSpawnSubAgents(input, context);
  },

  // ── Auto-gated skills (action record for audit, executes synchronously) ──
  create_task: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'create_task');
    return executeWithActionAudit('create_task', input, context, () => executeCreateTask(input, context));
  },
  triage_intake: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'triage_intake');
    return executeWithActionAudit('triage_intake', input, context, () => executeTriageIntake(input, context));
  },
  move_task: async (input, context, _handlerContext) => {
    return executeWithActionAudit('move_task', input, context, () => executeMoveTask(input, context));
  },
  add_deliverable: async (input, context, _handlerContext) => {
    return executeWithActionAudit('add_deliverable', input, context, () => executeAddDeliverable(input, context));
  },
  reassign_task: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'reassign_task');
    return executeWithActionAudit('reassign_task', input, context, () => executeReassignTask(input, context));
  },
  update_task: async (input, context, _handlerContext) => {
    return executeWithActionAudit('update_task', input, context, () => executeUpdateTask(input, context));
  },
  read_inbox: async (input, context, _handlerContext) => {
    return executeWithActionAudit('read_inbox', input, context, () => executeReadInbox(input, context));
  },
  fetch_url: async (input, context, _handlerContext) => {
    return executeWithActionAudit('fetch_url', input, context, () => executeFetchUrl(input, context));
  },
  scrape_url: async (input, context, _handlerContext) => {
    return executeWithActionAudit('scrape_url', input, context, () => executeScrapeUrl(input, context));
  },
  scrape_structured: async (input, context, _handlerContext) => {
    return executeWithActionAudit('scrape_structured', input, context, () => executeScrapeStructured(input, context));
  },
  monitor_webpage: async (input, context, _handlerContext) => {
    return executeWithActionAudit('monitor_webpage', input, context, () => executeMonitorWebpage(input, context));
  },

  // ── Workflow Studio tools (system-admin only; agent: Workflow-author) ──
  workflow_read_existing: async (input, _context, _handlerContext) => {
    return executeWorkflowReadExisting(input);
  },
  workflow_validate: async (input, _context, _handlerContext) => {
    return executeWorkflowValidate(input);
  },
  workflow_simulate: async (input, _context, _handlerContext) => {
    return executeWorkflowSimulate(input);
  },
  workflow_estimate_cost: async (input, _context, _handlerContext) => {
    return executeWorkflowEstimateCost(input);
  },
  workflow_propose_save: async (input, context, _handlerContext) => {
    return executeWorkflowProposeSave(input, context);
  },
  import_n8n_workflow: async (input, _context, _handlerContext) => {
    return executeImportN8nWorkflow(input);
  },
  'workflow.run.start': async (input, context, handlerContext) => {
    if (!handlerContext) {
      return { success: false, error: 'workflow.run.start requires handlerContext (wired at Chunk 4)' };
    }
    return handlerContext.workflowEngine.startWorkflowRun(input, context);
  },

  // ── Dev/QA auto-gated skills (all require subaccount context) ─────────
  read_codebase: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'read_codebase');
    return executeWithActionAudit('read_codebase', input, context, () => executeReadCodebase(input, context));
  },
  search_codebase: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'search_codebase');
    return executeWithActionAudit('search_codebase', input, context, () => executeSearchCodebase(input, context));
  },
  run_tests: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'run_tests');
    return executeWithActionAudit('run_tests', input, context, () => executeRunTests(input, context));
  },
  analyze_endpoint: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'analyze_endpoint');
    return executeWithActionAudit('analyze_endpoint', input, context, () => executeAnalyzeEndpoint(input, context));
  },
  report_bug: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'report_bug');
    return executeWithActionAudit('report_bug', input, context, () => executeReportBug(input, context));
  },
  capture_screenshot: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'capture_screenshot');
    return executeWithActionAudit('capture_screenshot', input, context, () => executeCaptureScreenshot(input, context));
  },
  run_playwright_test: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'run_playwright_test');
    return executeWithActionAudit('run_playwright_test', input, context, () => executeRunPlaywrightTest(input, context));
  },

  // ── Dev review-gated skills (safeMode-checked, require subaccount) ───
  write_patch: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'write_patch');
    return proposeDevopsAction('write_patch', input, context);
  },
  run_command: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'run_command');
    return proposeDevopsAction('run_command', input, context);
  },
  create_pr: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'create_pr');
    return proposeDevopsAction('create_pr', input, context);
  },

  // ── Page infrastructure skills (require subaccount) ────────────────
  create_page: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'create_page');
    return proposeReviewGatedAction('create_page', input, context);
  },
  update_page: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'update_page');
    return proposeReviewGatedAction('update_page', input, context);
  },
  publish_page: async (input, context, _handlerContext) => {
    requireSubaccountContext(context, 'publish_page');
    return proposeReviewGatedAction('publish_page', input, context);
  },

  // ── Support handlers ─────────────────────────────────────────────────────
  ...supportHandlers,

  // ── Calendar and Slack handlers ───────────────────────────────────────────
  ...calendarHandlers,
  ...slackHandlers,

  // ── CRM handlers ──────────────────────────────────────────────────────────
  ...crmHandlers,

  // ── Org Insights handlers ─────────────────────────────────────────────────
  ...orgInsightHandlers,

  // ── Output handlers ───────────────────────────────────────────────────────
  ...outputHandlers,

  // ── Thread context handler ────────────────────────────────────────────────
  ...threadContextHandlers,

  // ── Notify operator handler ───────────────────────────────────────────────
  ...notifyOperatorHandlers,

  // ── Media transcription handlers ──────────────────────────────────────────
  ...mediaTranscriptionHandlers,

  // ── Digest handlers ───────────────────────────────────────────────────────
  ...digestHandlers,

  // ── Memory block handlers ─────────────────────────────────────────────────
  ...memoryBlockHandlers,

  // ── Financial reporting handlers ──────────────────────────────────────────
  ...financialReportingHandlers,

  // ── Capability discovery handlers ─────────────────────────────────────────
  ...capabilityDiscoveryHandlers,
};

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context, handlerContext, toolCallId } = params;
    // Stash the current tool call id on the context so the per-case
    // action wrappers below can build the same deterministic idempotency
    // key that proposeActionMiddleware wrote for this call (Sprint 2 P1.1
    // Layer 3). Mutation is safe — the context is scoped to one run and
    // one tool call at a time.
    if (toolCallId !== undefined) {
      context.toolCallId = toolCallId;
    }

    // ── LAEL Phase 1 Chunk 3: skill.invoked + skill.completed emissions ──────
    // Emit before all dispatch paths (MCP and regular handlers).
    // Skip silently when runId is absent (diagnostic / test runs with no log row).
    if (context.runId != null) {
      tryEmitAgentEvent({
        runId:          context.runId,
        organisationId: context.organisationId,
        subaccountId:   context.subaccountId,
        sourceService:  'skillExecutor',
        payload: {
          eventType:  'skill.invoked',
          critical:   false,
          skillSlug:  skillName,
          skillName:  skillName,
          input,
          // reviewed and actionId not available at the dispatch layer;
          // the gating layer owns those values.
          reviewed:   false,
          actionId:   undefined,
        },
        linkedEntity: null,
      });
    }

    const invokedAt = Date.now();
    let completedStatus: 'ok' | 'error' = 'ok';
    let completedResultSummary = 'success';
    let completedErrorCode: string | undefined;

    try {
      // MCP tool dispatch — tool slugs start with "mcp."
      if (skillName.startsWith('mcp.') && context._mcpClients) {
        const { mcpClientManager } = await import('../mcpClientManager.js');
        return await mcpClientManager.callTool(
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

      return await handler(input, context, handlerContext as HandlerContext);
    } catch (err: unknown) {
      completedStatus = 'error';
      completedResultSummary = err instanceof Error ? err.message : String(err);
      completedErrorCode =
        err != null && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
          ? (err as { code: string }).code
          : err instanceof Error
            ? err.name
            : undefined;
      throw err;
    } finally {
      if (context.runId != null) {
        const durationMs = Date.now() - invokedAt;
        tryEmitAgentEvent({
          runId:          context.runId,
          organisationId: context.organisationId,
          subaccountId:   context.subaccountId,
          sourceService:  'skillExecutor',
          payload: {
            eventType:     'skill.completed',
            critical:      false,
            skillSlug:     skillName,
            durationMs,
            status:        completedStatus,
            resultSummary: completedResultSummary,
            ...(completedErrorCode !== undefined ? { errorCode: completedErrorCode } : {}),
          },
          linkedEntity: null,
        });
      }
    }
  },
};
