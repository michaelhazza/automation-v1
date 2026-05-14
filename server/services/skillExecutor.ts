import { taskService } from './taskService.js';
import { registerAdapter } from './executionLayerService.js';
import { resolveActionSlug } from '../config/actionRegistry.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';
import * as priorityFeedService from './priorityFeedService.js';

// ---------------------------------------------------------------------------
// Register worker adapter for execution layer (handles review-gated worker actions)
// ---------------------------------------------------------------------------
import { createWorkerAdapter } from './adapters/workerAdapter.js';
import { updateThreadContextHandler } from '../actions/updateThreadContext.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import type { SkillExecutionContext, SkillHandler } from './skillExecutor/context.js';
export type { SkillExecutionContext, SkillHandler };
import { requireSubaccountContext } from './skillExecutor/context.js';

registerAdapter('worker', createWorkerAdapter(async (rawActionType, payload, ctx) => {
  const context = ctx as unknown as SkillExecutionContext;
  // actionRegistry §1.3: every inbound action-slug surface MUST normalise via
  // resolveActionSlug so legacy slugs (e.g. config_update_hierarchy_template,
  // clientpulse.operator_alert) route to the current canonical handler. Without
  // this call, any review-gated action queued before the Session 1 renames is
  // silently dropped at the worker dispatch switch.
  const actionType = resolveActionSlug(rawActionType);
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

    // ── Phase 4.5 — config_update_organisation_config approval-execute ─────
    // When the operator approves a sensitive-path config change, re-validate
    // (drift check) and commit the merge + config_history row (B5 ship gate).
    case 'config_update_organisation_config': {
      const { executeApprovedOrganisationConfigUpdate } = await import('./configUpdateOrganisationService.js');
      const actionId = (ctx as unknown as { actionId?: string }).actionId ?? '';
      const result = await executeApprovedOrganisationConfigUpdate({
        actionId,
        organisationId: context.organisationId,
      });
      if (!result.success) {
        throw new Error(`${result.errorCode}: ${result.message}`);
      }
      return result;
    }

    // ── Session 2 — notify_operator fan-out (spec §7.3) ──────────────────
    case 'notify_operator': {
      const fanoutModule = await import('./notifyOperatorFanoutService.js');
      const alertPayload = payload as unknown as import('./notifyOperatorFanoutService.js').OperatorAlertPayload;
      const actionId = (context as unknown as { actionId?: string }).actionId ?? '';
      const fanoutResults = await fanoutModule.fanoutOperatorAlert({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        actionId,
        payload: alertPayload,
      });
      return {
        queued: true,
        channels: alertPayload.channels,
        fanoutResults,
      };
    }

    default: return { success: false, error: `No worker handler for: ${actionType}` };
  }
}));

// ---------------------------------------------------------------------------
// Skill Executor — executes tool calls for autonomous agent runs
// ---------------------------------------------------------------------------

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

export { registerProcessor, setHandoffJobSender } from './skillExecutor/pipeline.js';
import { executeWithActionAudit, proposeReviewGatedAction } from './skillExecutor/gating.js';
import {
  executeWebSearch,
  executeFetchUrl,
  executeScrapeUrl,
  executeScrapeStructured,
  executeMonitorWebpage,
  executeCaptureScreenshot,
  executeRunPlaywrightTest,
  executeAnalyzeEndpoint,
} from './skillExecutor/handlers/web.js';
import {
  executeReadWorkspace,
  executeWriteWorkspace,
} from './skillExecutor/handlers/workspace.js';
import {
  executeCreateTask,
  executeTriageIntake,
  executeMoveTask,
  executeAddDeliverable,
  executeUpdateTask,
  executeReassignTask,
  executeReadInbox,
  executeReportBug,
} from './skillExecutor/handlers/tasks.js';
import {
  executeSpawnSubAgents,
  executeTriggerProcess,
} from './skillExecutor/handlers/handoff.js';
import {
  executeReadCodebase,
  executeSearchCodebase,
  executeRunTests,
  proposeDevopsAction,
} from './skillExecutor/handlers/devContext.js';
import {
  executeCreatePage,
  executeUpdatePage,
  executePublishPage,
} from './skillExecutor/handlers/pages.js';
import {
  executeWorkflowReadExisting,
  executeWorkflowValidate,
  executeWorkflowSimulate,
  executeWorkflowEstimateCost,
  executeWorkflowProposeSave,
  executeImportN8nWorkflow,
  executeWorkflowRunStart,
} from './skillExecutor/handlers/workflowStudio.js';
import { skillStudioHandlers } from './skillExecutor/handlers/skillStudio.js';
import { methodologyStubHandlers } from './skillExecutor/handlers/methodologyStubs.js';
import { autoGatedStubHandlers } from './skillExecutor/handlers/autoGatedStubs.js';
import { reviewGatedProposerHandlers } from './skillExecutor/handlers/reviewGatedProposers.js';
import { thinDispatcherHandlers } from './skillExecutor/handlers/thinDispatchers.js';

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
  ...skillStudioHandlers,
  // ── Methodology skills — LLM-guided scaffold handlers ─────────────────
  ...methodologyStubHandlers,
  // ── Auto-gated stubs — unwired integrations returning {status:'stub'} ──
  ...autoGatedStubHandlers,
  // ── Review-gated proposers — single-line proposeReviewGatedAction wraps ─
  ...reviewGatedProposerHandlers,
  // ── Thin dispatchers — dynamic-import forwarding (none remain post-split) ─
  ...thinDispatcherHandlers,
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

  // ── Workflow Studio tools (system-admin only; agent: Workflow-author) ──
  workflow_read_existing: async (input) => {
    return executeWorkflowReadExisting(input);
  },
  workflow_validate: async (input) => {
    return executeWorkflowValidate(input);
  },
  workflow_simulate: async (input) => {
    return executeWorkflowSimulate(input);
  },
  workflow_estimate_cost: async (input) => {
    return executeWorkflowEstimateCost(input);
  },
  workflow_propose_save: async (input, context) => {
    return executeWorkflowProposeSave(input, context);
  },
  import_n8n_workflow: async (input) => {
    return executeImportN8nWorkflow(input);
  },
  'workflow.run.start': async (input, context) => {
    return executeWorkflowRunStart(input, context);
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

  'support.classify_ticket': async (input, context) => {
    const { classifyTicket } = await import('./skillHandlers/supportClassifyTicket.js');
    return classifyTicket({
      organisationId: context.organisationId,
      ticketId: String(input.ticketId ?? ''),
      runId: context.runId,
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
  compute_staff_activity_pulse: async (input, context) => {
    const { executeComputeStaffActivityPulse } = await import('./computeStaffActivityPulseService.js');
    return executeWithActionAudit('compute_staff_activity_pulse', input, context, async () => {
      const subaccountId = (input.subaccount_id as string | undefined) ?? context.subaccountId;
      if (!subaccountId) throw new Error('subaccount_id is required');
      return executeComputeStaffActivityPulse({
        organisationId: context.organisationId,
        subaccountId,
        sourceRunId: input.source_run_id as string | undefined,
      });
    });
  },
  scan_integration_fingerprints: async (input, context) => {
    const { executeScanIntegrationFingerprints } = await import('./scanIntegrationFingerprintsService.js');
    return executeWithActionAudit('scan_integration_fingerprints', input, context, async () => {
      const subaccountId = (input.subaccount_id as string | undefined) ?? context.subaccountId;
      if (!subaccountId) throw new Error('subaccount_id is required');
      return executeScanIntegrationFingerprints({
        organisationId: context.organisationId,
        subaccountId,
        sourceRunId: input.source_run_id as string | undefined,
      });
    });
  },
  generate_portfolio_report: async (input, context) => {
    const { executeGeneratePortfolioReport } = await import('./intelligenceSkillExecutor.js');
    return executeWithActionAudit('generate_portfolio_report', input, context, () =>
      executeGeneratePortfolioReport(input, context));
  },
  trigger_account_intervention: async (input, context) => {
    return proposeReviewGatedAction('trigger_account_intervention', input, context);
  },

  // ── ClientPulse Phase 4 intervention primitives (all review-gated) ────
  // Scenario-detector proposes, operator approves in the /review queue.
  'crm.fire_automation': async (input, context) => {
    return proposeReviewGatedAction('crm.fire_automation', input, context);
  },
  'crm.send_email': async (input, context) => {
    return proposeReviewGatedAction('crm.send_email', input, context);
  },
  'crm.send_sms': async (input, context) => {
    return proposeReviewGatedAction('crm.send_sms', input, context);
  },
  'crm.create_task': async (input, context) => {
    return proposeReviewGatedAction('crm.create_task', input, context);
  },

  // ── CRM Query Planner (read-only, not review-gated) ─────────────────────
  // Agent-facing tool per spec §18.2 — dispatches through the planner
  // pipeline (Stage 1 registry / Stage 2 cache / Stage 3 LLM fallback /
  // canonical + live + hybrid executors) and returns the BriefResultContract
  // artefact set. The route at /api/crm-query-planner/query is the user
  // surface; this handler is the agent surface.
  'crm.query': async (input, context) => {
    // Resolve target subaccount — prefer the explicit tool-input value,
    // falling back to the agent's bound subaccount context.
    const suppliedSubaccountId = typeof input.subaccountId === 'string' && input.subaccountId.length > 0
      ? input.subaccountId
      : null;
    const targetSubaccountId = suppliedSubaccountId ?? context.subaccountId;

    if (!targetSubaccountId) {
      return {
        success: false,
        error:   'missing_permission',
        message: 'crm.query requires a subaccount — supply input.subaccountId or bind the agent to a subaccount.',
      };
    }

    // Horizontal-access guard (mirrors intelligenceSkillExecutor.executeQuerySubaccountCohort):
    // a regular subaccount agent may only read its own subaccount. Only
    // org-subaccount agents (allowedSubaccountIds === null) may cross
    // boundaries, and even then only to subaccounts in their allowlist if
    // the array form is present. Skip when the caller made no explicit
    // cross-subaccount request (input.subaccountId matches context or was omitted).
    if (suppliedSubaccountId && suppliedSubaccountId !== context.subaccountId) {
      const allowed = context.allowedSubaccountIds;
      const isOrgScope = allowed === null || allowed === undefined;
      const inAllowlist = Array.isArray(allowed) && allowed.includes(suppliedSubaccountId);
      if (!isOrgScope && !inAllowlist) {
        return {
          success: false,
          error:   'missing_permission',
          message: 'Agent is not authorised to read the specified subaccount.',
        };
      }
    }

    const { runQuery } = await import('./crmQueryPlanner/index.js');
    const result = await runQuery(
      {
        rawIntent:    String(input.rawIntent ?? ''),
        subaccountId: targetSubaccountId,
        briefId:      typeof input.briefId === 'string' ? input.briefId : undefined,
      },
      {
        orgId:                  context.organisationId,
        organisationId:         context.organisationId,
        subaccountId:           targetSubaccountId,
        runId:                  context.runId,
        briefId:                typeof input.briefId === 'string' ? input.briefId : undefined,
        principalType:          'agent',
        principalId:            context.agentId,
        teamIds:                [],
        // Agent-invoked — the agent's own capabilityMap gated the skill
        // dispatch upstream (skillExecutor.execute). The planner's
        // validator treats unknown `canonical.*` slugs as skipped per
        // §12.1, so the route's subaccount-capability union is not
        // required here — `crm.query` is the only hard-gated slug.
        callerCapabilities:     new Set<string>(['crm.query']),
        defaultSenderIdentifier: undefined,
      },
    );
    return { success: true, ...result };
  },

  notify_operator: async (input, context) => {
    return proposeReviewGatedAction('notify_operator', input, context);
  },

  // ── Phase 4.5 Configuration Agent skill (closes B3 + B5) ──────────────
  // The skill calls applyOrganisationConfigUpdate directly rather than
  // routing through proposeReviewGatedAction — the service itself owns the
  // sensitive-vs-non-sensitive split (B5) and the config_history write (B3).
  config_update_organisation_config: async (input, context) => {
    const { applyOrganisationConfigUpdate } = await import('./configUpdateOrganisationService.js');
    return applyOrganisationConfigUpdate({
      organisationId: context.organisationId,
      path: input.path as string,
      value: input.value,
      reason: (input.reason as string) ?? 'config_agent write',
      sourceSession: (input.sourceSession as string | null | undefined) ?? null,
      changedByUserId: (context.userId as string | undefined) ?? null,
      agentId: context.agentId,
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

  // ── Universal Brief Phase 4: Clarifying + Sparring Partner skills ──────────
  ask_clarifying_questions: async (input, context) => {
    const { executeAskClarifyingQuestions } = await import('../tools/capabilities/askClarifyingQuestionsHandler.js');
    return executeAskClarifyingQuestions(
      context,
      input as unknown as Parameters<typeof executeAskClarifyingQuestions>[1],
    );
  },

  challenge_assumptions: async (input, context) => {
    const { executeChallengeAssumptions } = await import('../tools/capabilities/challengeAssumptionsHandler.js');
    return executeChallengeAssumptions(
      context,
      input as unknown as Parameters<typeof executeChallengeAssumptions>[1],
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

  // Action-call alias used by the Workflow runner (see weekly-digest.Workflow.ts)
  config_weekly_digest_gather: async (input) => {
    const { executeWeeklyDigestGather } = await import('../tools/internal/weeklyDigestGather.js');
    return executeWeeklyDigestGather(input);
  },

  // ── Phase 3 S22: Deliver Workflow output via deliveryService ─────
  config_deliver_workflow_output: async (input, context) => {
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
  config_publish_workflow_output_to_portal: async (input, context) => {
    const { executeConfigPublishWorkflowOutputToPortal } = await import('../tools/config/workflowSkillHandlers.js');
    return executeWithActionAudit('config_publish_workflow_output_to_portal', input, context, () => executeConfigPublishWorkflowOutputToPortal(input, context));
  },
  config_send_workflow_email_digest: async (input, context) => {
    const { executeConfigSendWorkflowEmailDigest } = await import('../tools/config/workflowSkillHandlers.js');
    return executeWithActionAudit('config_send_workflow_email_digest', input, context, () => executeConfigSendWorkflowEmailDigest(input, context));
  },

  // Onboarding smart-skip — scrapes website to pre-fill brand/audience signals.
  // Implementation pending; returns a not-yet-available error so onboarding
  // falls back to asking the question directly.
  smart_skip_from_website: async (_input, _context) => {
    return { success: false, error: 'smart_skip_from_website is not yet implemented' };
  },

  // ── Canonical Data Dictionary (Phase 2B) ────────────────────────────
  canonical_dictionary: async (input, _context) => {
    const { CANONICAL_DICTIONARY_REGISTRY } = await import('./canonicalDictionary/canonicalDictionaryRegistry.js');
    const { renderDictionary } = await import('./canonicalDictionary/canonicalDictionaryRendererPure.js');
    const tableFilter = input.tableFilter as string[] | undefined;
    const includeExamples = (input.includeExamples as boolean) ?? false;
    return {
      success: true,
      result: renderDictionary(CANONICAL_DICTIONARY_REGISTRY, { tableFilter, includeExamples }),
    };
  },

  // ── System Monitoring Agent skills ──────────────────────────────────
  read_agent_run: async (input, context) => {
    const { executeReadAgentRun } = await import('./systemMonitor/skills/readAgentRun.js');
    return executeReadAgentRun(input, context);
  },
  read_baseline: async (input, context) => {
    const { executeReadBaseline } = await import('./systemMonitor/skills/readBaseline.js');
    return executeReadBaseline(input, context);
  },
  read_connector_state: async (input, context) => {
    const { executeReadConnectorState } = await import('./systemMonitor/skills/readConnectorState.js');
    return executeReadConnectorState(input, context);
  },
  read_dlq_recent: async (input, context) => {
    const { executeReadDlqRecent } = await import('./systemMonitor/skills/readDlqRecent.js');
    return executeReadDlqRecent(input, context);
  },
  read_heuristic_fires: async (input, context) => {
    const { executeReadHeuristicFires } = await import('./systemMonitor/skills/readHeuristicFires.js');
    return executeReadHeuristicFires(input, context);
  },
  read_incident: async (input, context) => {
    const { executeReadIncident } = await import('./systemMonitor/skills/readIncident.js');
    return executeReadIncident(input, context);
  },
  read_logs_for_correlation_id: async (input, context) => {
    const { executeReadLogsForCorrelationId } = await import('./systemMonitor/skills/readLogsForCorrelationId.js');
    return executeReadLogsForCorrelationId(input, context);
  },
  read_recent_runs_for_agent: async (input, context) => {
    const { executeReadRecentRunsForAgent } = await import('./systemMonitor/skills/readRecentRunsForAgent.js');
    return executeReadRecentRunsForAgent(input, context);
  },
  read_skill_execution: async (input, context) => {
    const { executeReadSkillExecution } = await import('./systemMonitor/skills/readSkillExecution.js');
    return executeReadSkillExecution(input, context);
  },
  write_diagnosis: async (input, context) => {
    const { executeWriteDiagnosis } = await import('./systemMonitor/skills/writeDiagnosis.js');
    return executeWriteDiagnosis(input, context);
  },
  write_event: async (input, context) => {
    const { executeWriteEvent } = await import('./systemMonitor/skills/writeEvent.js');
    return executeWriteEvent(input, context);
  },

  // ── Sub-Account Optimiser: generic agent-output primitive (Chunk 1) ────────
  // output.recommend — any agent with this skill can surface operator-facing
  // recommendations via the generic agent_recommendations primitive.
  // Spec: docs/sub-account-optimiser-spec.md §6.2
  'output.recommend': async (input, context) => {
    // Requires an agent execution context — non-agent callers are rejected.
    if (!context.agentId) {
      return {
        success: false,
        error: 'output.recommend requires an agent execution context (agentId missing)',
      };
    }

    const {
      scope_type,
      scope_id,
      category,
      severity,
      title,
      body,
      evidence,
      action_hint,
      dedupe_key,
    } = input as Record<string, unknown>;

    // Validate required fields
    if (!scope_type || (scope_type !== 'org' && scope_type !== 'subaccount')) {
      return { success: false, error: 'scope_type must be "org" or "subaccount"' };
    }
    if (!scope_id || typeof scope_id !== 'string') {
      return { success: false, error: 'scope_id must be a valid UUID string' };
    }
    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(scope_id)) {
      return { success: false, error: 'scope_id must be a valid UUID' };
    }
    if (!severity || !['info', 'warn', 'critical'].includes(severity as string)) {
      return { success: false, error: 'severity must be "info", "warn", or "critical"' };
    }
    if (!category || typeof category !== 'string') {
      return { success: false, error: 'category is required' };
    }
    // Validate three-segment format
    const categoryParts = (category as string).split('.');
    if (categoryParts.length < 3) {
      return {
        success: false,
        error: 'category must follow <agent_namespace>.<area>.<finding> format (three segments)',
      };
    }
    if (!title || typeof title !== 'string') {
      return { success: false, error: 'title is required' };
    }
    if (!body || typeof body !== 'string') {
      return { success: false, error: 'body is required' };
    }
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return { success: false, error: 'evidence must be a plain object' };
    }
    if (!dedupe_key || typeof dedupe_key !== 'string') {
      return { success: false, error: 'dedupe_key is required' };
    }
    // Validate action_hint: null/omitted accepted; non-null must match scheme://path format
    if (action_hint !== undefined && action_hint !== null) {
      if (typeof action_hint !== 'string' || action_hint === '') {
        return { success: false, error: 'action_hint must be null/omitted or a non-empty URI string' };
      }
      const actionHintRegex = /^[a-z][a-z0-9-]*:\/\/[^\s]+$/;
      if (!actionHintRegex.test(action_hint as string)) {
        return {
          success: false,
          error: 'action_hint must match pattern ^[a-z][a-z0-9-]*://[^\\s]+$ (e.g. configuration-assistant://agent/id?focus=budget)',
        };
      }
    }

    const { upsertRecommendation } = await import('./agentRecommendationsService.js');
    const result = await upsertRecommendation(
      {
        organisationId: context.organisationId,
        agentId: context.agentId,
      },
      {
        scope_type: scope_type as 'org' | 'subaccount',
        scope_id: scope_id as string,
        category: category as string,
        severity: severity as 'info' | 'warn' | 'critical',
        title: title as string,
        body: body as string,
        evidence: evidence as Record<string, unknown>,
        action_hint: (action_hint as string | null | undefined) ?? null,
        dedupe_key: dedupe_key as string,
      },
    );
    return { success: true, ...result };
  },

  // ── Thread context (Chunk A — per-conversation living doc) ───────────────
  update_thread_context: async (input, context) => {
    if (!context.conversationId) {
      return { success: false, error: 'update_thread_context requires a conversation context — this run has no associated conversation.' };
    }
    return executeWithActionAudit('update_thread_context', input, context, () =>
      updateThreadContextHandler(input, {
        conversationId: context.conversationId!,
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId ?? null,
      }),
    );
  },

  // ── Sub-Account Optimiser: scan skills (Chunk 5) ─────────────────────────
  // Each scan skill is a thin wrapper: query module → evaluator → EvaluatorOutput[].
  // All scan skills are read-only (no action record, no side effects).
  // Spec: docs/sub-account-optimiser-spec.md §5

  'optimiser.scan_agent_budget': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_agent_budget');
    try {
      const { module: agentBudgetModule } = await import('./optimiser/queries/agentBudget.js');
      const { evaluate } = await import('./optimiser/recommendations/agentBudget.js');
      const tx = getOrgScopedDb('optimiser.scan_agent_budget');
      const rows = await agentBudgetModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: agentBudgetModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.agent.over_budget', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_workflow_escalations': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_workflow_escalations');
    try {
      const { module: escalationRateModule } = await import('./optimiser/queries/escalationRate.js');
      const { evaluate } = await import('./optimiser/recommendations/playbookEscalation.js');
      const tx = getOrgScopedDb('optimiser.scan_workflow_escalations');
      const rows = await escalationRateModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: escalationRateModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.playbook.escalation_rate', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_skill_latency': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_skill_latency');
    try {
      const { skillLatencyModule, peerMediansViewIsPopulated, runSkillLatencyQuery } = await import('./optimiser/queries/skillLatency.js');
      const { evaluateSkillSlow } = await import('./optimiser/recommendations/skillSlow.js');
      // peerMediansViewIsPopulated manages its own admin connection internally
      const populated = await peerMediansViewIsPopulated();
      if (!populated) {
        logger.info('optimiser.scan.partial', { scanCategory: skillLatencyModule.category, medianVersion: 0, subaccountId });
        return { success: true, outputs: [] };
      }
      // allowRlsBypass: reading cross-tenant peer medians view (optimiser_skill_peer_medians) — read-only aggregate, no tenant data written
      const { withAdminConnectionGuarded: adminGuarded } = await import('../lib/rlsBoundaryGuard.js');
      let outputs: import('./optimiser/recommendations/types.js').EvaluatorOutput[] = [];
      await adminGuarded(
        { source: 'optimiser.scan_skill_latency', allowRlsBypass: false },
        async (adminTx) => {
          const versionRows = await adminTx.execute<{ max_version: number }>(
            (await import('drizzle-orm')).sql`SELECT MAX(median_version) AS max_version FROM optimiser_skill_peer_medians`,
          );
          const medianVersion = versionRows[0]?.max_version ?? 0;
          const rows = await runSkillLatencyQuery(adminTx, subaccountId, medianVersion);
          logger.info('optimiser.scan.completed', { scanCategory: skillLatencyModule.category, resultCount: rows.length, subaccountId });
          outputs = evaluateSkillSlow(rows, { subaccountId, organisationId: context.organisationId, medianVersion, priorRecsByDedupe: new Map() });
        },
      );
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.skill.slow', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_inactive_workflows': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_inactive_workflows');
    try {
      const { module: inactiveWorkflowsModule } = await import('./optimiser/queries/inactiveWorkflows.js');
      const { evaluate } = await import('./optimiser/recommendations/inactiveWorkflow.js');
      const tx = getOrgScopedDb('optimiser.scan_inactive_workflows');
      const rows = await inactiveWorkflowsModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: inactiveWorkflowsModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.inactive.workflow', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_escalation_phrases': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_escalation_phrases');
    try {
      const { module: escalationPhrasesModule } = await import('./optimiser/queries/escalationPhrases.js');
      const { evaluate } = await import('./optimiser/recommendations/repeatPhrase.js');
      const tx = getOrgScopedDb('optimiser.scan_escalation_phrases');
      const rows = await escalationPhrasesModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: escalationPhrasesModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.escalation.repeat_phrase', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_memory_citation': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_memory_citation');
    try {
      const { module: memoryCitationModule } = await import('./optimiser/queries/memoryCitation.js');
      const { evaluate } = await import('./optimiser/recommendations/memoryCitation.js');
      const tx = getOrgScopedDb('optimiser.scan_memory_citation');
      const rows = await memoryCitationModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: memoryCitationModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.memory.low_citation_waste', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_routing_uncertainty': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_routing_uncertainty');
    try {
      const { module: routingUncertaintyModule } = await import('./optimiser/queries/routingUncertainty.js');
      const { evaluate } = await import('./optimiser/recommendations/routingUncertainty.js');
      const tx = getOrgScopedDb('optimiser.scan_routing_uncertainty');
      const rows = await routingUncertaintyModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: routingUncertaintyModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.agent.routing_uncertainty', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  'optimiser.scan_cache_efficiency': async (input, context) => {
    const subaccountId = requireSubaccountContext(context, 'optimiser.scan_cache_efficiency');
    try {
      const { module: cacheEfficiencyModule } = await import('./optimiser/queries/cacheEfficiency.js');
      const { evaluate } = await import('./optimiser/recommendations/cacheEfficiency.js');
      const tx = getOrgScopedDb('optimiser.scan_cache_efficiency');
      const rows = await cacheEfficiencyModule.run(tx, subaccountId);
      logger.info('optimiser.scan.completed', { scanCategory: cacheEfficiencyModule.category, resultCount: rows.length, subaccountId });
      const outputs = evaluate(rows, { subaccountId, organisationId: context.organisationId, medianVersion: 0, priorRecsByDedupe: new Map() });
      return { success: true, outputs };
    } catch (err) {
      logger.error('optimiser.scan.failed', { scanCategory: 'optimiser.llm.cache_poor_reuse', error: err instanceof Error ? err.message : String(err), subaccountId });
      throw err;
    }
  },

  // ── Agentic Commerce — Spend Skills (Chunk 6) ─────────────────────────────
  // Thin shells over chargeRouterService.proposeCharge. Each handler validates
  // input, resolves spending context, normalises merchant (invariant 21), and
  // delegates to spendSkillHandlers. Dual registration enforced per invariant 14:
  // every spendsMoney:true ACTION_REGISTRY entry has a matching SKILL_HANDLERS entry.
  // Spec: tasks/builds/agentic-commerce/spec.md §7.1
  // Plan: tasks/builds/agentic-commerce/plan.md §Chunk 6
  pay_invoice: async (input, context) => {
    const { executePayInvoice } = await import('./spendSkillHandlers.js');
    return executePayInvoice(input, context);
  },
  purchase_resource: async (input, context) => {
    const { executePurchaseResource } = await import('./spendSkillHandlers.js');
    return executePurchaseResource(input, context);
  },
  subscribe_to_service: async (input, context) => {
    const { executeSubscribeToService } = await import('./spendSkillHandlers.js');
    return executeSubscribeToService(input, context);
  },
  top_up_balance: async (input, context) => {
    const { executeTopUpBalance } = await import('./spendSkillHandlers.js');
    return executeTopUpBalance(input, context);
  },
  issue_refund: async (input, context) => {
    const { executeIssueRefund } = await import('./spendSkillHandlers.js');
    return executeIssueRefund(input, context);
  },
};

// ── Support Desk principal helper ────────────────────────────────────────────
// Converts a SkillExecutionContext to a ServicePrincipal for support service calls.
function buildSupportPrincipal(context: SkillExecutionContext): import('./principal/types.js').PrincipalContext {
  return {
    type: 'service',
    id: context.agentId,
    organisationId: context.organisationId,
    subaccountId: context.subaccountId,
    serviceId: 'support-skill',
    teamIds: [],
  };
}

// Re-open SKILL_HANDLERS to add support desk skills after the closing brace above.
// This is done as a post-registration merge to keep the spend-skill block intact.
Object.assign(SKILL_HANDLERS, {
  // ── Support Desk skills ────────────────────────────────────────────────────
  'support.list_open_tickets': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { listOpenTickets } = await import('./supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    const tickets = await listOpenTickets(
      {
        inboxIds: input.inboxIds as string[] | undefined,
        statusGroup: input.statusGroup as 'needs_attention' | 'all_open' | 'quarantined' | undefined,
      },
      principal,
    );
    return { success: true, tickets };
  },
  'support.read_thread': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { readThreadForAgent } = await import('./supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    const result = await readThreadForAgent(input.ticketId as string, principal);
    return { success: true, ...result };
  },
  'support.propose_reply': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { proposeReply } = await import('./supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const draft = await proposeReply(
      {
        ticketId: input.ticketId as string,
        body: input.body as string,
        visibility: 'public',
        proposedActions: input.proposedActions as import('../../shared/types/supportProposedActions.js').SupportProposedActions | undefined,
        runId: context.runId,
      },
      principal,
    );
    return { success: true, draft };
  },
  'support.add_internal_note': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { proposeReply } = await import('./supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const draft = await proposeReply(
      {
        ticketId: input.ticketId as string,
        body: input.body as string,
        visibility: 'internal',
        runId: context.runId,
      },
      principal,
    );
    return { success: true, draft };
  },
  'support.approve_draft': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { approveDraft } = await import('./supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    const result = await approveDraft(input.draftId as string, principal, {
      reviewNotes: input.reviewNotes as string | undefined,
    });
    return { success: true, ...result };
  },
  'support.reject_draft': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { rejectDraft } = await import('./supportDraftDispatchService.js');
    const principal = buildSupportPrincipal(context);
    await rejectDraft(input.draftId as string, principal, input.reason as string);
    return { success: true };
  },
  'support.set_status': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyStatusChange } = await import('./supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyStatusChange(
      input.ticketId as string,
      input.status as import('../adapters/integrationAdapter.js').SupportCanonicalStatus,
      principal,
    );
    return { success: true };
  },
  'support.assign': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyAssignmentChange } = await import('./supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyAssignmentChange(
      input.ticketId as string,
      input.assigneeAgentExternalId as string | null,
      principal,
    );
    return { success: true };
  },
  'support.tag': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { applyTagMutation } = await import('./supportTicketService.js');
    const principal = buildSupportPrincipal(context);
    await applyTagMutation(
      input.ticketId as string,
      {
        addTags: input.addTags as string[] | undefined,
        removeTags: input.removeTags as string[] | undefined,
      },
      principal,
    );
    return { success: true };
  },
  'support.find_customer_history': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { eq, and, inArray: inArr } = await import('drizzle-orm');
    const { getOrgScopedDb } = await import('../lib/orgScopedDb.js');
    const {
      canonicalContacts, // verify-canonical-read-interface: allowed
      canonicalTickets: ctTickets,
      canonicalRevenue, // verify-canonical-read-interface: allowed
      canonicalAccounts, // verify-canonical-read-interface: allowed
    } = await import('../db/schema/index.js');
    const db = getOrgScopedDb('support.find_customer_history');
    const contacts = await db
      .select()
      .from(canonicalContacts) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalContacts.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        eq(canonicalContacts.email, input.email as string), // verify-canonical-read-interface: allowed
      ));
    if (contacts.length === 0) return { success: true, contacts: [], tickets: [], revenue: [], accounts: [] };
    const contactIds = contacts.map((c) => c.id);
    const accountIds = [...new Set(contacts.map((c) => c.accountId))];
    const tickets = await db
      .select()
      .from(ctTickets)
      .where(and(
        eq(ctTickets.organisationId, context.organisationId),
        inArr(ctTickets.canonicalContactId, contactIds),
      ))
      .orderBy(ctTickets.openedAt);
    const revenue = await db
      .select()
      .from(canonicalRevenue) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalRevenue.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        inArr(canonicalRevenue.accountId, accountIds), // verify-canonical-read-interface: allowed
      ));
    const accounts = await db
      .select()
      .from(canonicalAccounts) // verify-canonical-read-interface: allowed
      .where(and(
        eq(canonicalAccounts.organisationId, context.organisationId), // verify-canonical-read-interface: allowed
        inArr(canonicalAccounts.id, accountIds), // verify-canonical-read-interface: allowed
      ));
    return { success: true, contacts, tickets, revenue, accounts };
  },
} satisfies Record<string, SkillHandler>);

// ---------------------------------------------------------------------------
// Calendar + Slack skills (user-owned credential scope)
// ---------------------------------------------------------------------------

async function resolveAgentOwner(context: SkillExecutionContext): Promise<string> {
  const { db: agentDb } = await import('../db/index.js');
  const { agents: agentsTable } = await import('../db/schema/agents.js');
  const { eq: eqOp } = await import('drizzle-orm');
  const [agent] = await agentDb
    .select({ ownerUserId: agentsTable.ownerUserId })
    .from(agentsTable)
    .where(eqOp(agentsTable.id, context.agentId))
    .limit(1);
  if (!agent?.ownerUserId) {
    throw Object.assign(
      new Error('Agent has no owner; this skill requires a user-owned agent'),
      { statusCode: 422, errorCode: 'AGENT_NO_OWNER' },
    );
  }
  return agent.ownerUserId;
}

Object.assign(SKILL_HANDLERS, {
  // ── Calendar skills (user-owned credential scope) ─────────────────────────
  'calendar.list_events': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    return calendarActionService.listEvents(
      input as import('../../shared/types/calendarAction.js').CalendarListEventsInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'calendar.get_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    return calendarActionService.getEvent(
      input as import('../../shared/types/calendarAction.js').CalendarGetEventInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'calendar.find_free_slot': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    return calendarActionService.findFreeSlot(
      input as import('../../shared/types/calendarAction.js').CalendarFindFreeSlotInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'calendar.create_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    const { eaDraftId, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.create_event requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    return calendarActionService.createEvent(
      { ...(rest as import('../../shared/types/calendarAction.js').CalendarCreateEventInput), eaDraftId: eaDraftId as string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'calendar.update_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    const { eaDraftId, etag, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.update_event requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    return calendarActionService.updateEvent(
      { ...(rest as import('../../shared/types/calendarAction.js').CalendarUpdateEventInput), eaDraftId: eaDraftId as string, etag: etag as string | undefined },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'calendar.respond_to_invite': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('./calendar/calendarActionService.js');
    const { eaDraftId, ownerEmail, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.respond_to_invite requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    if (!ownerEmail) throw Object.assign(new Error('calendar.respond_to_invite requires ownerEmail'), { statusCode: 400, errorCode: 'MISSING_OWNER_EMAIL' });
    return calendarActionService.respondToInvite(
      { ...(rest as import('../../shared/types/calendarAction.js').CalendarRespondToInviteInput), eaDraftId: eaDraftId as string, ownerEmail: ownerEmail as string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  // ── Slack skills (user-owned credential scope) ────────────────────────────
  'slack.list_channels': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.listChannels(
      input as { cursor?: string; limit?: number; excludeArchived?: boolean },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'slack.read_channel': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.readChannel(
      input as { channelId: string; limit?: number; oldest?: string; latest?: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'slack.search_messages': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.searchMessages(
      input as { query: string; count?: number; page?: number; sort?: string; sortDir?: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'slack.summarise_thread': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.summariseThread(
      input as { channelId: string; threadTs: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'slack.post_message': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.postMessage(
      {
        channelId: input.channelId as string,
        text: input.text as string,
        agentId: context.agentId,
        agentRunId: context.runId,
        kind: 'slack_post',
      },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
  'slack.post_dm': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('./slack/slackActionService.js');
    return slackActionService.postDm(
      {
        targetUserId: input.targetUserId as string,
        text: input.text as string,
        agentId: context.agentId,
        agentRunId: context.runId,
        kind: 'slack_dm',
      },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
} satisfies Record<string, SkillHandler>);

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
