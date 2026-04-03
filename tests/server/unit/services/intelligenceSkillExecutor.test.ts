import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock downstream dependencies
vi.mock('../../../../server/services/canonicalDataService.js', () => ({
  canonicalDataService: {
    getAccountsByOrg: vi.fn(),
    getAccountById: vi.fn(),
    getLatestHealthSnapshot: vi.fn(),
    getHealthHistory: vi.fn(),
    getContactMetrics: vi.fn(),
    getOpportunityMetrics: vi.fn(),
    getConversationMetrics: vi.fn(),
    getRevenueMetrics: vi.fn(),
    writeHealthSnapshot: vi.fn(),
    writeAnomalyEvent: vi.fn(),
  },
}));
vi.mock('../../../../server/services/subaccountTagService.js', () => ({
  subaccountTagService: { getSubaccountsByTags: vi.fn() },
}));
vi.mock('../../../../server/services/orgMemoryService.js', () => ({
  orgMemoryService: { getRelevantInsights: vi.fn(), listEntries: vi.fn(), getInsightsForPrompt: vi.fn() },
}));
vi.mock('../../../../server/services/workspaceMemoryService.js', () => ({
  workspaceMemoryService: {},
}));
vi.mock('../../../../server/services/taskService.js', () => ({
  taskService: {},
}));

import {
  executeQuerySubaccountCohort,
  executeReadOrgInsights,
  executeWriteOrgInsight,
  executeComputeHealthScore,
  executeDetectAnomaly,
  executeComputeChurnRisk,
  executeGeneratePortfolioReport,
} from '../../../../server/services/intelligenceSkillExecutor.js';
import { canonicalDataService } from '../../../../server/services/canonicalDataService.js';
import { subaccountTagService } from '../../../../server/services/subaccountTagService.js';
import type { SkillExecutionContext } from '../../../../server/services/skillExecutor.js';

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: 'run-1',
    organisationId: 'org-1',
    subaccountId: null,
    agentId: 'agent-1',
    orgProcesses: [],
    ...overrides,
  };
}

describe('executeQuerySubaccountCohort', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when called from subaccount context', async () => {
    const result = await executeQuerySubaccountCohort({}, makeContext({ subaccountId: 'sa-1' }));
    expect(result).toMatchObject({ error: expect.stringContaining('only available to org-level') });
  });

  it('returns empty when no subaccounts match filters', async () => {
    vi.mocked(subaccountTagService.getSubaccountsByTags).mockResolvedValue([]);

    const result = await executeQuerySubaccountCohort(
      { tag_filters: [{ key: 'tier', value: 'enterprise' }] },
      makeContext(),
    );
    expect(result).toMatchObject({ accounts: [], summary: expect.any(String) });
  });

  it('returns account data when subaccounts match', async () => {
    vi.mocked(subaccountTagService.getSubaccountsByTags).mockResolvedValue(['sa-1']);
    vi.mocked(canonicalDataService.getAccountsByOrg).mockResolvedValue([
      { id: 'acc-1', organisationId: 'org-1', subaccountId: 'sa-1', displayName: 'Test', externalId: 'ext-1', connectorConfigId: 'cc-1', status: 'active', externalMetadata: null, lastSyncAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as any,
    ]);
    vi.mocked(canonicalDataService.getLatestHealthSnapshot).mockResolvedValue({ score: 75, trend: 'stable' } as any);
    vi.mocked(canonicalDataService.getContactMetrics).mockResolvedValue({ growthRate: 10 } as any);
    vi.mocked(canonicalDataService.getOpportunityMetrics).mockResolvedValue({ pipelineValue: 5000, open: 3, staleDeals: 1 } as any);

    const result = await executeQuerySubaccountCohort(
      { tag_filters: [{ key: 'tier', value: 'premium' }] },
      makeContext(),
    ) as any;
    expect(result.matchedAccounts).toBe(1);
    expect(result.accounts[0].healthScore).toBe(75);
  });
});

describe('executeComputeHealthScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when account not found', async () => {
    vi.mocked(canonicalDataService.getAccountById).mockResolvedValue(null);
    const result = await executeComputeHealthScore({ account_id: 'missing' }, makeContext());
    expect(result).toMatchObject({ error: expect.stringContaining('not found') });
  });

  it('computes a score from canonical metrics', async () => {
    vi.mocked(canonicalDataService.getAccountById).mockResolvedValue({ id: 'acc-1', lastSyncAt: new Date() } as any);
    vi.mocked(canonicalDataService.getContactMetrics).mockResolvedValue({ total: 100, growthRate: 10 } as any);
    vi.mocked(canonicalDataService.getOpportunityMetrics).mockResolvedValue({ open: 5, staleDeals: 1 } as any);
    vi.mocked(canonicalDataService.getConversationMetrics).mockResolvedValue({ total: 20, active: 15 } as any);
    vi.mocked(canonicalDataService.getRevenueMetrics).mockResolvedValue({ totalRevenue: 5000, transactionCount: 10 } as any);
    vi.mocked(canonicalDataService.getHealthHistory).mockResolvedValue([]);
    vi.mocked(canonicalDataService.writeHealthSnapshot).mockResolvedValue({ id: 'snap-1' } as any);

    const result = await executeComputeHealthScore({ account_id: 'acc-1' }, makeContext()) as any;
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(5);
    expect(result.snapshotId).toBe('snap-1');
  });
});

describe('executeDetectAnomaly', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when required params missing', async () => {
    const result = await executeDetectAnomaly({}, makeContext());
    expect(result).toMatchObject({ error: expect.stringContaining('required') });
  });

  it('returns no anomaly when insufficient history', async () => {
    vi.mocked(canonicalDataService.getHealthHistory).mockResolvedValue([{ score: 50 }] as any);
    const result = await executeDetectAnomaly(
      { account_id: 'acc-1', metric_name: 'health_score', current_value: 50 },
      makeContext(),
    ) as any;
    expect(result.anomalyDetected).toBe(false);
    expect(result.reason).toContain('Insufficient');
  });

  it('detects anomaly when value exceeds threshold', async () => {
    // History with varied scores (mean ~50, std dev ~5)
    const history = [
      { score: 48 }, { score: 52 }, { score: 47 }, { score: 53 },
      { score: 49 }, { score: 51 }, { score: 50 }, { score: 48 },
      { score: 52 }, { score: 50 },
    ];
    vi.mocked(canonicalDataService.getHealthHistory).mockResolvedValue(history as any);
    vi.mocked(canonicalDataService.writeAnomalyEvent).mockResolvedValue({} as any);

    // Value of 5 is ~9 std devs below mean of 50 — definite anomaly
    const result = await executeDetectAnomaly(
      { account_id: 'acc-1', metric_name: 'health_score', current_value: 5 },
      makeContext(),
    ) as any;
    expect(result.anomalyDetected).toBe(true);
    expect(result.severity).toBeDefined();
  });
});

describe('executeComputeChurnRisk', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when account_id missing', async () => {
    const result = await executeComputeChurnRisk({}, makeContext());
    expect(result).toMatchObject({ error: expect.stringContaining('required') });
  });

  it('computes risk score from health and metrics', async () => {
    vi.mocked(canonicalDataService.getHealthHistory).mockResolvedValue([
      { score: 40 }, { score: 45 }, { score: 50 },
      { score: 60 }, { score: 65 }, { score: 70 },
    ] as any);
    vi.mocked(canonicalDataService.getOpportunityMetrics).mockResolvedValue({ open: 5, staleDeals: 3 } as any);
    vi.mocked(canonicalDataService.getConversationMetrics).mockResolvedValue({ total: 10, active: 2 } as any);

    const result = await executeComputeChurnRisk({ account_id: 'acc-1' }, makeContext()) as any;
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(result.interventionType).toBeDefined();
    expect(result.drivers).toBeInstanceOf(Array);
  });
});

describe('executeReadOrgInsights', () => {
  it('rejects subaccount context', async () => {
    const result = await executeReadOrgInsights({}, makeContext({ subaccountId: 'sa-1' }));
    expect(result).toMatchObject({ error: expect.stringContaining('only available to org-level') });
  });
});

describe('executeWriteOrgInsight', () => {
  it('rejects subaccount context', async () => {
    const result = await executeWriteOrgInsight({}, makeContext({ subaccountId: 'sa-1' }));
    expect(result).toMatchObject({ error: expect.stringContaining('only available to org-level') });
  });
});

describe('executeGeneratePortfolioReport', () => {
  it('rejects subaccount context', async () => {
    const result = await executeGeneratePortfolioReport({}, makeContext({ subaccountId: 'sa-1' }));
    expect(result).toMatchObject({ error: expect.stringContaining('only available to org-level') });
  });
});
