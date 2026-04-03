import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockProviderAdapter, mockBudgetService, mockPricingService, mockDbInsert } = vi.hoisted(() => {
  const mockProviderAdapter = {
    call: vi.fn(),
  };
  const mockBudgetService = {
    checkAndReserve: vi.fn().mockResolvedValue('res-1'),
    commitReservation: vi.fn().mockResolvedValue(undefined),
    releaseReservation: vi.fn().mockResolvedValue(undefined),
  };
  const mockPricingService = {
    getPricing: vi.fn().mockResolvedValue({ inputRate: 0.003, outputRate: 0.015 }),
    getMargin: vi.fn().mockResolvedValue({ multiplier: 1.3, fixedFeeCents: 0 }),
    calculateCost: vi.fn().mockResolvedValue({
      costRaw: 0.01,
      costWithMargin: 0.013,
      costWithMarginCents: 1,
      marginMultiplier: 1.3,
      fixedFeeCents: 0,
    }),
    estimateCost: vi.fn().mockResolvedValue(5),
  };
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const mockDbInsertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: mockOnConflictDoUpdate,
    onConflictDoNothing: mockOnConflictDoNothing,
  });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockDbInsertValues });
  return { mockProviderAdapter, mockBudgetService, mockPricingService, mockDbInsert };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../server/db/index.js', () => {
  const mockSelectForUpdateWhere = vi.fn().mockReturnValue({
    for: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  });
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: mockSelectForUpdateWhere,
        }),
      }),
      insert: mockDbInsert,
      transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        };
        return cb(tx);
      }),
    },
  };
});

vi.mock('../../../../server/db/schema/index.js', () => ({
  llmRequests: {
    idempotencyKey: 'idempotencyKey',
    status: 'status',
  },
  TASK_TYPES: ['agent_run', 'skill_execution', 'memory_compile', 'system'],
  SOURCE_TYPES: ['agent_run', 'api_call', 'system', 'scheduler'],
}));

vi.mock('../../../../server/instrumentation.js', () => ({
  getActiveTrace: () => null,
}));

vi.mock('../../../../server/services/providers/registry.js', () => ({
  getProviderAdapter: vi.fn().mockReturnValue(mockProviderAdapter),
}));

vi.mock('../../../../server/services/pricingService.js', () => ({
  pricingService: mockPricingService,
}));

vi.mock('../../../../server/services/budgetService.js', () => ({
  budgetService: mockBudgetService,
  BudgetExceededError: class BudgetExceededError extends Error {
    constructor(public limitType: string, public limitCents: number, public projectedCents: number, public entityId: string) {
      super(`Budget exceeded: ${limitType}`);
      this.name = 'BudgetExceededError';
    }
  },
  RateLimitError: class RateLimitError extends Error {
    constructor(public limitType: string, public windowKey: string) {
      super(`Rate limit exceeded: ${limitType}`);
      this.name = 'RateLimitError';
    }
  },
}));

vi.mock('../../../../server/config/limits.js', () => ({
  PROVIDER_CALL_TIMEOUT_MS: 30000,
  PROVIDER_MAX_RETRIES: 2,
  PROVIDER_BACKOFF_MS: [100, 200],
  PROVIDER_FALLBACK_CHAIN: ['anthropic', 'openai', 'gemini'],
  PROVIDER_COOLDOWN_MS: 60000,
}));

vi.mock('../../../../server/services/routerJobService.js', () => ({
  routerJobService: {
    enqueueAggregateUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { routeCall } from '../../../../server/services/llmRouter.js';
import type { RouterCallParams } from '../../../../server/services/llmRouter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(overrides: Partial<RouterCallParams> = {}): RouterCallParams {
  return {
    messages: [{ role: 'user' as const, content: 'Hello' }],
    context: {
      organisationId: '00000000-0000-4000-a000-000000000001',
      subaccountId: '00000000-0000-4000-a000-000000000002',
      runId: '00000000-0000-4000-a000-000000000003',
      sourceType: 'agent_run',
      taskType: 'agent_run',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    ...overrides,
  };
}

function makeProviderResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: 'Hello back',
    stopReason: 'end_turn',
    tokensIn: 100,
    tokensOut: 50,
    providerRequestId: 'prov-req-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('llmRouter.routeCall', () => {
  function resetMockDefaults() {
    mockBudgetService.checkAndReserve.mockResolvedValue('res-1');
    mockBudgetService.commitReservation.mockResolvedValue(undefined);
    mockBudgetService.releaseReservation.mockResolvedValue(undefined);
    mockPricingService.getPricing.mockResolvedValue({ inputRate: 0.003, outputRate: 0.015 });
    mockPricingService.getMargin.mockResolvedValue({ multiplier: 1.3, fixedFeeCents: 0 });
    mockPricingService.calculateCost.mockResolvedValue({
      costRaw: 0.01,
      costWithMargin: 0.013,
      costWithMarginCents: 1,
      marginMultiplier: 1.3,
      fixedFeeCents: 0,
    });
    mockPricingService.estimateCost.mockResolvedValue(5);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockDefaults();
  });

  // ── Success-path tests (run first, no cooldown pollution) ──────────────

  it('calls the provider and returns the response', async () => {
    const expectedResponse = makeProviderResponse();
    mockProviderAdapter.call.mockResolvedValue(expectedResponse);

    const result = await routeCall(makeParams());

    expect(result.content).toBe('Hello back');
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(mockProviderAdapter.call).toHaveBeenCalled();
  });

  it('validates context schema and rejects invalid input', async () => {
    await expect(
      routeCall({
        messages: [{ role: 'user', content: 'Hi' }],
        context: {
          organisationId: 'not-a-uuid',
          sourceType: 'agent_run',
          taskType: 'agent_run',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
        } as any,
      }),
    ).rejects.toThrow();
  });

  it('checks budget reservation before calling provider', async () => {
    mockProviderAdapter.call.mockResolvedValue(makeProviderResponse());

    await routeCall(makeParams());

    expect(mockBudgetService.checkAndReserve).toHaveBeenCalled();
    expect(mockPricingService.estimateCost).toHaveBeenCalled();
  });

  it('commits reservation with actual cost after successful call', async () => {
    mockProviderAdapter.call.mockResolvedValue(makeProviderResponse());

    await routeCall(makeParams());

    expect(mockBudgetService.commitReservation).toHaveBeenCalledWith('res-1', 1);
  });

  it('records usage metrics via pricing service', async () => {
    mockProviderAdapter.call.mockResolvedValue(makeProviderResponse());

    await routeCall(makeParams());

    expect(mockPricingService.calculateCost).toHaveBeenCalledWith(
      'anthropic',
      'claude-sonnet-4-6',
      100,
      50,
      '00000000-0000-4000-a000-000000000001',
    );
  });

  it('writes ledger record to llmRequests table', async () => {
    mockProviderAdapter.call.mockResolvedValue(makeProviderResponse());

    await routeCall(makeParams());

    expect(mockDbInsert).toHaveBeenCalled();
  });

  // ── Budget-blocked tests (no provider call, no cooldown) ──────────────

  it('throws 402 when budget is exceeded', async () => {
    const { BudgetExceededError } = await import('../../../../server/services/budgetService.js');
    mockBudgetService.checkAndReserve.mockRejectedValue(
      new BudgetExceededError('monthly_org', 1000, 1500, 'org-1'),
    );

    await expect(routeCall(makeParams())).rejects.toMatchObject({
      statusCode: 402,
      code: 'BUDGET_EXCEEDED',
    });
  });

  it('throws 402 when rate limited', async () => {
    const { RateLimitError } = await import('../../../../server/services/budgetService.js');
    mockBudgetService.checkAndReserve.mockRejectedValue(
      new RateLimitError('requests_per_minute', '2026-04-03T10:30'),
    );

    await expect(routeCall(makeParams())).rejects.toMatchObject({
      statusCode: 402,
      code: 'RATE_LIMITED',
    });
  });

  // ── Provider failure tests (cause cooldown — keep last) ───────────────

  it('does not retry non-retryable errors (401) and releases reservation', async () => {
    const authError = { statusCode: 401, code: 'auth_error', message: 'Bad key' };
    mockProviderAdapter.call.mockRejectedValue(authError);

    await expect(routeCall(makeParams())).rejects.toBeDefined();

    expect(mockBudgetService.releaseReservation).toHaveBeenCalledWith('res-1');
  });

  it('releases reservation when all providers fail', async () => {
    mockProviderAdapter.call.mockRejectedValue(new Error('Provider down'));

    await expect(routeCall(makeParams())).rejects.toThrow();

    expect(mockBudgetService.releaseReservation).toHaveBeenCalledWith('res-1');
  });
});
