import { Router, NextFunction } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import {
  getRoutingLog,
  getRoutingDistribution,
  getRequestDetail,
  getOrgUsageSummary,
  getOrgUsageByAgent,
  getOrgUsageByModel,
  getOrgUsageByProvider,
  getSubaccountUsageSummary,
  getSubaccountUsageByAgent,
  getSubaccountUsageByModel,
  getSubaccountUsageByRun,
  getRunOrg,
  getRunCost,
  getAdminUsageOverview,
  getLlmPricing,
  getMarginConfigs,
  getBillingInvoice,
  getAgentBudget,
  updateAgentBudget,
  getOrgBudget,
  upsertOrgBudget,
} from '../services/llmUsageService.js';
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
    const orgId = req.orgId!;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const result = await getOrgUsageSummary(orgId, billingMonth);
    res.json(result);
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
    const orgId = req.orgId!;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const agents = await getOrgUsageByAgent(orgId, billingMonth);
    res.json({ period: billingMonth, agents });
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
    const orgId = req.orgId!;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const models = await getOrgUsageByModel(orgId, billingMonth);
    res.json({ period: billingMonth, models });
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
    const orgId = req.orgId!;
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const providers = await getOrgUsageByProvider(orgId, billingMonth);
    res.json({ period: billingMonth, providers });
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const result = await getSubaccountUsageSummary(subaccountId, billingMonth);
    res.json(result);
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const agents = await getSubaccountUsageByAgent(subaccountId, billingMonth);
    res.json({ period: billingMonth, agents });
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const models = await getSubaccountUsageByModel(subaccountId, billingMonth);
    res.json({ period: billingMonth, models });
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const runs = await getSubaccountUsageByRun(subaccountId, req.orgId!);
    res.json({ runs });
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
    const run = await getRunOrg(runId);
    if (!run || run.organisationId !== req.orgId!) {
      throw { statusCode: 404, message: 'Run not found' };
    }
    const result = await getRunCost(runId);
    res.json(result);
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
    const result = await getAdminUsageOverview(billingMonth);
    res.json(result);
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
    const rows = await getLlmPricing();
    res.json(rows);
  }),
);

router.get(
  '/api/admin/margin-configs',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await getMarginConfigs();
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const result = await getBillingInvoice(subaccountId, period);
    res.json(result);
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
    await resolveSubaccount(subaccountId, req.orgId!);
    const billingMonth = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const result = await getAgentBudget(subaccountId, agentId, req.orgId!, billingMonth);
    if (!result) {
      return res.status(404).json({ error: 'Agent not linked to this subaccount' });
    }
    res.json(result);
  }),
);

router.put(
  '/api/subaccounts/:subaccountId/agents/:agentId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res, _next: NextFunction) => {
    const { subaccountId, agentId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const { maxCostPerRunCents, maxLlmCallsPerRun, tokenBudgetPerRun } = req.body as {
      maxCostPerRunCents?: number | null;
      maxLlmCallsPerRun?: number | null;
      tokenBudgetPerRun?: number;
    };
    const updated = await updateAgentBudget(subaccountId, agentId, req.orgId!, {
      maxCostPerRunCents,
      maxLlmCallsPerRun,
      tokenBudgetPerRun,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Agent not linked to this subaccount' });
    }
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
    const orgId = req.orgId!;
    const budget = await getOrgBudget(orgId);
    res.json(budget ?? null);
  }),
);

router.put(
  '/api/orgs/:orgId/budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { monthlyCostLimitCents, alertThresholdPct } = req.body as {
      monthlyCostLimitCents?: number;
      alertThresholdPct?: number;
    };
    const upserted = await upsertOrgBudget(orgId, monthlyCostLimitCents, alertThresholdPct);
    res.json(upserted);
  }),
);

export default router;
