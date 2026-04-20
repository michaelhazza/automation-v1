import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type {
  PnlSummary,
  OrgRow,
  SubacctRow,
  SourceTypeRow,
  ProviderModelRow,
  DailyTrendRow,
  TopCallRow,
  CallDetail,
  OverheadRow,
} from '../../shared/types/systemPnl.js';
import {
  computeMarginPct,
  computeProfitCents,
  computeKpiChangePct,
  computeKpiChangePp,
  pctOfTotal,
  buildAggregatedOverheadRow,
  computeNetProfit,
} from './systemPnlServicePure.js';

// ---------------------------------------------------------------------------
// systemPnlService — cross-organisation P&L reads for the System P&L page
// (spec §11). Every method is admin-authorised (routes enforce
// requireSystemAdmin) and reads with unconstrained scope — the P&L page is
// the one UI that is intentionally cross-tenant.
//
// Data split per spec §11.2:
//   - Scalar KPI math + per-org / per-subaccount rollups → cost_aggregates
//   - Provider+model rollups + top calls + call detail → llm_requests live
//   - Daily trend → cost_aggregates (entity_type='platform', daily)
//
// Caching: none. cost_aggregates is pre-aggregated and sub-100ms. Live
// llm_requests reads for the 30-day window are bounded by indexed scans.
// ---------------------------------------------------------------------------

const OVERHEAD_SOURCE_TYPES = ['system', 'analyzer'] as const;

interface Period {
  month: string;                             // 'YYYY-MM'
}

function previousMonth(month: string): string {
  // 'YYYY-MM' arithmetic without pulling in date-fns.
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function scalarByEntityType(
  entityType: string,
  month: string,
): Promise<Array<{ entityId: string; costCents: number; requests: number }>> {
  const rows = await db.execute<{ entity_id: string; cost_cents: number; request_count: number }>(sql`
    SELECT entity_id, total_cost_cents AS cost_cents, request_count
    FROM cost_aggregates
    WHERE entity_type = ${entityType}
      AND period_type = 'monthly'
      AND period_key  = ${month}
  `);
  return rows.map((r) => ({
    entityId:  r.entity_id,
    costCents: Number(r.cost_cents),
    requests:  Number(r.request_count),
  }));
}

async function platformTotals(month: string): Promise<{
  revenueCents: number;
  costCents: number;
  overheadCents: number;
  requests: number;
}> {
  const rows = await db.execute<{
    revenue_cents: number; cost_cents: number; overhead_cents: number; requests: number;
  }>(sql`
    SELECT
      COALESCE(SUM(cost_with_margin_cents), 0)                                                 AS revenue_cents,
      COALESCE(SUM(ROUND(cost_raw * 100)::int), 0)                                             AS cost_cents,
      COALESCE(SUM(ROUND(cost_raw * 100)::int) FILTER (WHERE source_type IN ('system','analyzer')), 0) AS overhead_cents,
      COUNT(*)::int                                                                            AS requests
    FROM llm_requests
    WHERE billing_month = ${month}
      AND status IN ('success', 'partial')
  `);
  const r = rows[0] ?? { revenue_cents: 0, cost_cents: 0, overhead_cents: 0, requests: 0 };
  return {
    revenueCents:  Number(r.revenue_cents),
    costCents:     Number(r.cost_cents),
    overheadCents: Number(r.overhead_cents),
    requests:      Number(r.requests),
  };
}

// ── 1. getPnlSummary ──────────────────────────────────────────────────────

export async function getPnlSummary(period: Period): Promise<PnlSummary> {
  const prevMonth = previousMonth(period.month);
  const [current, previous] = await Promise.all([
    platformTotals(period.month),
    platformTotals(prevMonth),
  ]);

  const grossProfitCents = current.revenueCents - current.costCents + current.overheadCents;
  // Revenue minus billable-only cost → the gross margin line.
  const grossMargin = current.revenueCents > 0
    ? Math.round(((grossProfitCents) / current.revenueCents) * 10000) / 100
    : 0;

  const prevGrossProfitCents = previous.revenueCents - previous.costCents + previous.overheadCents;
  const prevGrossMargin = previous.revenueCents > 0
    ? Math.round(((prevGrossProfitCents) / previous.revenueCents) * 10000) / 100
    : 0;

  const netProfitCents = computeNetProfit(grossProfitCents, current.overheadCents);
  const prevNetProfitCents = computeNetProfit(prevGrossProfitCents, previous.overheadCents);
  const netMargin = current.revenueCents > 0
    ? Math.round((netProfitCents / current.revenueCents) * 10000) / 100
    : 0;
  const prevNetMargin = previous.revenueCents > 0
    ? Math.round((prevNetProfitCents / previous.revenueCents) * 10000) / 100
    : null;

  const hasPrevious = previous.revenueCents > 0 || previous.costCents > 0;

  return {
    period:         period.month,
    previousPeriod: hasPrevious ? prevMonth : null,
    revenue: {
      cents:  current.revenueCents,
      change: hasPrevious ? computeKpiChangePct(current.revenueCents, previous.revenueCents) : null,
    },
    grossProfit: {
      cents:  grossProfitCents,
      margin: grossMargin,
      change: hasPrevious ? computeKpiChangePct(grossProfitCents, prevGrossProfitCents) : null,
    },
    platformOverhead: {
      cents:        current.overheadCents,
      pctOfRevenue: pctOfTotal(current.overheadCents, current.revenueCents),
    },
    netProfit: {
      cents:  netProfitCents,
      margin: netMargin,
      change: hasPrevious ? computeKpiChangePp(netMargin, prevNetMargin) : null,
    },
  };
}

// ── 2. getByOrganisation ─────────────────────────────────────────────────

export async function getByOrganisation(
  period: Period,
  limit = 50,
): Promise<{ orgs: OrgRow[]; overhead: OverheadRow }> {
  // Per-org aggregates — the `organisation` dimension in cost_aggregates
  // already sums everything billable to that org. JOIN in org metadata.
  const rows = await db.execute<{
    org_id:           string;
    org_name:         string;
    slug:             string | null;
    margin_multiplier: string | null;
    subaccount_count: number;
    revenue_cents:    number;
    cost_cents:       number;
    requests:         number;
  }>(sql`
    SELECT
      o.id                                                AS org_id,
      o.name                                              AS org_name,
      o.slug                                              AS slug,
      omc.margin_multiplier                               AS margin_multiplier,
      (SELECT COUNT(*)::int FROM subaccounts s WHERE s.organisation_id = o.id AND s.deleted_at IS NULL) AS subaccount_count,
      COALESCE(ca.total_cost_cents, 0)                    AS revenue_cents,
      COALESCE((
        SELECT ROUND(SUM(cost_raw * 100))::int
        FROM llm_requests r
        WHERE r.organisation_id = o.id
          AND r.billing_month   = ${period.month}
          AND r.status IN ('success', 'partial')
          AND r.source_type NOT IN ('system', 'analyzer')
      ), 0)                                               AS cost_cents,
      COALESCE(ca.request_count, 0)                       AS requests
    FROM organisations o
    LEFT JOIN cost_aggregates ca
      ON ca.entity_type = 'organisation'
     AND ca.entity_id   = o.id::text
     AND ca.period_type = 'monthly'
     AND ca.period_key  = ${period.month}
    LEFT JOIN LATERAL (
      SELECT margin_multiplier
      FROM org_margin_configs
      WHERE organisation_id = o.id
      ORDER BY effective_from DESC
      LIMIT 1
    ) omc ON TRUE
    WHERE COALESCE(ca.total_cost_cents, 0) > 0
       OR EXISTS (
         SELECT 1 FROM llm_requests r
         WHERE r.organisation_id = o.id AND r.billing_month = ${period.month}
       )
    ORDER BY cost_cents DESC
    LIMIT ${limit}
  `);

  const platform = await platformTotals(period.month);

  const orgs: OrgRow[] = [];
  for (const r of rows) {
    const revenue = Number(r.revenue_cents);
    const cost    = Number(r.cost_cents);
    const profit  = revenue - cost;
    orgs.push({
      organisationId:   r.org_id,
      organisationName: r.org_name,
      slug:             r.slug,
      marginTier:       r.margin_multiplier ? Number(r.margin_multiplier) : 1.30,
      subaccountCount:  Number(r.subaccount_count),
      requests:         Number(r.requests),
      revenueCents:     revenue,
      costCents:        cost,
      profitCents:      profit,
      marginPct:        revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      pctOfRevenue:     pctOfTotal(revenue, platform.revenueCents),
      // Sparkline: 30 normalised daily cost values. Fetched lazily here —
      // if this turns out to dominate page-load time we promote into a
      // dedicated aggregate dimension per §17 deferred items.
      trendSparkline:   await fetchOrgSparkline(r.org_id, period.month),
    });
  }

  // Aggregated overhead row — sum of system + analyzer cost across all orgs.
  const overheadRows = await getBySourceType(period);
  const overhead = buildAggregatedOverheadRow({
    overheadRows: overheadRows.filter((r) => OVERHEAD_SOURCE_TYPES.includes(r.sourceType as 'system' | 'analyzer')),
    platformRevenueCents: platform.revenueCents,
  });

  return { orgs, overhead };
}

async function fetchOrgSparkline(orgId: string, month: string): Promise<number[]> {
  const rows = await db.execute<{ day: string; cost_cents: number }>(sql`
    SELECT period_key AS day, total_cost_cents AS cost_cents
    FROM cost_aggregates
    WHERE entity_type = 'organisation'
      AND entity_id   = ${orgId}
      AND period_type = 'daily'
      AND period_key LIKE ${month + '-%'}
    ORDER BY period_key ASC
  `);
  if (rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => Number(r.cost_cents)));
  return rows.map((r) => (max > 0 ? Number(r.cost_cents) / max : 0));
}

// ── 3. getBySubaccount ────────────────────────────────────────────────────

export async function getBySubaccount(period: Period, limit = 100): Promise<SubacctRow[]> {
  const rows = await db.execute<{
    subaccount_id:    string;
    subaccount_name:  string;
    org_id:           string;
    org_name:         string;
    margin_multiplier: string | null;
    revenue_cents:    number;
    cost_cents:       number;
    requests:         number;
  }>(sql`
    SELECT
      s.id                                                AS subaccount_id,
      s.name                                              AS subaccount_name,
      o.id                                                AS org_id,
      o.name                                              AS org_name,
      omc.margin_multiplier                               AS margin_multiplier,
      COALESCE(ca.total_cost_cents, 0)                    AS revenue_cents,
      COALESCE((
        SELECT ROUND(SUM(cost_raw * 100))::int
        FROM llm_requests r
        WHERE r.subaccount_id = s.id
          AND r.billing_month = ${period.month}
          AND r.status IN ('success', 'partial')
          AND r.source_type NOT IN ('system', 'analyzer')
      ), 0)                                               AS cost_cents,
      COALESCE(ca.request_count, 0)                       AS requests
    FROM subaccounts s
    JOIN organisations o ON o.id = s.organisation_id
    LEFT JOIN cost_aggregates ca
      ON ca.entity_type = 'subaccount'
     AND ca.entity_id   = s.id::text
     AND ca.period_type = 'monthly'
     AND ca.period_key  = ${period.month}
    LEFT JOIN LATERAL (
      SELECT margin_multiplier
      FROM org_margin_configs
      WHERE organisation_id = o.id
      ORDER BY effective_from DESC
      LIMIT 1
    ) omc ON TRUE
    WHERE COALESCE(ca.total_cost_cents, 0) > 0
      AND s.deleted_at IS NULL
    ORDER BY cost_cents DESC
    LIMIT ${limit}
  `);

  const platform = await platformTotals(period.month);

  return rows.map((r) => {
    const revenue = Number(r.revenue_cents);
    const cost    = Number(r.cost_cents);
    const profit  = revenue - cost;
    return {
      subaccountId:     r.subaccount_id,
      subaccountName:   r.subaccount_name,
      organisationId:   r.org_id,
      organisationName: r.org_name,
      marginTier:       r.margin_multiplier ? Number(r.margin_multiplier) : 1.30,
      requests:         Number(r.requests),
      revenueCents:     revenue,
      costCents:        cost,
      profitCents:      profit,
      marginPct:        revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      pctOfRevenue:     pctOfTotal(revenue, platform.revenueCents),
    };
  });
}

// ── 4. getBySourceType ───────────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, { label: string; description: string }> = {
  agent_run:         { label: 'Agent Run',          description: 'Conversational agent loops — billed per org margin tier' },
  process_execution: { label: 'Process Execution',  description: 'Scheduled processes + triggered executions' },
  iee:               { label: 'IEE Loop',           description: 'Integrated Execution Environment worker calls' },
  system:            { label: 'System Background',  description: 'Memory compile · orchestration · miscellaneous system work' },
  analyzer:          { label: 'Skill Analyzer',     description: 'Classify · agent-match · cluster-recommend' },
};

export async function getBySourceType(period: Period): Promise<SourceTypeRow[]> {
  const rows = await db.execute<{
    source_type:   string;
    orgs_count:    number;
    requests:      number;
    revenue_cents: number;
    cost_cents:    number;
  }>(sql`
    SELECT
      source_type,
      COUNT(DISTINCT organisation_id)::int                  AS orgs_count,
      COUNT(*)::int                                         AS requests,
      COALESCE(SUM(cost_with_margin_cents), 0)              AS revenue_cents,
      COALESCE(ROUND(SUM(cost_raw * 100)), 0)               AS cost_cents
    FROM llm_requests
    WHERE billing_month = ${period.month}
      AND status IN ('success', 'partial')
    GROUP BY source_type
    ORDER BY cost_cents DESC
  `);

  const platform = await platformTotals(period.month);

  return rows.map((r) => {
    const isOverhead = OVERHEAD_SOURCE_TYPES.includes(r.source_type as 'system' | 'analyzer');
    const labels = SOURCE_TYPE_LABELS[r.source_type] ?? { label: r.source_type, description: '' };
    const costCents = Number(r.cost_cents);
    const revenueCents = isOverhead ? null : Number(r.revenue_cents);
    return {
      sourceType:   r.source_type as SourceTypeRow['sourceType'],
      label:        labels.label,
      description:  labels.description,
      orgsCount:    isOverhead ? 0 : Number(r.orgs_count),
      requests:     Number(r.requests),
      revenueCents,
      costCents,
      profitCents:  computeProfitCents(revenueCents, costCents),
      marginPct:    computeMarginPct(revenueCents, costCents),
      pctOfCost:    pctOfTotal(costCents, platform.costCents + platform.overheadCents),
    };
  });
}

// ── 5. getByProviderModel ────────────────────────────────────────────────

export async function getByProviderModel(period: Period): Promise<ProviderModelRow[]> {
  const rows = await db.execute<{
    provider:        string;
    model:           string;
    requests:        number;
    revenue_cents:   number;
    cost_cents:      number;
    avg_latency_ms:  number | null;
  }>(sql`
    SELECT
      provider,
      model,
      COUNT(*)::int                                         AS requests,
      COALESCE(SUM(cost_with_margin_cents), 0)              AS revenue_cents,
      COALESCE(ROUND(SUM(cost_raw * 100)), 0)               AS cost_cents,
      ROUND(AVG(provider_latency_ms))::int                  AS avg_latency_ms
    FROM llm_requests
    WHERE billing_month = ${period.month}
      AND status IN ('success', 'partial')
    GROUP BY provider, model
    ORDER BY cost_cents DESC
  `);

  const platform = await platformTotals(period.month);

  return rows.map((r) => {
    const revenue = Number(r.revenue_cents);
    const cost    = Number(r.cost_cents);
    const profit  = revenue - cost;
    return {
      provider:     r.provider,
      model:        r.model,
      requests:     Number(r.requests),
      revenueCents: revenue,
      costCents:    cost,
      profitCents:  profit,
      marginPct:    revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      avgLatencyMs: Number(r.avg_latency_ms ?? 0),
      pctOfCost:    pctOfTotal(cost, platform.costCents + platform.overheadCents),
    };
  });
}

// ── 6. getDailyTrend ──────────────────────────────────────────────────────

export async function getDailyTrend(days = 30): Promise<DailyTrendRow[]> {
  const rows = await db.execute<{
    day:            string;
    revenue_cents:  number;
    cost_cents:     number;
    overhead_cents: number;
  }>(sql`
    SELECT
      billing_day                                                                                 AS day,
      COALESCE(SUM(cost_with_margin_cents), 0)                                                   AS revenue_cents,
      COALESCE(ROUND(SUM(cost_raw * 100)), 0)                                                    AS cost_cents,
      COALESCE(ROUND(SUM(cost_raw * 100)) FILTER (WHERE source_type IN ('system','analyzer')), 0) AS overhead_cents
    FROM llm_requests
    WHERE created_at >= NOW() - (${days} || ' days')::interval
      AND status IN ('success', 'partial')
    GROUP BY billing_day
    ORDER BY billing_day ASC
  `);

  return rows.map((r) => ({
    day:           r.day,
    revenueCents:  Number(r.revenue_cents),
    costCents:     Number(r.cost_cents),
    overheadCents: Number(r.overhead_cents),
  }));
}

// ── 7. getTopCalls ────────────────────────────────────────────────────────

export async function getTopCalls(period: Period, limit = 10): Promise<TopCallRow[]> {
  const rows = await db.execute<{
    id:             string;
    created_at:     Date;
    organisation_name: string | null;
    subaccount_name: string | null;
    margin_multiplier: string | null;
    source_type:    string;
    feature_tag:    string;
    provider:       string;
    model:          string;
    tokens_in:      number;
    tokens_out:     number;
    cost_with_margin_cents: number;
    cost_raw:       string;
    status:         string;
  }>(sql`
    SELECT
      r.id,
      r.created_at,
      o.name                             AS organisation_name,
      s.name                             AS subaccount_name,
      omc.margin_multiplier              AS margin_multiplier,
      r.source_type,
      r.feature_tag,
      r.provider,
      r.model,
      r.tokens_in,
      r.tokens_out,
      r.cost_with_margin_cents,
      r.cost_raw::text                   AS cost_raw,
      r.status
    FROM llm_requests r
    LEFT JOIN organisations o ON o.id = r.organisation_id AND r.source_type NOT IN ('system','analyzer')
    LEFT JOIN subaccounts s   ON s.id = r.subaccount_id
    LEFT JOIN LATERAL (
      SELECT margin_multiplier
      FROM org_margin_configs
      WHERE organisation_id = r.organisation_id
      ORDER BY effective_from DESC
      LIMIT 1
    ) omc ON TRUE
    WHERE r.billing_month = ${period.month}
    ORDER BY r.cost_raw DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const isOverhead = OVERHEAD_SOURCE_TYPES.includes(r.source_type as 'system' | 'analyzer');
    const costCents = Math.round(Number(r.cost_raw) * 100);
    const revenueCents = isOverhead ? null : Number(r.cost_with_margin_cents);
    const sourceLabel = SOURCE_TYPE_LABELS[r.source_type]?.label ?? r.source_type;
    return {
      id:               r.id,
      createdAt:        r.created_at.toISOString(),
      organisationName: isOverhead ? null : r.organisation_name,
      subaccountName:   isOverhead ? null : r.subaccount_name,
      marginTier:       isOverhead ? null : (r.margin_multiplier ? Number(r.margin_multiplier) : 1.30),
      sourceType:       r.source_type,
      sourceLabel:      r.feature_tag && r.feature_tag !== 'unknown' ? `${sourceLabel} · ${r.feature_tag}` : sourceLabel,
      provider:         r.provider,
      model:            r.model,
      tokensIn:         Number(r.tokens_in),
      tokensOut:        Number(r.tokens_out),
      revenueCents,
      costCents,
      profitCents:      computeProfitCents(revenueCents, costCents),
      status:           r.status,
    };
  });
}

// ── 8. getCallDetail ──────────────────────────────────────────────────────

export async function getCallDetail(id: string): Promise<CallDetail | null> {
  // UNION ALL against the archive so detail-drawer lookups keep working
  // for rows moved out of the live table by the nightly retention job
  // (spec §12.4 / §15.5). Live table is checked first; archive is a
  // second-chance lookup.
  const rows = await db.execute<Record<string, unknown>>(sql`
    WITH combined AS (
      SELECT r.*
      FROM llm_requests r
      WHERE r.id = ${id}
      UNION ALL
      SELECT
        r.id, r.idempotency_key, r.organisation_id, r.subaccount_id, r.user_id,
        r.source_type, r.run_id, r.execution_id, r.iee_run_id, r.source_id,
        r.feature_tag, r.call_site, r.agent_name, r.task_type,
        r.provider, r.model, r.provider_request_id,
        r.tokens_in, r.tokens_out, r.provider_tokens_in, r.provider_tokens_out,
        r.cost_raw, r.cost_with_margin, r.cost_with_margin_cents, r.margin_multiplier, r.fixed_fee_cents,
        r.request_payload_hash, r.response_payload_hash,
        r.provider_latency_ms, r.router_overhead_ms,
        r.status, r.error_message, r.attempt_number,
        r.parse_failure_raw_excerpt, r.abort_reason,
        r.cached_prompt_tokens,
        r.execution_phase, r.capability_tier, r.was_downgraded, r.routing_reason,
        r.was_escalated, r.escalation_reason,
        r.requested_provider, r.requested_model, r.fallback_chain,
        r.billing_month, r.billing_day, r.created_at
      FROM llm_requests_archive r
      WHERE r.id = ${id}
    )
    SELECT
      c.*,
      o.name AS organisation_name,
      s.name AS subaccount_name,
      omc.margin_multiplier AS margin_multiplier
    FROM combined c
    LEFT JOIN organisations o ON o.id = c.organisation_id
    LEFT JOIN subaccounts s   ON s.id = c.subaccount_id
    LEFT JOIN LATERAL (
      SELECT margin_multiplier
      FROM org_margin_configs
      WHERE organisation_id = c.organisation_id
      ORDER BY effective_from DESC
      LIMIT 1
    ) omc ON TRUE
    LIMIT 1
  `);

  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, any>;

  const isOverhead = OVERHEAD_SOURCE_TYPES.includes(r.source_type as 'system' | 'analyzer');
  const costCents = Math.round(Number(r.cost_raw) * 100);
  const revenueCents = isOverhead ? null : Number(r.cost_with_margin_cents);
  const sourceLabel = SOURCE_TYPE_LABELS[r.source_type as string]?.label ?? r.source_type;

  return {
    id:               r.id,
    createdAt:        new Date(r.created_at).toISOString(),
    organisationName: isOverhead ? null : r.organisation_name,
    subaccountName:   isOverhead ? null : r.subaccount_name,
    marginTier:       isOverhead ? null : (r.margin_multiplier ? Number(r.margin_multiplier) : 1.30),
    sourceType:       r.source_type,
    sourceLabel:      r.feature_tag && r.feature_tag !== 'unknown' ? `${sourceLabel} · ${r.feature_tag}` : sourceLabel,
    provider:         r.provider,
    model:            r.model,
    tokensIn:         Number(r.tokens_in),
    tokensOut:        Number(r.tokens_out),
    revenueCents,
    costCents,
    profitCents:      computeProfitCents(revenueCents, costCents),
    status:           r.status,
    idempotencyKey:   r.idempotency_key,
    providerRequestId: r.provider_request_id ?? null,
    organisationId:   isOverhead ? null : r.organisation_id,
    subaccountId:     isOverhead ? null : r.subaccount_id,
    runId:            r.run_id ?? null,
    sourceId:         r.source_id ?? null,
    attemptNumber:    Number(r.attempt_number),
    fallbackChain:    r.fallback_chain ? JSON.parse(r.fallback_chain) : null,
    errorMessage:     r.error_message ?? null,
    parseFailureRawExcerpt: r.parse_failure_raw_excerpt ?? null,
    abortReason:      r.abort_reason ?? null,
    cachedPromptTokens: Number(r.cached_prompt_tokens ?? 0),
    providerLatencyMs: r.provider_latency_ms === null ? null : Number(r.provider_latency_ms),
    routerOverheadMs:  r.router_overhead_ms === null ? null : Number(r.router_overhead_ms),
  };
}

export const systemPnlService = {
  getPnlSummary,
  getByOrganisation,
  getBySubaccount,
  getBySourceType,
  getByProviderModel,
  getDailyTrend,
  getTopCalls,
  getCallDetail,
};
