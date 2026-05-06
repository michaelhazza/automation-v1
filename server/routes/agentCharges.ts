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
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  listCharges,
  getChargeById,
  getChargeAggregates,
} from '../services/chargeRouterService.js';
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

export default router;
