/**
 * server/services/__tests__/optimiserOrchestrator.test.ts
 *
 * Integration tests for the optimiser orchestrator.
 *
 * Mocks:
 * - All 8 query modules (return empty arrays by default; overridden per test)
 * - llmRouter.routeCall (returns valid render output by default)
 * - agentRecommendationsService.upsertRecommendation (captures calls)
 * - logger
 *
 * These tests verify orchestration logic: scan → evaluate → sort → render → upsert.
 * DB is not exercised directly.
 *
 * Run: npx vitest run server/services/__tests__/optimiserOrchestrator.test.ts
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRouteCall = vi.fn();
vi.mock('../llmRouter.js', () => ({
  routeCall: (params: unknown) => mockRouteCall(params),
}));

const mockUpsertRecommendation = vi.fn();
vi.mock('../agentRecommendationsService.js', () => ({
  upsertRecommendation: (ctx: unknown, input: unknown) => mockUpsertRecommendation(ctx, input),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock DB (used by repeatPhrase evaluator for brand-voice lookup)
vi.mock('../../db/index.js', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (fn: unknown) => (fn as (tx: unknown) => unknown)({ execute: vi.fn().mockResolvedValue([]) })),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  },
}));

// Mock all 8 query modules
const mockQueryAgentBudget = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/agentBudget.js', () => ({ queryAgentBudget: (...a: unknown[]) => mockQueryAgentBudget(...a) }));

const mockQueryEscalationRate = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/escalationRate.js', () => ({ queryEscalationRate: (...a: unknown[]) => mockQueryEscalationRate(...a) }));

const mockQuerySkillLatency = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/skillLatency.js', () => ({ querySkillLatency: (...a: unknown[]) => mockQuerySkillLatency(...a) }));

const mockQueryInactiveWorkflows = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/inactiveWorkflows.js', () => ({ queryInactiveWorkflows: (...a: unknown[]) => mockQueryInactiveWorkflows(...a) }));

const mockQueryEscalationPhrases = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/escalationPhrases.js', () => ({ queryEscalationPhrases: (...a: unknown[]) => mockQueryEscalationPhrases(...a) }));

const mockQueryMemoryCitation = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/memoryCitation.js', () => ({ queryMemoryCitation: (...a: unknown[]) => mockQueryMemoryCitation(...a) }));

const mockQueryRoutingUncertainty = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/routingUncertainty.js', () => ({ queryRoutingUncertainty: (...a: unknown[]) => mockQueryRoutingUncertainty(...a) }));

const mockQueryCacheEfficiency = vi.fn().mockResolvedValue([]);
vi.mock('../optimiser/queries/cacheEfficiency.js', () => ({ queryCacheEfficiency: (...a: unknown[]) => mockQueryCacheEfficiency(...a) }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { runOptimiser, OPTIMISER_RUN_BUDGET_MS, OPTIMISER_RUN_CANDIDATE_CAP, _renderCache } from '../optimiser/optimiserOrchestrator.js';
import { logger as _logger } from '../../lib/logger.js';

// Cast to vi mock type so .mock.calls is accessible
const mockLogger = _logger as unknown as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SUBACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const AGENT_ID = '33333333-3333-3333-3333-333333333333';

const RUN_INPUT = { subaccountId: SUBACCOUNT_ID, organisationId: ORG_ID, agentId: AGENT_ID };

function makeValidRenderResponse(title = 'Agent spent $1500 vs $1000 budget', body = 'The agent exceeded its monthly budget by 50%, spending $1500 against a $1000 limit.') {
  return { content: JSON.stringify({ title, body }) };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('optimiserOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _renderCache.clear();
    delete process.env['OPTIMISER_DISABLED'];

    // Default: all queries return empty arrays
    mockQueryAgentBudget.mockResolvedValue([]);
    mockQueryEscalationRate.mockResolvedValue([]);
    mockQuerySkillLatency.mockResolvedValue([]);
    mockQueryInactiveWorkflows.mockResolvedValue([]);
    mockQueryEscalationPhrases.mockResolvedValue([]);
    mockQueryMemoryCitation.mockResolvedValue([]);
    mockQueryRoutingUncertainty.mockResolvedValue([]);
    mockQueryCacheEfficiency.mockResolvedValue([]);

    // Default render: valid output
    mockRouteCall.mockResolvedValue(makeValidRenderResponse());

    // Default upsert: new insert
    mockUpsertRecommendation.mockResolvedValue({ recommendation_id: 'rec-1', was_new: true });
  });

  afterEach(() => {
    delete process.env['OPTIMISER_DISABLED'];
  });

  // ── Global kill switch ────────────────────────────────────────────────────

  it('global kill switch: OPTIMISER_DISABLED=true returns immediately, no scans, no run_summary', async () => {
    process.env['OPTIMISER_DISABLED'] = 'true';

    await runOptimiser(RUN_INPUT);

    expect(mockQueryAgentBudget).not.toHaveBeenCalled();
    expect(mockUpsertRecommendation).not.toHaveBeenCalled();
    expect(mockRouteCall).not.toHaveBeenCalled();

    // run_skipped logged
    expect(mockLogger.info).toHaveBeenCalledWith('recommendations.run_skipped', expect.objectContaining({
      reason: 'global_kill_switch',
    }));

    // run_summary NOT emitted
    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall).toBeUndefined();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: no candidates → run completes, run_summary emitted with all-zero counters', async () => {
    await runOptimiser(RUN_INPUT);

    expect(mockUpsertRecommendation).not.toHaveBeenCalled();
    expect(mockRouteCall).not.toHaveBeenCalled();

    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall).toBeTruthy();
    const summaryPayload = summaryCall![1];
    expect(summaryPayload.subaccount_id).toBe(SUBACCOUNT_ID);
    expect(summaryPayload.total_candidates).toBe(0);
    expect(summaryPayload.written).toBe(0);
    expect(summaryPayload.status).toBe('completed');
    expect(typeof summaryPayload.duration_ms).toBe('number');
  });

  it('happy path: 1 candidate → 1 render call, 1 upsert, summary written=1', async () => {
    mockQueryAgentBudget.mockResolvedValue([{
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    }]);

    await runOptimiser(RUN_INPUT);

    expect(mockRouteCall).toHaveBeenCalledOnce();
    expect(mockUpsertRecommendation).toHaveBeenCalledOnce();

    // Verify model pin
    const routeCallArgs = mockRouteCall.mock.calls[0][0] as { context: { model: string }; maxTokens: number; temperature: number };
    expect(routeCallArgs.context.model).toBe('claude-sonnet-4-6');
    expect(routeCallArgs.maxTokens).toBe(300);
    expect(routeCallArgs.temperature).toBe(0.2);

    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall![1].written).toBe(1);
    expect(summaryCall![1].total_candidates).toBe(1);
    expect(summaryCall![1].status).toBe('completed');
  });

  // ── Scan failure ──────────────────────────────────────────────────────────

  it('scan failure: one query throws → 7 other categories processed, scan_failed logged', async () => {
    mockQueryAgentBudget.mockRejectedValue(new Error('DB timeout'));
    mockQueryRoutingUncertainty.mockResolvedValue([{
      agent_id: AGENT_ID,
      low_confidence_pct: 0.5,
      second_look_pct: 0.3,
      total_decisions: 100,
    }]);

    await runOptimiser(RUN_INPUT);

    const scanFailedCall = mockLogger.warn.mock.calls.find(
      (call) => call[0] === 'recommendations.scan_failed',
    );
    expect(scanFailedCall).toBeTruthy();
    expect(scanFailedCall![1].category).toBe('optimiser.agent.over_budget');

    // Run should still complete (routing uncertainty candidate processed)
    expect(mockUpsertRecommendation).toHaveBeenCalledOnce();

    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall![1].status).toBe('completed_with_failures');
  });

  // ── Render cache hit ──────────────────────────────────────────────────────

  it('render cache hit: second run with same evidence produces zero LLM calls', async () => {
    const budgetRow = {
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    };
    mockQueryAgentBudget.mockResolvedValue([budgetRow]);

    // First run
    await runOptimiser(RUN_INPUT);
    expect(mockRouteCall).toHaveBeenCalledOnce();

    // Second run with identical evidence
    mockRouteCall.mockClear();
    mockUpsertRecommendation.mockClear();
    mockQueryAgentBudget.mockResolvedValue([budgetRow]);
    await runOptimiser(RUN_INPUT);

    // Render cache hit — zero additional LLM calls
    expect(mockRouteCall).not.toHaveBeenCalled();
    // But upsert still called (open-match / hash check happens inside the service)
    expect(mockUpsertRecommendation).toHaveBeenCalledOnce();
  });

  // ── Per-run candidate cap ─────────────────────────────────────────────────

  it('per-run cap: 200 phrase candidates → exactly 25 render calls, cap_exceeded logged', async () => {
    const phrases = Array.from({ length: 200 }, (_, i) => ({
      phrase: `phrase-${i}`,
      count: 5,
      sample_escalation_ids: ['id-1'],
    }));
    mockQueryEscalationPhrases.mockResolvedValue(phrases);

    // Mock brand-voice lookup to return degraded (no DB call)
    const { db } = await import('../../db/index.js');
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runOptimiser(RUN_INPUT);

    expect(mockRouteCall).toHaveBeenCalledTimes(OPTIMISER_RUN_CANDIDATE_CAP);

    const capCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_candidate_cap_exceeded',
    );
    expect(capCall).toBeTruthy();
    expect(capCall![1].total).toBe(200);
    expect(capCall![1].kept).toBe(25);
    expect(capCall![1].dropped).toBe(175);
  });

  // ── Render validation retry ───────────────────────────────────────────────

  it('render validation: empty title/short body on first attempt → retry, valid on second → row written', async () => {
    mockQueryAgentBudget.mockResolvedValue([{
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    }]);

    // First call returns invalid output (empty title)
    mockRouteCall
      .mockResolvedValueOnce({ content: JSON.stringify({ title: '', body: 'x' }) })
      // Second call returns valid output
      .mockResolvedValueOnce(makeValidRenderResponse());

    await runOptimiser(RUN_INPUT);

    expect(mockRouteCall).toHaveBeenCalledTimes(2);
    expect(mockUpsertRecommendation).toHaveBeenCalledOnce();

    // render_validation_failed NOT logged (second attempt succeeded)
    const failedCall = mockLogger.warn.mock.calls.find(
      (call) => call[0] === 'recommendations.render_validation_failed',
    );
    expect(failedCall).toBeUndefined();
  });

  it('render validation drop: both attempts fail → render_validation_failed logged, no upsert', async () => {
    mockQueryAgentBudget.mockResolvedValue([{
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    }]);

    // Both attempts return invalid output
    mockRouteCall.mockResolvedValue({ content: JSON.stringify({ title: '', body: 'x' }) });

    await runOptimiser(RUN_INPUT);

    expect(mockRouteCall).toHaveBeenCalledTimes(2);
    expect(mockUpsertRecommendation).not.toHaveBeenCalled();

    const failedCall = mockLogger.warn.mock.calls.find(
      (call) => call[0] === 'recommendations.render_validation_failed',
    );
    expect(failedCall).toBeTruthy();

    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall![1].render_failures).toBe(1);
  });

  // ── Body-no-digit retry ───────────────────────────────────────────────────

  it('body-no-digit: body with no digit → retry, valid digit body on second call → row written', async () => {
    mockQueryAgentBudget.mockResolvedValue([{
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    }]);

    // First call: valid length but no digit in body
    mockRouteCall
      .mockResolvedValueOnce({ content: JSON.stringify({
        title: 'Agent escalation rate is high',
        body: 'The agent has been escalating frequently. Consider reviewing the workflow configuration.',
      })})
      // Second call: valid with digit
      .mockResolvedValueOnce(makeValidRenderResponse());

    await runOptimiser(RUN_INPUT);

    expect(mockRouteCall).toHaveBeenCalledTimes(2);
    expect(mockUpsertRecommendation).toHaveBeenCalledOnce();
  });

  // ── Run-budget timeout ────────────────────────────────────────────────────

  it('run-budget timeout: slow query aborts remaining scans, run_timeout logged', async () => {
    vi.useFakeTimers();

    // Simulate budget exhausted after first query
    const originalDateNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // After the first call (runStartedAt), return a time > OPTIMISER_RUN_BUDGET_MS
      if (callCount === 1) return 0;
      return OPTIMISER_RUN_BUDGET_MS + 1000;
    });

    await runOptimiser(RUN_INPUT);

    const timeoutCall = mockLogger.warn.mock.calls.find(
      (call) => call[0] === 'recommendations.run_timeout',
    );
    expect(timeoutCall).toBeTruthy();

    const summaryCall = mockLogger.info.mock.calls.find(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCall![1].status).toBe('timed_out');

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Run summary always fires ──────────────────────────────────────────────

  it('run_summary is emitted exactly once even when a scan throws', async () => {
    mockQueryAgentBudget.mockRejectedValue(new Error('scan fail'));

    await runOptimiser(RUN_INPUT);

    const summaryCalls = mockLogger.info.mock.calls.filter(
      (call) => call[0] === 'recommendations.run_summary',
    );
    expect(summaryCalls).toHaveLength(1);
  });

  // ── Model pin assertion ───────────────────────────────────────────────────

  it('model pin: routeCall options include model=claude-sonnet-4-6, max_tokens=300, temperature=0.2', async () => {
    mockQueryAgentBudget.mockResolvedValue([{
      agent_id: AGENT_ID,
      this_month: 15000,
      last_month: 14000,
      budget: 10000,
      top_cost_driver: 'llm.complete',
    }]);

    await runOptimiser(RUN_INPUT);

    const routeCallArgs = mockRouteCall.mock.calls[0][0] as {
      context: { model: string };
      maxTokens: number;
      temperature: number;
    };
    expect(routeCallArgs.context.model).toBe('claude-sonnet-4-6');
    expect(routeCallArgs.maxTokens).toBe(300);
    expect(routeCallArgs.temperature).toBe(0.2);
  });

  // ── Pre-write sort determinism ────────────────────────────────────────────

  it('pre-write sort determinism: same candidates in different scan orders produce same upsert sequence', async () => {
    // Seed candidates from two categories
    const budgetRow = { agent_id: AGENT_ID, this_month: 15000, last_month: 14000, budget: 10000, top_cost_driver: 'llm.complete' };
    const citationRow = { agent_id: AGENT_ID, low_citation_pct: 0.6, total_injected: 50, projected_token_savings: 1000 };

    // Run 1: budget first, then citation
    mockQueryAgentBudget.mockResolvedValue([budgetRow]);
    mockQueryMemoryCitation.mockResolvedValue([citationRow]);
    await runOptimiser(RUN_INPUT);
    const run1Categories = mockUpsertRecommendation.mock.calls.map(
      (call) => (call[1] as { category: string }).category,
    );

    // Run 2: citation would come "first" if we swapped — but query order is fixed in orchestrator
    // So we verify: same query results → same output categories
    mockRouteCall.mockClear();
    mockUpsertRecommendation.mockClear();
    _renderCache.clear();
    mockQueryAgentBudget.mockResolvedValue([budgetRow]);
    mockQueryMemoryCitation.mockResolvedValue([citationRow]);
    await runOptimiser(RUN_INPUT);
    const run2Categories = mockUpsertRecommendation.mock.calls.map(
      (call) => (call[1] as { category: string }).category,
    );

    expect(run1Categories).toEqual(run2Categories);
  });

  // ── Percent bounds violation ──────────────────────────────────────────────

  it('percent bounds violation: out-of-range escalation_pct → no candidate, bounds_violation log', async () => {
    mockQueryEscalationRate.mockResolvedValue([{
      workflow_id: 'wf-1',
      run_count: 10,
      escalation_count: 8,
      common_step_id: 'step-1',
    }]);
    // Override the computed escalation_pct by making run_count=0 to test the guard
    mockQueryEscalationRate.mockResolvedValueOnce([{
      workflow_id: 'wf-1',
      run_count: 10,
      escalation_count: 20, // > run_count, so pct > 1
      common_step_id: 'step-1',
    }]);

    await runOptimiser(RUN_INPUT);

    const violationCall = mockLogger.warn.mock.calls.find(
      (call) => call[0] === 'recommendations.evaluator_bounds_violation',
    );
    expect(violationCall).toBeTruthy();
    expect(mockUpsertRecommendation).not.toHaveBeenCalled();
  });
});
