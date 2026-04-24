import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { drilldownService } from '../services/drilldownService.js';

const router = Router();

// ── GET /api/clientpulse/subaccounts/:subaccountId/drilldown-summary ────────
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/drilldown-summary',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const summary = await drilldownService.getSummary({
      organisationId: orgId,
      subaccountId: sub.id,
      subaccountName: sub.name,
    });
    res.json({ subaccount: { id: sub.id, name: sub.name }, ...summary });
  }),
);

// ── GET /api/clientpulse/subaccounts/:subaccountId/signals ──────────────────
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/signals',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const out = await drilldownService.getSignals({
      organisationId: orgId,
      subaccountId: sub.id,
    });
    res.json(out);
  }),
);

// ── GET /api/clientpulse/subaccounts/:subaccountId/band-transitions ─────────
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/band-transitions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const windowDays = Number.parseInt(String(req.query.windowDays ?? '90'), 10);
    const transitions = await drilldownService.getBandTransitions({
      organisationId: orgId,
      subaccountId: sub.id,
      windowDays: Number.isFinite(windowDays) ? windowDays : 90,
    });
    res.json({ transitions });
  }),
);

// ── GET /api/clientpulse/subaccounts/:subaccountId/interventions ────────────
router.get(
  '/api/clientpulse/subaccounts/:subaccountId/interventions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };
    const sub = await resolveSubaccount(req.params.subaccountId, orgId);
    const limit = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const interventions = await drilldownService.getInterventionHistory({
      organisationId: orgId,
      subaccountId: sub.id,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    res.json({ interventions });
  }),
);

export default router;
