import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExecuteWebSearch, mockIntelligenceSkills, mockActionService, mockReviewService, mockHitlService, mockExecutionLayerService, mockTaskService } = vi.hoisted(() => {
  const mockExecuteWebSearch = vi.fn();
  const mockIntelligenceSkills = {
    executeQuerySubaccountCohort: vi.fn(),
    executeReadOrgInsights: vi.fn(),
    executeWriteOrgInsight: vi.fn(),
    executeComputeHealthScore: vi.fn(),
    executeDetectAnomaly: vi.fn(),
    executeComputeChurnRisk: vi.fn(),
    executeGeneratePortfolioReport: vi.fn(),
  };
  const mockActionService = {
    proposeAction: vi.fn(),
    lockForExecution: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    getAction: vi.fn(),
  };
  const mockReviewService = { createReviewItem: vi.fn() };
  const mockHitlService = { awaitDecision: vi.fn() };
  const mockExecutionLayerService = {
    executeAction: vi.fn(),
    executeAutoAction: vi.fn(),
  };
  const mockTaskService = { createTask: vi.fn() };
  return {
    mockExecuteWebSearch,
    mockIntelligenceSkills,
    mockActionService,
    mockReviewService,
    mockHitlService,
    mockExecutionLayerService,
    mockTaskService,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  subaccountAgents: {},
  agents: {},
  agentRuns: {},
  tasks: {},
  actions: {},
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { TAVILY_API_KEY: 'test-key' },
}));

vi.mock('../../../../server/instrumentation.js', () => ({
  getActiveTrace: () => null,
}));

vi.mock('../../../../server/lib/tripwire.js', () => ({
  TripWire: class TripWire extends Error {
    reason: string;
    options: Record<string, unknown>;
    constructor(reason: string, options = {}) {
      super(reason);
      this.reason = reason;
      this.options = options;
    }
  },
}));

vi.mock('../../../../server/services/taskService.js', () => ({
  taskService: mockTaskService,
}));

vi.mock('../../../../server/services/llmService.js', () => ({
  executeTriggerredProcess: vi.fn(),
}));

vi.mock('../../../../server/services/agentExecutionService.js', () => ({
  agentExecutionService: { startRun: vi.fn() },
}));

vi.mock('../../../../server/services/actionService.js', () => ({
  actionService: mockActionService,
}));

vi.mock('../../../../server/services/executionLayerService.js', () => ({
  executionLayerService: mockExecutionLayerService,
  registerAdapter: vi.fn(),
}));

vi.mock('../../../../server/services/reviewService.js', () => ({
  reviewService: mockReviewService,
}));

vi.mock('../../../../server/services/hitlService.js', () => ({
  hitlService: mockHitlService,
}));

vi.mock('../../../../server/config/actionRegistry.js', () => ({
  getActionDefinition: vi.fn().mockReturnValue({
    actionCategory: 'worker',
    isExternal: false,
    slug: 'test',
  }),
}));

vi.mock('../../../../server/config/limits.js', () => ({
  MAX_HANDOFF_DEPTH: 5,
  MAX_TASK_TITLE_LENGTH: 200,
  MAX_TASK_DESCRIPTION_LENGTH: 5000,
  VALID_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  MAX_SUB_AGENTS: 5,
  MIN_SUB_AGENT_TOKEN_BUDGET: 1000,
  SUB_AGENT_TIMEOUT_BUFFER: 30000,
  HITL_REVIEW_TIMEOUT_MS: 300000,
}));

vi.mock('../../../../server/services/devContextService.js', () => ({
  devContextService: {},
  assertPathInRoot: vi.fn(),
}));

vi.mock('../../../../server/services/adapters/workerAdapter.js', () => ({
  createWorkerAdapter: vi.fn().mockReturnValue({ execute: vi.fn() }),
}));

vi.mock('../../../../server/tools/meta/searchTools.js', () => ({
  executeSearchTools: vi.fn().mockResolvedValue({ tools: [] }),
  executeLoadTool: vi.fn().mockResolvedValue({ tool: null }),
}));

vi.mock('../../../../server/tools/internal/assignTask.js', () => ({
  executeAssignTask: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../../server/services/intelligenceSkillExecutor.js', () => mockIntelligenceSkills);

vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('glob', () => ({ glob: vi.fn().mockResolvedValue([]) }));
vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('util', () => ({ promisify: vi.fn().mockReturnValue(vi.fn()) }));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { skillExecutor } from '../../../../server/services/skillExecutor.js';
import type { SkillExecutionContext } from '../../../../server/services/skillExecutor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: 'sa-1',
    agentId: 'agent-1',
    orgProcesses: [],
    ...overrides,
  };
}

function makeOrgContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return makeContext({ subaccountId: null, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skillExecutor.execute', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Dispatch: web_search ──────────────────────────────────────────────────

  describe('web_search dispatch', () => {
    it('routes web_search and returns result', async () => {
      // web_search calls fetch internally; we just verify no throw for dispatch
      // Since fetch is not mocked, we expect it to fail gracefully
      const result = await skillExecutor.execute({
        skillName: 'web_search',
        input: { query: 'test' },
        context: makeContext(),
      });
      // web_search executor is internal — it will either return a result or an error object
      expect(result).toBeDefined();
    });
  });

  // ── Dispatch: create_task (auto-gated, requires subaccount) ──────────────

  describe('create_task dispatch', () => {
    it('goes through requireSubaccountContext guard and executeWithActionAudit', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: true,
        actionId: 'action-1',
        status: 'approved',
      });
      mockActionService.lockForExecution.mockResolvedValue(true);

      const result = await skillExecutor.execute({
        skillName: 'create_task',
        input: { title: 'Test task' },
        context: makeContext(),
      });

      expect(mockActionService.proposeAction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('throws for org-level context on create_task', async () => {
      await expect(
        skillExecutor.execute({
          skillName: 'create_task',
          input: { title: 'Test task' },
          context: makeOrgContext(),
        }),
      ).rejects.toThrow(/requires a subaccount context/);
    });
  });

  // ── Subaccount-only skills throw for org-level context ───────────────────

  describe('subaccount-only skills reject org-level context', () => {
    const subaccountOnlySkills = [
      'read_workspace',
      'write_workspace',
      'spawn_sub_agents',
      'read_codebase',
      'search_codebase',
      'run_tests',
      'analyze_endpoint',
      'report_bug',
      'capture_screenshot',
      'run_playwright_test',
      'create_page',
      'update_page',
      'publish_page',
      'write_patch',
      'run_command',
      'create_pr',
      'reassign_task',
    ];

    for (const skill of subaccountOnlySkills) {
      it(`throws for org-level context on '${skill}'`, async () => {
        await expect(
          skillExecutor.execute({
            skillName: skill,
            input: {},
            context: makeOrgContext(),
          }),
        ).rejects.toThrow(/requires a subaccount context/);
      });
    }
  });

  // ── Intelligence skills route to intelligenceSkillExecutor ────────────────

  describe('intelligence skill dispatch', () => {
    const intelligenceSkills = [
      { name: 'query_subaccount_cohort', mock: 'executeQuerySubaccountCohort' },
      { name: 'read_org_insights', mock: 'executeReadOrgInsights' },
      { name: 'write_org_insight', mock: 'executeWriteOrgInsight' },
      { name: 'compute_health_score', mock: 'executeComputeHealthScore' },
      { name: 'detect_anomaly', mock: 'executeDetectAnomaly' },
      { name: 'compute_churn_risk', mock: 'executeComputeChurnRisk' },
      { name: 'generate_portfolio_report', mock: 'executeGeneratePortfolioReport' },
    ] as const;

    for (const { name, mock } of intelligenceSkills) {
      it(`routes '${name}' to intelligenceSkillExecutor.${mock}`, async () => {
        const mockFn = mockIntelligenceSkills[mock];
        mockFn.mockResolvedValue({ success: true });

        // These go through executeWithActionAudit, so we need proposeAction mock
        mockActionService.proposeAction.mockResolvedValue({
          isNew: true,
          actionId: 'action-1',
          status: 'approved',
        });
        mockActionService.lockForExecution.mockResolvedValue(true);

        await skillExecutor.execute({
          skillName: name,
          input: { test: true },
          context: makeContext(),
        });

        expect(mockFn).toHaveBeenCalled();
      });
    }
  });

  // ── Unknown skill returns error ──────────────────────────────────────────

  describe('unknown skill', () => {
    it('returns error for unknown skill name', async () => {
      const result = await skillExecutor.execute({
        skillName: 'nonexistent_skill',
        input: {},
        context: makeContext(),
      });

      expect(result).toEqual({ success: false, error: 'Unknown skill: nonexistent_skill' });
    });
  });

  // ── executeWithActionAudit handles duplicate detection ───────────────────

  describe('executeWithActionAudit duplicate detection', () => {
    it('returns existing status when action is duplicate', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: false,
        actionId: 'action-1',
        status: 'completed',
      });

      const result = (await skillExecutor.execute({
        skillName: 'move_task',
        input: { task_id: 't-1', status: 'done' },
        context: makeContext(),
      })) as Record<string, unknown>;

      expect(result.message).toContain('Duplicate');
      expect(result.action_id).toBe('action-1');
    });
  });

  // ── executeWithActionAudit handles blocked status ────────────────────────

  describe('executeWithActionAudit blocked by policy', () => {
    it('returns denial when action is blocked', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: true,
        actionId: 'action-1',
        status: 'blocked',
      });

      const result = (await skillExecutor.execute({
        skillName: 'move_task',
        input: { task_id: 't-1', status: 'done' },
        context: makeContext(),
      })) as Record<string, unknown>;

      expect(result.success).toBe(false);
      expect(result.status).toBe('denied');
    });
  });

  // ── Review-gated skills (send_email, update_record, etc.) ────────────────

  describe('review-gated skill dispatch', () => {
    it('proposes review-gated action for send_email', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: true,
        actionId: 'action-1',
        status: 'pending_approval',
      });
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'send_email',
        organisationId: 'org-1',
      });
      mockReviewService.createReviewItem.mockResolvedValue(undefined);
      mockHitlService.awaitDecision.mockResolvedValue({
        approved: false,
        comment: 'Not now',
      });

      const result = (await skillExecutor.execute({
        skillName: 'send_email',
        input: { to: 'test@example.com', body: 'Hello' },
        context: makeContext(),
      })) as Record<string, unknown>;

      expect(mockActionService.proposeAction).toHaveBeenCalled();
      expect(mockReviewService.createReviewItem).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.status).toBe('denied');
    });
  });

  // ── proposeReviewGatedAction idempotency key uses org fallback ───────────

  describe('proposeReviewGatedAction idempotency key', () => {
    it('uses subaccountId in idempotency key when present', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: true,
        actionId: 'action-1',
        status: 'blocked',
      });

      await skillExecutor.execute({
        skillName: 'send_email',
        input: { to: 'test@example.com' },
        context: makeContext({ subaccountId: 'sa-99' }),
      });

      const call = mockActionService.proposeAction.mock.calls[0][0];
      expect(call.idempotencyKey).toContain('sa-99');
      expect(call.idempotencyKey).not.toContain('org:');
    });

    it('uses org: prefix fallback when subaccountId is null', async () => {
      mockActionService.proposeAction.mockResolvedValue({
        isNew: true,
        actionId: 'action-1',
        status: 'blocked',
      });

      await skillExecutor.execute({
        skillName: 'send_email',
        input: { to: 'test@example.com' },
        context: makeOrgContext(),
      });

      const call = mockActionService.proposeAction.mock.calls[0][0];
      expect(call.idempotencyKey).toContain('org:org-1');
    });
  });
});
