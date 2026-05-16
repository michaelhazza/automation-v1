import { db } from '../db/index.js';
import {
  llmRequests,
  costAggregates,
  llmPricing,
  orgMarginConfigs,
  orgComputeBudgets,
  workspaceLimits,
  agentRuns,
  subaccounts,
  subaccountAgents,
} from '../db/schema/index.js';
import type { LlmRequest } from '../db/schema/index.js';
import { and, eq, desc, lt, sql, or, isNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// LLM Usage Service — queries for routing debug & reporting UI.
//
// All distribution aggregations are computed in SQL (GROUP BY + conditional
// aggregates). No full-table scans into JS memory.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutingLogFilters {
  organisationId: string;
  subaccountId?: string;
  billingMonth?: string;
  provider?: string;
  model?: string;
  routingReason?: string;
  capabilityTier?: string;
  executionPhase?: string;
  status?: string;
  agentName?: string;
  wasDowngraded?: boolean;
  wasEscalated?: boolean;
  runId?: string;
}

export interface RoutingLogPagination {
  cursor?: string;    // ISO timestamp
  cursorId?: string;  // UUID
  limit?: number;     // default 50, max 100
}

export interface RoutingDistributionResult {
  totalRequests: number;
  totalCostCents: number;
  byTier: { frontier: number; economy: number };
  byReason: Record<string, number>;
  byPhase: Record<string, number>;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  costByTier: { frontier: number; economy: number };
  costByReason: Record<string, number>;
  latencyByProvider: Record<string, number>;
  latencyByTier: { frontier: number; economy: number };
  fallbackPct: number;
  escalationPct: number;
  downgradePct: number;
}

// ---------------------------------------------------------------------------
// Filter builder — shared between log and distribution queries
// ---------------------------------------------------------------------------

function buildWhereConditions(filters: RoutingLogFilters) {
  const conditions = [eq(llmRequests.organisationId, filters.organisationId)];

  if (filters.subaccountId) {
    conditions.push(eq(llmRequests.subaccountId, filters.subaccountId));
  }

  const billingMonth = filters.billingMonth || new Date().toISOString().slice(0, 7);
  conditions.push(eq(llmRequests.billingMonth, billingMonth));

  if (filters.provider) conditions.push(eq(llmRequests.provider, filters.provider));
  if (filters.model) conditions.push(eq(llmRequests.model, filters.model));
  if (filters.routingReason) conditions.push(eq(llmRequests.routingReason, filters.routingReason));
  if (filters.capabilityTier) conditions.push(eq(llmRequests.capabilityTier, filters.capabilityTier));
  if (filters.executionPhase) conditions.push(eq(llmRequests.executionPhase, filters.executionPhase));
  if (filters.status) conditions.push(eq(llmRequests.status, filters.status));
  if (filters.agentName) conditions.push(eq(llmRequests.agentName, filters.agentName));
  if (filters.runId) conditions.push(eq(llmRequests.runId, filters.runId));

  if (filters.wasDowngraded !== undefined) {
    conditions.push(eq(llmRequests.wasDowngraded, filters.wasDowngraded));
  }
  if (filters.wasEscalated !== undefined) {
    conditions.push(eq(llmRequests.wasEscalated, filters.wasEscalated));
  }

  return and(...conditions)!;
}

// ---------------------------------------------------------------------------
// getRoutingLog — paginated, filtered request log
// ---------------------------------------------------------------------------

export async function getRoutingLog(
  filters: RoutingLogFilters,
  pagination: RoutingLogPagination,
): Promise<{ items: LlmRequest[]; nextCursor: string | null; nextCursorId: string | null }> {
  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 100);
  const where = buildWhereConditions(filters);

  // Composite cursor: (createdAt DESC, id DESC)
  let cursorCondition;
  if (pagination.cursor && pagination.cursorId) {
    cursorCondition = or(
      lt(llmRequests.createdAt, new Date(pagination.cursor)),
      and(
        eq(llmRequests.createdAt, new Date(pagination.cursor)),
        lt(llmRequests.id, pagination.cursorId),
      ),
    );
  }

  const finalWhere = cursorCondition ? and(where, cursorCondition)! : where;

  const items = await db
    .select()
    .from(llmRequests)
    .where(finalWhere)
    .orderBy(desc(llmRequests.createdAt), desc(llmRequests.id))
    .limit(limit + 1); // fetch one extra to detect next page

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  const lastItem = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && lastItem ? lastItem.createdAt.toISOString() : null,
    nextCursorId: hasMore && lastItem ? lastItem.id : null,
  };
}

// ---------------------------------------------------------------------------
// getRoutingDistribution — aggregated stats for charts + anomaly flags
// ---------------------------------------------------------------------------

export async function getRoutingDistribution(
  filters: { organisationId: string; subaccountId?: string; billingMonth?: string },
): Promise<RoutingDistributionResult> {
  const billingMonth = filters.billingMonth || new Date().toISOString().slice(0, 7);

  const scopeConditions = [
    eq(llmRequests.organisationId, filters.organisationId),
    eq(llmRequests.billingMonth, billingMonth),
  ];
  if (filters.subaccountId) {
    scopeConditions.push(eq(llmRequests.subaccountId, filters.subaccountId));
  }
  const where = and(...scopeConditions)!;

  // All distribution queries run in parallel — they all hit the same indexed range
  const [
    [result],
    reasonRows,
    phaseRows,
    statusRows,
    providerRows,
  ] = await Promise.all([
    // Main conditional aggregates — totals, tier splits, anomaly signals
    db
      .select({
        totalRequests:    sql<number>`count(*)::int`,
        totalCostCents:   sql<number>`coalesce(sum(${llmRequests.costWithMarginCents}), 0)::int`,
        frontierCount:    sql<number>`count(*) filter (where ${llmRequests.capabilityTier} = 'frontier')::int`,
        economyCount:     sql<number>`count(*) filter (where ${llmRequests.capabilityTier} = 'economy')::int`,
        frontierCost:     sql<number>`coalesce(sum(${llmRequests.costWithMarginCents}) filter (where ${llmRequests.capabilityTier} = 'frontier'), 0)::int`,
        economyCost:      sql<number>`coalesce(sum(${llmRequests.costWithMarginCents}) filter (where ${llmRequests.capabilityTier} = 'economy'), 0)::int`,
        frontierLatency:  sql<number>`coalesce(avg(${llmRequests.providerLatencyMs}) filter (where ${llmRequests.capabilityTier} = 'frontier'), 0)::int`,
        economyLatency:   sql<number>`coalesce(avg(${llmRequests.providerLatencyMs}) filter (where ${llmRequests.capabilityTier} = 'economy'), 0)::int`,
        fallbackCount:    sql<number>`count(*) filter (where ${llmRequests.fallbackChain} is not null)::int`,
        escalationCount:  sql<number>`count(*) filter (where ${llmRequests.wasEscalated} = true)::int`,
        downgradeCount:   sql<number>`count(*) filter (where ${llmRequests.wasDowngraded} = true)::int`,
      })
      .from(llmRequests)
      .where(where),

    // By reason
    db
      .select({
        reason: llmRequests.routingReason,
        count:  sql<number>`count(*)::int`,
        cost:   sql<number>`coalesce(sum(${llmRequests.costWithMarginCents}), 0)::int`,
      })
      .from(llmRequests)
      .where(where)
      .groupBy(llmRequests.routingReason),

    // By phase
    db
      .select({
        phase: llmRequests.executionPhase,
        count: sql<number>`count(*)::int`,
      })
      .from(llmRequests)
      .where(where)
      .groupBy(llmRequests.executionPhase),

    // By status
    db
      .select({
        status: llmRequests.status,
        count:  sql<number>`count(*)::int`,
      })
      .from(llmRequests)
      .where(where)
      .groupBy(llmRequests.status),

    // By provider (count + latency)
    db
      .select({
        provider: llmRequests.provider,
        count:    sql<number>`count(*)::int`,
        latency:  sql<number>`coalesce(avg(${llmRequests.providerLatencyMs}), 0)::int`,
      })
      .from(llmRequests)
      .where(where)
      .groupBy(llmRequests.provider),
  ]);

  // Build record maps
  const byReason: Record<string, number> = {};
  const costByReason: Record<string, number> = {};
  for (const r of reasonRows) {
    if (r.reason) {
      byReason[r.reason] = r.count;
      costByReason[r.reason] = r.cost;
    }
  }

  const byPhase: Record<string, number> = {};
  for (const r of phaseRows) {
    // executionPhase is nullable post-migration 0185; skip unattributed rows.
    if (r.phase) byPhase[r.phase] = r.count;
  }

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const byProvider: Record<string, number> = {};
  const latencyByProvider: Record<string, number> = {};
  for (const r of providerRows) {
    byProvider[r.provider] = r.count;
    latencyByProvider[r.provider] = r.latency;
  }

  const total = result.totalRequests || 1; // avoid division by zero

  return {
    totalRequests:    result.totalRequests,
    totalCostCents:   result.totalCostCents,
    byTier:           { frontier: result.frontierCount, economy: result.economyCount },
    byReason,
    byPhase,
    byStatus,
    byProvider,
    costByTier:       { frontier: result.frontierCost, economy: result.economyCost },
    costByReason,
    latencyByProvider,
    latencyByTier:    { frontier: result.frontierLatency, economy: result.economyLatency },
    fallbackPct:      result.fallbackCount / total,
    escalationPct:    result.escalationCount / total,
    downgradePct:     result.downgradeCount / total,
  };
}

// ---------------------------------------------------------------------------
// getRequestDetail — single request by ID, scoped to org
// ---------------------------------------------------------------------------

export async function getRequestDetail(
  id: string,
  organisationId: string,
): Promise<LlmRequest | null> {
  const [row] = await db
    .select()
    .from(llmRequests)
    .where(and(eq(llmRequests.id, id), eq(llmRequests.organisationId, organisationId)))
    .limit(1);

  return row ?? null;
}

// ---------------------------------------------------------------------------
// getOrgUsageSummary — org-level monthly + daily aggregates + top subaccounts
// ---------------------------------------------------------------------------

export interface OrgUsageSummary {
  period: string;
  monthly: typeof costAggregates.$inferSelect | null;
  today: typeof costAggregates.$inferSelect | null;
  topSubaccounts: typeof costAggregates.$inferSelect[];
}

export async function getOrgUsageSummary(orgId: string, billingMonth: string): Promise<OrgUsageSummary> {
  const today = new Date().toISOString().slice(0, 10);

  const [monthly, daily, topSubaccounts] = await Promise.all([
    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'organisation'),
        eq(costAggregates.entityId, orgId),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    ).limit(1),

    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'organisation'),
        eq(costAggregates.entityId, orgId),
        eq(costAggregates.periodType, 'daily'),
        eq(costAggregates.periodKey, today),
      ),
    ).limit(1),

    db.select({ costAggregate: costAggregates })
      .from(costAggregates)
      .innerJoin(subaccounts, and(eq(costAggregates.entityId, subaccounts.id), isNull(subaccounts.deletedAt)))
      .where(
        and(
          eq(costAggregates.entityType, 'subaccount'),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
          eq(subaccounts.organisationId, orgId),
        ),
      ).orderBy(desc(costAggregates.totalCostCents)).limit(10)
      .then(rows => rows.map(r => r.costAggregate)),
  ]);

  return {
    period: billingMonth,
    monthly: monthly[0] ?? null,
    today: daily[0] ?? null,
    topSubaccounts,
  };
}

// ---------------------------------------------------------------------------
// getOrgUsageByAgent — org-level cost aggregates grouped by agent
// ---------------------------------------------------------------------------

export async function getOrgUsageByAgent(orgId: string, billingMonth: string) {
  return db.select().from(costAggregates).where(
    and(
      eq(costAggregates.entityType, 'agent'),
      eq(costAggregates.periodType, 'monthly'),
      eq(costAggregates.periodKey, billingMonth),
      sql`${costAggregates.entityId} LIKE ${orgId + ':%'}`,
    ),
  ).orderBy(desc(costAggregates.totalCostCents));
}

// ---------------------------------------------------------------------------
// getOrgUsageByModel — per-model breakdown scoped to org
// ---------------------------------------------------------------------------

export async function getOrgUsageByModel(orgId: string, billingMonth: string) {
  return db
    .select({
      provider:       llmRequests.provider,
      model:          llmRequests.model,
      requestCount:   sql<number>`count(*)`,
      totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})`,
      totalTokensIn:  sql<number>`sum(${llmRequests.tokensIn})`,
      totalTokensOut: sql<number>`sum(${llmRequests.tokensOut})`,
      avgLatencyMs:   sql<number>`avg(${llmRequests.providerLatencyMs})`,
      errorCount:     sql<number>`count(*) filter (where ${llmRequests.status} != 'success')`,
    })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.organisationId, orgId),
        eq(llmRequests.billingMonth, billingMonth),
      ),
    )
    .groupBy(llmRequests.provider, llmRequests.model)
    .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`));
}

// ---------------------------------------------------------------------------
// getOrgUsageByProvider — per-provider breakdown scoped to org
// ---------------------------------------------------------------------------

export async function getOrgUsageByProvider(orgId: string, billingMonth: string) {
  return db
    .select({
      provider:       llmRequests.provider,
      totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})`,
      requestCount:   sql<number>`count(*)`,
      totalTokensIn:  sql<number>`sum(${llmRequests.tokensIn})`,
      totalTokensOut: sql<number>`sum(${llmRequests.tokensOut})`,
    })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.organisationId, orgId),
        eq(llmRequests.billingMonth, billingMonth),
      ),
    )
    .groupBy(llmRequests.provider)
    .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`));
}

// ---------------------------------------------------------------------------
// getSubaccountUsageSummary — subaccount monthly + daily aggregates + limits
// ---------------------------------------------------------------------------

export interface SubaccountUsageSummary {
  period: string;
  monthly: typeof costAggregates.$inferSelect | null;
  today: typeof costAggregates.$inferSelect | null;
  limits: typeof workspaceLimits.$inferSelect | null;
}

export async function getSubaccountUsageSummary(subaccountId: string, billingMonth: string): Promise<SubaccountUsageSummary> {
  const today = new Date().toISOString().slice(0, 10);

  const [monthly, daily, limits] = await Promise.all([
    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'subaccount'),
        eq(costAggregates.entityId, subaccountId),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    ).limit(1),
    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'subaccount'),
        eq(costAggregates.entityId, subaccountId),
        eq(costAggregates.periodType, 'daily'),
        eq(costAggregates.periodKey, today),
      ),
    ).limit(1),
    db.select().from(workspaceLimits).where(eq(workspaceLimits.subaccountId, subaccountId)).limit(1),
  ]);

  return {
    period: billingMonth,
    monthly: monthly[0] ?? null,
    today: daily[0] ?? null,
    limits: limits[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// getSubaccountUsageByAgent — per-agent breakdown within a subaccount
// ---------------------------------------------------------------------------

export async function getSubaccountUsageByAgent(subaccountId: string, billingMonth: string) {
  return db
    .select({
      agentName:      llmRequests.agentName,
      requestCount:   sql<number>`count(*)::int`,
      totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})::int`,
      totalTokensIn:  sql<number>`sum(${llmRequests.tokensIn})::int`,
      totalTokensOut: sql<number>`sum(${llmRequests.tokensOut})::int`,
      errorCount:     sql<number>`count(*) filter (where ${llmRequests.status} != 'success')::int`,
    })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.subaccountId, subaccountId),
        eq(llmRequests.billingMonth, billingMonth),
      ),
    )
    .groupBy(llmRequests.agentName)
    .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`));
}

// ---------------------------------------------------------------------------
// getSubaccountUsageByModel — per-model breakdown within a subaccount
// ---------------------------------------------------------------------------

export async function getSubaccountUsageByModel(subaccountId: string, billingMonth: string) {
  return db
    .select({
      provider:       llmRequests.provider,
      model:          llmRequests.model,
      requestCount:   sql<number>`count(*)::int`,
      totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})::int`,
      totalTokensIn:  sql<number>`sum(${llmRequests.tokensIn})::int`,
      totalTokensOut: sql<number>`sum(${llmRequests.tokensOut})::int`,
      avgLatencyMs:   sql<number>`avg(${llmRequests.providerLatencyMs})::int`,
    })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.subaccountId, subaccountId),
        eq(llmRequests.billingMonth, billingMonth),
      ),
    )
    .groupBy(llmRequests.provider, llmRequests.model)
    .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`));
}

// ---------------------------------------------------------------------------
// getSubaccountUsageByRun — run-level cost aggregates within a subaccount
// ---------------------------------------------------------------------------

export async function getSubaccountUsageByRun(subaccountId: string, orgId: string) {
  return db
    .select({
      id: costAggregates.id,
      entityType: costAggregates.entityType,
      entityId: costAggregates.entityId,
      periodType: costAggregates.periodType,
      periodKey: costAggregates.periodKey,
      totalCostRaw: costAggregates.totalCostRaw,
      totalCostWithMargin: costAggregates.totalCostWithMargin,
      totalCostCents: costAggregates.totalCostCents,
      totalTokensIn: costAggregates.totalTokensIn,
      totalTokensOut: costAggregates.totalTokensOut,
      requestCount: costAggregates.requestCount,
      errorCount: costAggregates.errorCount,
      updatedAt: costAggregates.updatedAt,
    })
    .from(costAggregates)
    .innerJoin(agentRuns, eq(costAggregates.entityId, agentRuns.id))
    .where(
      and(
        eq(costAggregates.entityType, 'run'),
        eq(costAggregates.periodType, 'run'),
        eq(agentRuns.subaccountId, subaccountId),
        eq(agentRuns.organisationId, orgId),
        eq(agentRuns.isTestRun, false),
      ),
    )
    .orderBy(desc(costAggregates.updatedAt))
    .limit(50);
}

// ---------------------------------------------------------------------------
// getRunCost — live cost for an active run (org-scoped)
// ---------------------------------------------------------------------------

export interface RunCostResult {
  entityId: string;
  totalCostCents: number;
  requestCount: number;
  llmCallCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  successfulCostCents: number;
  callSiteBreakdown: {
    app: { costCents: number; requestCount: number };
    worker: { costCents: number; requestCount: number };
  };
}

export async function getRunOrg(runId: string): Promise<{ organisationId: string } | null> {
  const [run] = await db.select({ organisationId: agentRuns.organisationId })
    .from(agentRuns).where(eq(agentRuns.id, runId));
  return run ?? null;
}

export async function getRunCost(runId: string): Promise<RunCostResult> {
  const [runAgg] = await db.select().from(costAggregates).where(
    and(
      eq(costAggregates.entityType, 'run'),
      eq(costAggregates.entityId, runId),
      eq(costAggregates.periodType, 'run'),
      eq(costAggregates.periodKey, runId),
    ),
  );

  const [ledgerTotals] = await db.execute<{
    llm_call_count:       number | string;
    tokens_in:            number | string | null;
    tokens_out:           number | string | null;
    successful_cost_cents: number | string | null;
  }>(sql`
    SELECT
      COUNT(*)::int                       AS llm_call_count,
      COALESCE(SUM(tokens_in), 0)::int    AS tokens_in,
      COALESCE(SUM(tokens_out), 0)::int   AS tokens_out,
      COALESCE(SUM(cost_cents) FILTER (WHERE status IN ('success', 'partial')), 0) AS successful_cost_cents
    FROM llm_requests_all
    WHERE run_id = ${runId}
      AND status IN ('success', 'partial')
  `);

  const callSiteRows = await db.execute<{
    call_site:     'app' | 'worker' | string;
    cost_cents:    number | string | null;
    request_count: number | string;
  }>(sql`
    SELECT
      call_site,
      COALESCE(SUM(cost_with_margin_cents), 0)::int AS cost_cents,
      COUNT(*)::int                                 AS request_count
    FROM llm_requests_all
    WHERE run_id = ${runId}
      AND status IN ('success', 'partial')
    GROUP BY call_site
  `);

  const callSiteBreakdown = {
    app:    { costCents: 0, requestCount: 0 },
    worker: { costCents: 0, requestCount: 0 },
  };
  for (const row of callSiteRows) {
    const bucket =
      row.call_site === 'worker' ? callSiteBreakdown.worker :
      row.call_site === 'app'    ? callSiteBreakdown.app    :
      null;
    if (!bucket) continue;
    bucket.costCents    = Number(row.cost_cents ?? 0);
    bucket.requestCount = Number(row.request_count ?? 0);
  }

  return {
    entityId:            runAgg?.entityId ?? runId,
    totalCostCents:      runAgg?.totalCostCents ?? 0,
    requestCount:        runAgg?.requestCount   ?? 0,
    llmCallCount:        Number(ledgerTotals?.llm_call_count        ?? 0),
    totalTokensIn:       Number(ledgerTotals?.tokens_in             ?? 0),
    totalTokensOut:      Number(ledgerTotals?.tokens_out            ?? 0),
    successfulCostCents: Number(ledgerTotals?.successful_cost_cents ?? 0),
    callSiteBreakdown,
  };
}

// ---------------------------------------------------------------------------
// getAdminUsageOverview — platform-wide org + provider cost aggregates
// ---------------------------------------------------------------------------

export interface AdminUsageOverview {
  period: string;
  organisations: typeof costAggregates.$inferSelect[];
  providers: typeof costAggregates.$inferSelect[];
}

export async function getAdminUsageOverview(billingMonth: string): Promise<AdminUsageOverview> {
  const [orgs, providers] = await Promise.all([
    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'organisation'),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    ).orderBy(desc(costAggregates.totalCostCents)).limit(50),

    db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'provider'),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    ).orderBy(desc(costAggregates.totalCostCents)),
  ]);

  return { period: billingMonth, organisations: orgs, providers };
}

// ---------------------------------------------------------------------------
// getLlmPricing — all pricing rows ordered by provider + model
// ---------------------------------------------------------------------------

export async function getLlmPricing() {
  return db.select().from(llmPricing).orderBy(llmPricing.provider, llmPricing.model);
}

// ---------------------------------------------------------------------------
// getMarginConfigs — all org margin configs
// ---------------------------------------------------------------------------

export async function getMarginConfigs() {
  return db.select().from(orgMarginConfigs).orderBy(orgMarginConfigs.createdAt);
}

// ---------------------------------------------------------------------------
// getBillingInvoice — reconciled invoice data for a subaccount + period
// ---------------------------------------------------------------------------

export interface BillingInvoice {
  subaccountId: string;
  period: string;
  totalCostCents: number;
  mismatch: boolean;
  breakdown: {
    byAgent: Array<{ agentName: string | null; totalCostCents: number; requestCount: number }>;
    byModel: Array<{ provider: string; model: string; totalCostCents: number }>;
    byTaskType: Array<{ taskType: string | null; totalCostCents: number }>;
  };
  requestCount: number;
  errorCount: number;
  reconciledAt: string;
}

export async function getBillingInvoice(subaccountId: string, period: string): Promise<BillingInvoice> {
  const ledgerTotalRows = await db
    .select({ total: sql<number>`COALESCE(SUM(${llmRequests.costWithMarginCents}), 0)` })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.subaccountId, subaccountId),
        eq(llmRequests.billingMonth, period),
        eq(llmRequests.status, 'success'),
      ),
    );

  const [aggregateRow] = await db.select().from(costAggregates).where(
    and(
      eq(costAggregates.entityType, 'subaccount'),
      eq(costAggregates.entityId, subaccountId),
      eq(costAggregates.periodType, 'monthly'),
      eq(costAggregates.periodKey, period),
    ),
  );

  const ledger    = Number(ledgerTotalRows[0]?.total ?? 0);
  const aggregate = aggregateRow?.totalCostCents ?? 0;

  const [agentBreakdown, modelBreakdown, taskTypeBreakdown] = await Promise.all([
    db
      .select({
        agentName:      llmRequests.agentName,
        totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})`,
        requestCount:   sql<number>`count(*)`,
      })
      .from(llmRequests)
      .where(
        and(
          eq(llmRequests.subaccountId, subaccountId),
          eq(llmRequests.billingMonth, period),
          eq(llmRequests.status, 'success'),
        ),
      )
      .groupBy(llmRequests.agentName)
      .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`)),

    db
      .select({
        provider:       llmRequests.provider,
        model:          llmRequests.model,
        totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})`,
      })
      .from(llmRequests)
      .where(
        and(
          eq(llmRequests.subaccountId, subaccountId),
          eq(llmRequests.billingMonth, period),
          eq(llmRequests.status, 'success'),
        ),
      )
      .groupBy(llmRequests.provider, llmRequests.model),

    db
      .select({
        taskType:       llmRequests.taskType,
        totalCostCents: sql<number>`sum(${llmRequests.costWithMarginCents})`,
      })
      .from(llmRequests)
      .where(
        and(
          eq(llmRequests.subaccountId, subaccountId),
          eq(llmRequests.billingMonth, period),
          eq(llmRequests.status, 'success'),
        ),
      )
      .groupBy(llmRequests.taskType),
  ]);

  return {
    subaccountId,
    period,
    totalCostCents: ledger,
    mismatch: Math.abs(ledger - aggregate) > 0,
    breakdown: {
      byAgent:    agentBreakdown,
      byModel:    modelBreakdown,
      byTaskType: taskTypeBreakdown,
    },
    requestCount: aggregateRow?.requestCount ?? 0,
    errorCount:   aggregateRow?.errorCount ?? 0,
    reconciledAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getAgentBudget — per-agent budget config + spend for a subaccount
// ---------------------------------------------------------------------------

export interface AgentBudgetResult {
  period: string;
  agentId: string;
  subaccountId: string;
  spend: {
    totalCostCents: number;
    requestCount: number;
    totalTokensIn: number;
    totalTokensOut: number;
    errorCount: number;
  };
  config: {
    maxCostPerRunCents: number | null;
    maxLlmCallsPerRun: number | null;
    tokenBudgetPerRun: number | null;
  };
  limits: {
    monthlyCostLimitCents: number | null;
    dailyCostLimitCents: number | null;
    alertThresholdPct: number | null;
  } | null;
}

export async function getAgentBudget(
  subaccountId: string,
  agentId: string,
  orgId: string,
  billingMonth: string,
): Promise<AgentBudgetResult | null> {
  const [saLink] = await db.select().from(subaccountAgents).where(
    and(
      eq(subaccountAgents.subaccountId, subaccountId),
      eq(subaccountAgents.agentId, agentId),
      eq(subaccountAgents.organisationId, orgId),
    ),
  );

  if (!saLink) return null;

  const [[spend], [limits]] = await Promise.all([
    db
      .select({
        totalCostCents: sql<number>`COALESCE(sum(${llmRequests.costWithMarginCents}), 0)::int`,
        requestCount:   sql<number>`count(*)::int`,
        totalTokensIn:  sql<number>`COALESCE(sum(${llmRequests.tokensIn}), 0)::int`,
        totalTokensOut: sql<number>`COALESCE(sum(${llmRequests.tokensOut}), 0)::int`,
        errorCount:     sql<number>`count(*) filter (where ${llmRequests.status} != 'success')::int`,
      })
      .from(llmRequests)
      .where(
        and(
          eq(llmRequests.subaccountId, subaccountId),
          eq(llmRequests.billingMonth, billingMonth),
          sql`${llmRequests.runId} IN (
            SELECT id FROM agent_runs
            WHERE agent_id = ${agentId} AND subaccount_id = ${subaccountId}
          )`,
        ),
      ),

    db.select().from(workspaceLimits)
      .where(eq(workspaceLimits.subaccountId, subaccountId)).limit(1),
  ]);

  return {
    period: billingMonth,
    agentId,
    subaccountId,
    spend: spend ?? { totalCostCents: 0, requestCount: 0, totalTokensIn: 0, totalTokensOut: 0, errorCount: 0 },
    config: {
      maxCostPerRunCents: saLink.maxCostPerRunCents,
      maxLlmCallsPerRun:  saLink.maxLlmCallsPerRun,
      tokenBudgetPerRun:  saLink.tokenBudgetPerRun,
    },
    limits: limits ? {
      monthlyCostLimitCents: limits.monthlyCostLimitCents,
      dailyCostLimitCents:   limits.dailyCostLimitCents,
      alertThresholdPct:     limits.alertThresholdPct,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// updateAgentBudget — update per-agent budget config for a subaccount
// ---------------------------------------------------------------------------

export interface AgentBudgetUpdate {
  maxCostPerRunCents?: number | null;
  maxLlmCallsPerRun?: number | null;
  tokenBudgetPerRun?: number;
}

export async function updateAgentBudget(
  subaccountId: string,
  agentId: string,
  orgId: string,
  updates: AgentBudgetUpdate,
): Promise<typeof subaccountAgents.$inferSelect | null> {
  const [saLink] = await db.select().from(subaccountAgents).where(
    and(
      eq(subaccountAgents.subaccountId, subaccountId),
      eq(subaccountAgents.agentId, agentId),
      eq(subaccountAgents.organisationId, orgId),
    ),
  );

  if (!saLink) return null;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.maxCostPerRunCents !== undefined) patch.maxCostPerRunCents = updates.maxCostPerRunCents;
  if (updates.maxLlmCallsPerRun !== undefined)  patch.maxLlmCallsPerRun  = updates.maxLlmCallsPerRun;
  if (updates.tokenBudgetPerRun !== undefined)  patch.tokenBudgetPerRun  = updates.tokenBudgetPerRun;

  const [updated] = await db.update(subaccountAgents)
    .set(patch)
    .where(eq(subaccountAgents.id, saLink.id))
    .returning();

  return updated ?? null;
}

// ---------------------------------------------------------------------------
// getOrgBudget — org compute budget
// ---------------------------------------------------------------------------

export async function getOrgBudget(orgId: string) {
  const [budget] = await db.select().from(orgComputeBudgets).where(eq(orgComputeBudgets.organisationId, orgId));
  return budget ?? null;
}

// ---------------------------------------------------------------------------
// upsertOrgBudget — create or update org compute budget
// ---------------------------------------------------------------------------

export async function upsertOrgBudget(
  orgId: string,
  monthlyCostLimitCents: number | undefined,
  alertThresholdPct: number | undefined,
) {
  const [upserted] = await db
    .insert(orgComputeBudgets)
    .values({
      organisationId: orgId,
      monthlyComputeLimitCents: monthlyCostLimitCents ?? null,
      alertThresholdPct: alertThresholdPct ?? 80,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: orgComputeBudgets.organisationId,
      set: {
        monthlyComputeLimitCents: monthlyCostLimitCents ?? null,
        alertThresholdPct: alertThresholdPct ?? 80,
        updatedAt: new Date(),
      },
    })
    .returning();

  return upserted;
}
