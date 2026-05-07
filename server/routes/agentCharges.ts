// ---------------------------------------------------------------------------
// agentCharges route — read-only ledger queries
//
// GET /api/agent-charges?status=&intent_id=&from=&to=&limit=&cursor=
// GET /api/agent-charges/aggregates?dimension=agent_spend_subaccount|agent_spend_org|agent_spend_run
// GET /api/agent-charges/:id
//
// Settled-vs-in-flight rule (spec §7.6):
//   - Aggregate reads from cost_aggregates reflect SETTLED spend only.
//   - In-flight reserved is computed live from agent_charges non-terminal rows.
//
// Spec: tasks/builds/agentic-commerce/spec.md §7.6, §11.3
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  listCharges,
  getChargeById,
  getChargeAggregates,
} from '../services/chargeRouterService.js';
import { listLedger } from '../services/spendLedgerService.js';
import { getCapsResponse } from '../services/computeBudgetService.js';
import { getSpendInsights } from '../services/spendInsightsService.js';
import { getSpendTrends } from '../services/spendTrendsService.js';
import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/agent-charges/aggregates — settled spend + in-flight reserved
// NOTE: this route must be registered BEFORE /:id to avoid route shadowing.
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-charges/aggregates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const { dimension, entityId, periodKey } = req.query as {
      dimension?: string;
      entityId?: string;
      periodKey?: string;
    };

    const validDimensions = ['agent_spend_subaccount', 'agent_spend_org', 'agent_spend_run'] as const;
    if (!dimension || !validDimensions.includes(dimension as (typeof validDimensions)[number])) {
      throw {
        statusCode: 400,
        message: `dimension must be one of: ${validDimensions.join(', ')}`,
        errorCode: 'validation_error',
      };
    }

    const result = await getChargeAggregates({
      organisationId: req.orgId!,
      dimension,
      entityId,
      periodKey,
    });

    res.json({
      settledSpend: result.settledSpend,
      inFlightReservedMinor: result.inFlightReservedMinor,
      note: 'settledSpend reflects committed/settled charges only. inFlightReservedMinor is the live sum of pending_approval, approved, and executed charges.',
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/agent-charges — list with filters
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-charges',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const { status, intent_id, from, to, limit: limitStr, cursor } = req.query as {
      status?: string;
      intent_id?: string;
      from?: string;
      to?: string;
      limit?: string;
      cursor?: string;
    };

    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200);

    const result = await listCharges({
      organisationId: req.orgId!,
      status: status as AgentChargeStatus | undefined,
      intentId: intent_id,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      cursor,
      limit,
    });

    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/agent-charges/:id — single charge
// ---------------------------------------------------------------------------

router.get(
  '/api/agent-charges/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const charge = await getChargeById(req.params.id, req.orgId!);

    if (!charge) {
      throw { statusCode: 404, message: 'Agent charge not found.', errorCode: 'not_found' };
    }

    res.json(charge);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/spend/ledger — paged ledger list with single-CTE filterOptions
// Spec: §4.0, §4.2, §6
// ---------------------------------------------------------------------------

const ledgerQuery = z.object({
  scope: z.enum(['workspace', 'org']).optional().default('workspace'),
  subaccountId: z.string().uuid().optional(),
  workspace: z.union([z.string(), z.array(z.string())]).optional(),
  agent: z.union([z.string(), z.array(z.string())]).optional(),
  type: z.union([
    z.enum(['llm', 'embedding', 'tool_call', 'storage', 'other']),
    z.array(z.enum(['llm', 'embedding', 'tool_call', 'storage', 'other'])),
  ]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  sortKey: z.enum(['timestamp', 'workspace', 'agent', 'type', 'tokens', 'cost']).optional().default('timestamp'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
}).refine(
  (q) => q.scope !== 'workspace' || !!q.subaccountId,
  { message: 'subaccountId is required when scope=workspace', path: ['subaccountId'] },
);

router.get(
  '/api/spend/ledger',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const q = ledgerQuery.parse(req.query);
    const result = await listLedger({
      organisationId: req.orgId!,
      scope: q.scope,
      subaccountId: q.subaccountId,
      workspace: arrayify(q.workspace),
      agent: arrayify(q.agent),
      type: arrayify(q.type),
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      q: q.q,
      cursor: q.cursor ?? null,
      limit: q.limit,
      sortKey: q.sortKey,
      sortDir: q.sortDir,
    });
    res.json(result);
  }),
);

function arrayify<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// GET /api/spend/caps — caps + pace (spec §4.3, §4.11)
// ---------------------------------------------------------------------------

const capsQuery = z.object({
  scope: z.enum(['workspace', 'org']).optional().default('org'),
  subaccountId: z.string().uuid().optional(),
}).refine(
  (q) => q.scope !== 'workspace' || !!q.subaccountId,
  { message: 'subaccountId is required when scope=workspace', path: ['subaccountId'] },
);

router.get(
  '/api/spend/caps',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const q = capsQuery.parse(req.query);
    const result = await getCapsResponse({
      organisationId: req.orgId!,
      scope: q.scope,
      subaccountId: q.scope === 'workspace' ? q.subaccountId : undefined,
    });
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/spend/insights — org-scope spend insights tiles (spec §4.4)
// ---------------------------------------------------------------------------

router.get(
  '/api/spend/insights',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const result = await getSpendInsights({ organisationId: req.orgId! });
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/spend/trends — 6-month spend trends + cap classification (spec §4.5)
// ---------------------------------------------------------------------------

router.get(
  '/api/spend/trends',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
  asyncHandler(async (req, res) => {
    const result = await getSpendTrends({ organisationId: req.orgId! });
    res.json(result);
  }),
);

export default router;
