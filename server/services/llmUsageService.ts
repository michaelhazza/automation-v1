import { db } from '../db/index.js';
import { llmRequests } from '../db/schema/index.js';
import type { LlmRequest } from '../db/schema/index.js';
import { and, eq, desc, lt, sql, or } from 'drizzle-orm';

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
  for (const r of phaseRows) byPhase[r.phase] = r.count;

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
