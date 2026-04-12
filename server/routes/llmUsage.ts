import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { db } from '../db/index.js';
import {
  costAggregates,
  llmRequests,
  llmPricing,
  orgMarginConfigs,
  orgBudgets,
  workspaceLimits,
} from '../db/schema/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getRoutingLog, getRoutingDistribution, getRequestDetail } from '../services/llmUsageService.js';
import type { RoutingLogFilters } from '../services/llmUsageService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Org usage summary
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/usage/summary',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const [monthly, daily, topSubaccounts] = await Promise.all([
      // Monthly aggregate
      db.select().from(costAggregates).where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, orgId),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
        ),
      ).limit(1),

      // Daily aggregate (today)
      db.select().from(costAggregates).where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, orgId),
          eq(costAggregates.periodType, 'daily'),
          eq(costAggregates.periodKey, new Date().toISOString().slice(0, 10)),
        ),
      ).limit(1),

      // Top 10 subaccounts by monthly spend
      db.select().from(costAggregates).where(
        and(
          eq(costAggregates.entityType, 'subaccount'),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
        ),
      ).orderBy(desc(costAggregates.totalCostCents)).limit(10),
    ]);

    res.json({
      period: billingMonth,
      monthly: monthly[0] ?? null,
      today:   daily[0] ?? null,
      topSubaccounts,
    });
  }),
);

// ---------------------------------------------------------------------------
// Org usage by agent
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/usage/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const rows = await db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'agent'),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
        sql`${costAggregates.entityId} LIKE ${orgId + ':%'}`,
      ),
    ).orderBy(desc(costAggregates.totalCostCents));

    res.json({ period: billingMonth, agents: rows });
  }),
);

// ---------------------------------------------------------------------------
// Org usage by model
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/usage/models',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    // Query llm_requests directly for per-model breakdown scoped to this org
    const rows = await db
      .select({
        provider:        llmRequests.provider,
        model:           llmRequests.model,
        requestCount:    sql<number>`count(*)`,
        totalCostCents:  sql<number>`sum(${llmRequests.costWithMarginCents})`,
        totalTokensIn:   sql<number>`sum(${llmRequests.tokensIn})`,
        totalTokensOut:  sql<number>`sum(${llmRequests.tokensOut})`,
        avgLatencyMs:    sql<number>`avg(${llmRequests.providerLatencyMs})`,
        errorCount:      sql<number>`count(*) filter (where ${llmRequests.status} != 'success')`,
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

    res.json({ period: billingMonth, models: rows });
  }),
);

// ---------------------------------------------------------------------------
// Org usage by provider
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/usage/providers',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const rows = await db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'provider'),
        eq(costAggregates.periodType, 'monthly'),
        eq(costAggregates.periodKey, billingMonth),
      ),
    ).orderBy(desc(costAggregates.totalCostCents));

    res.json({ period: billingMonth, providers: rows });
  }),
);

// ---------------------------------------------------------------------------
// Subaccount usage summary
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/usage/summary',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

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
          eq(costAggregates.periodKey, new Date().toISOString().slice(0, 10)),
        ),
      ).limit(1),
      db.select().from(workspaceLimits).where(eq(workspaceLimits.subaccountId, subaccountId)).limit(1),
    ]);

    res.json({
      period: billingMonth,
      monthly: monthly[0] ?? null,
      today:   daily[0] ?? null,
      limits:  limits[0] ?? null,
    });
  }),
);

// ---------------------------------------------------------------------------
// Subaccount usage by agent
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/usage/agents',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const rows = await db
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

    res.json({ period: billingMonth, agents: rows });
  }),
);

// ---------------------------------------------------------------------------
// Subaccount usage by model/provider
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/usage/models',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    const rows = await db
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

    res.json({ period: billingMonth, models: rows });
  }),
);

// ---------------------------------------------------------------------------
// Subaccount usage by run
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/usage/runs',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;

    const rows = await db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'run'),
        eq(costAggregates.periodType, 'run'),
      ),
    ).orderBy(desc(costAggregates.updatedAt)).limit(50);

    res.json({ runs: rows });
  }),
);

// ---------------------------------------------------------------------------
// Live cost for an active run
// ---------------------------------------------------------------------------

router.get(
  '/api/runs/:runId/cost',
  authenticate,
  asyncHandler(async (req, res) => {
    const { runId } = req.params;

    const [runAgg] = await db.select().from(costAggregates).where(
      and(
        eq(costAggregates.entityType, 'run'),
        eq(costAggregates.entityId, runId),
        eq(costAggregates.periodType, 'run'),
        eq(costAggregates.periodKey, runId),
      ),
    );

    res.json(runAgg ?? { entityId: runId, totalCostCents: 0, requestCount: 0 });
  }),
);

// ---------------------------------------------------------------------------
// Routing debug: subaccount-scoped routing log
// ---------------------------------------------------------------------------

function parseRoutingLogQuery(query: Record<string, unknown>, orgId: string, subaccountId?: string): RoutingLogFilters {
  return {
    organisationId: orgId,
    subaccountId,
    billingMonth:   (query.month as string) || undefined,
    provider:       (query.provider as string) || undefined,
    model:          (query.model as string) || undefined,
    routingReason:  (query.routingReason as string) || undefined,
    capabilityTier: (query.capabilityTier as string) || undefined,
    executionPhase: (query.executionPhase as string) || undefined,
    status:         (query.status as string) || undefined,
    agentName:      (query.agentName as string) || undefined,
    runId:          (query.runId as string) || undefined,
    wasDowngraded:  query.wasDowngraded === 'true' ? true : query.wasDowngraded === 'false' ? false : undefined,
    wasEscalated:   query.wasEscalated === 'true' ? true : query.wasEscalated === 'false' ? false : undefined,
  };
}

router.get(
  '/api/subaccounts/:subaccountId/usage/routing-log',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const filters = parseRoutingLogQuery(req.query as Record<string, unknown>, req.orgId!, subaccountId);
    const result = await getRoutingLog(filters, {
      cursor:   (req.query.cursor as string) || undefined,
      cursorId: (req.query.cursorId as string) || undefined,
      limit:    req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    res.json(result);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/usage/routing-distribution',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const result = await getRoutingDistribution({
      organisationId: req.orgId!,
      subaccountId,
      billingMonth: (req.query.month as string) || undefined,
    });
    res.json(result);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/usage/requests/:requestId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, requestId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const detail = await getRequestDetail(requestId, req.orgId!);
    if (!detail || detail.subaccountId !== subaccountId) {
      throw { statusCode: 404, message: 'Request not found' };
    }
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Routing debug: org-scoped routing log
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/usage/routing-log',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const filters = parseRoutingLogQuery(req.query as Record<string, unknown>, req.orgId!);
    const result = await getRoutingLog(filters, {
      cursor:   (req.query.cursor as string) || undefined,
      cursorId: (req.query.cursorId as string) || undefined,
      limit:    req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    res.json(result);
  }),
);

router.get(
  '/api/orgs/:orgId/usage/routing-distribution',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const result = await getRoutingDistribution({
      organisationId: req.orgId!,
      billingMonth: (req.query.month as string) || undefined,
    });
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Admin: platform-wide overview
// ---------------------------------------------------------------------------

router.get(
  '/api/admin/usage/overview',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

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

    res.json({ period: billingMonth, organisations: orgs, providers });
  }),
);

// ---------------------------------------------------------------------------
// Admin: pricing management
// ---------------------------------------------------------------------------

router.get(
  '/api/admin/llm-pricing',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(llmPricing).orderBy(llmPricing.provider, llmPricing.model);
    res.json(rows);
  }),
);

router.get(
  '/api/admin/margin-configs',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(orgMarginConfigs).orderBy(orgMarginConfigs.createdAt);
    res.json(rows);
  }),
);

// ---------------------------------------------------------------------------
// Billing: invoice data for a subaccount + period
// ---------------------------------------------------------------------------

router.get(
  '/api/billing/:subaccountId/invoice/:period',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, period } = req.params;

    // Reconciliation check
    const ledgerTotal = await db
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

    const ledger    = Number(ledgerTotal[0]?.total ?? 0);
    const aggregate = aggregateRow?.totalCostCents ?? 0;
    const mismatch  = Math.abs(ledger - aggregate) > 0;

    // Agent breakdown
    const agentBreakdown = await db
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
      .orderBy(desc(sql`sum(${llmRequests.costWithMarginCents})`));

    // Model breakdown
    const modelBreakdown = await db
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
      .groupBy(llmRequests.provider, llmRequests.model);

    // Task type breakdown
    const taskTypeBreakdown = await db
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
      .groupBy(llmRequests.taskType);

    res.json({
      subaccountId,
      period,
      totalCostCents: ledger,
      mismatch,
      breakdown: {
        byAgent:    agentBreakdown,
        byModel:    modelBreakdown,
        byTaskType: taskTypeBreakdown,
      },
      requestCount:  aggregateRow?.requestCount ?? 0,
      errorCount:    aggregateRow?.errorCount ?? 0,
      reconciledAt:  new Date().toISOString(),
    });
  }),
);

// ---------------------------------------------------------------------------
// Per-agent budget and spend (subaccount agent level)
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/agents/:agentId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res, _next: NextFunction) => {
    const { subaccountId, agentId } = req.params;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    // Get the subaccount agent link for budget config
    const { subaccountAgents } = await import('../db/schema/index.js');
    const [saLink] = await db.select().from(subaccountAgents).where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.agentId, agentId),
        eq(subaccountAgents.organisationId, req.orgId!),
      ),
    );

    if (!saLink) {
      return res.status(404).json({ error: 'Agent not linked to this subaccount' });
    }

    // Get monthly spend from llm_requests for this agent in this subaccount
    const [spend] = await db
      .select({
        totalCostCents: sql<number>`COALESCE(sum(${llmRequests.costWithMarginCents}), 0)::int`,
        requestCount: sql<number>`count(*)::int`,
        totalTokensIn: sql<number>`COALESCE(sum(${llmRequests.tokensIn}), 0)::int`,
        totalTokensOut: sql<number>`COALESCE(sum(${llmRequests.tokensOut}), 0)::int`,
        errorCount: sql<number>`count(*) filter (where ${llmRequests.status} != 'success')::int`,
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
      );

    // Get workspace-level limits
    const [limits] = await db.select().from(workspaceLimits)
      .where(eq(workspaceLimits.subaccountId, subaccountId)).limit(1);

    res.json({
      period: billingMonth,
      agentId,
      subaccountId,
      spend: spend ?? { totalCostCents: 0, requestCount: 0, totalTokensIn: 0, totalTokensOut: 0, errorCount: 0 },
      config: {
        maxCostPerRunCents: saLink.maxCostPerRunCents,
        maxLlmCallsPerRun: saLink.maxLlmCallsPerRun,
        tokenBudgetPerRun: saLink.tokenBudgetPerRun,
      },
      limits: limits ? {
        monthlyCostLimitCents: limits.monthlyCostLimitCents,
        dailyCostLimitCents: limits.dailyCostLimitCents,
        alertThresholdPct: limits.alertThresholdPct,
      } : null,
    });
  }),
);

router.put(
  '/api/subaccounts/:subaccountId/agents/:agentId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res, _next: NextFunction) => {
    const { subaccountId, agentId } = req.params;
    const { maxCostPerRunCents, maxLlmCallsPerRun, tokenBudgetPerRun } = req.body as {
      maxCostPerRunCents?: number | null;
      maxLlmCallsPerRun?: number | null;
      tokenBudgetPerRun?: number;
    };

    const { subaccountAgents } = await import('../db/schema/index.js');
    const [saLink] = await db.select().from(subaccountAgents).where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.agentId, agentId),
        eq(subaccountAgents.organisationId, req.orgId!),
      ),
    );

    if (!saLink) {
      return res.status(404).json({ error: 'Agent not linked to this subaccount' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (maxCostPerRunCents !== undefined) updates.maxCostPerRunCents = maxCostPerRunCents;
    if (maxLlmCallsPerRun !== undefined) updates.maxLlmCallsPerRun = maxLlmCallsPerRun;
    if (tokenBudgetPerRun !== undefined) updates.tokenBudgetPerRun = tokenBudgetPerRun;

    const [updated] = await db.update(subaccountAgents)
      .set(updates)
      .where(eq(subaccountAgents.id, saLink.id))
      .returning();

    res.json(updated);
  }),
);

// ---------------------------------------------------------------------------
// Org budget management
// ---------------------------------------------------------------------------

router.get(
  '/api/orgs/:orgId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const [budget] = await db.select().from(orgBudgets).where(eq(orgBudgets.organisationId, orgId));
    res.json(budget ?? null);
  }),
);

router.put(
  '/api/orgs/:orgId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const { monthlyCostLimitCents, alertThresholdPct } = req.body as {
      monthlyCostLimitCents?: number;
      alertThresholdPct?: number;
    };

    const [upserted] = await db
      .insert(orgBudgets)
      .values({
        organisationId: orgId,
        monthlyCostLimitCents: monthlyCostLimitCents ?? null,
        alertThresholdPct: alertThresholdPct ?? 80,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: orgBudgets.organisationId,
        set: {
          monthlyCostLimitCents: monthlyCostLimitCents ?? null,
          alertThresholdPct: alertThresholdPct ?? 80,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(upserted);
  }),
);

export default router;
