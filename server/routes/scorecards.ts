// server/routes/scorecards.ts
// Scorecard CRUD + share-toggle + duplicate.
// Trust & Verification Layer spec §12.1, §12.2.

import { Router, Request } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { scorecardService } from '../services/scorecardService.js';
import { compressSourcePill } from '../services/scorecardServicePure.js';
import {
  createScorecardBody,
  updateScorecardBody,
  shareToggleBody,
  duplicateScorecardBody,
} from '../schemas/scorecards.js';
import type { Scorecard } from '../db/schema/scorecards.js';

const router = Router();

// ── Determine viewer context from request ────────────────────────────────────

// Org-scoped routes (requireOrgPermission gate) treat all callers as org_admin
// visibility so the full org library is returned. Subaccount-scoped visibility
// is served via /api/subaccounts/:id/scorecards which uses viewerScope='subaccount'.
function viewerScope(req: Request): 'system_admin' | 'org_admin' {
  const role = req.user?.role;
  if (role === 'system_admin') return 'system_admin';
  return 'org_admin';
}

function withSourcePills(
  cards: Scorecard[],
  scope: 'system_admin' | 'org_admin' | 'subaccount',
) {
  if (scope === 'system_admin') return cards;
  const pillScope: 'org_admin' | 'subaccount' = scope === 'org_admin' ? 'org_admin' : 'subaccount';
  return cards.map(sc => ({
    ...sc,
    sourcePill: compressSourcePill(sc.scopeType as 'system' | 'org' | 'subaccount', pillScope),
  }));
}

// ── GET /api/scorecards ───────────────────────────────────────────────────────

router.get(
  '/api/scorecards',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const scope = viewerScope(req);
    const cards = await scorecardService.list({
      viewerScope: scope,
      orgId: req.orgId!,
      subaccountId: null,
    });
    res.json({ scorecards: withSourcePills(cards, scope), sourcePillCompressed: true });
  }),
);

// ── POST /api/scorecards ─────────────────────────────────────────────────────

router.post(
  '/api/scorecards',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(createScorecardBody, 'warn'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.create(req.body, 'org', req.orgId!, req.orgId!);
    res.status(201).json(card);
  }),
);

// ── GET /api/scorecards/:id ──────────────────────────────────────────────────

router.get(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.getById(req.params.id);
    if (!card || card.deletedAt) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(card);
  }),
);

// ── PATCH /api/scorecards/:id ────────────────────────────────────────────────

router.patch(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(updateScorecardBody, 'warn'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.update(req.params.id, req.body);
    res.json(card);
  }),
);

// ── DELETE /api/scorecards/:id ───────────────────────────────────────────────

router.delete(
  '/api/scorecards/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  asyncHandler(async (req, res) => {
    await scorecardService.delete(req.params.id);
    res.status(204).end();
  }),
);

// ── POST /api/scorecards/:id/duplicate ──────────────────────────────────────

router.post(
  '/api/scorecards/:id/duplicate',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(duplicateScorecardBody, 'warn'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.duplicate(req.params.id, req.body, req.orgId!);
    res.status(201).json(card);
  }),
);

// ── POST /api/scorecards/:id/share-toggle ────────────────────────────────────

router.post(
  '/api/scorecards/:id/share-toggle',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(shareToggleBody, 'warn'),
  asyncHandler(async (req, res) => {
    const card = await scorecardService.toggleShareWithSubaccounts(req.params.id, req.body.shareWithSubaccounts);
    res.json(card);
  }),
);

// ── Subaccount-scoped scorecard routes ───────────────────────────────────────
// GET /api/subaccounts/:subaccountId/scorecards
// POST /api/subaccounts/:subaccountId/scorecards

router.get(
  '/api/subaccounts/:subaccountId/scorecards',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SCORECARDS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const cards = await scorecardService.list({
      viewerScope: 'subaccount',
      orgId: req.orgId!,
      subaccountId,
    });
    res.json({ scorecards: withSourcePills(cards, 'subaccount'), sourcePillCompressed: true });
  }),
);

router.post(
  '/api/subaccounts/:subaccountId/scorecards',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SCORECARDS_MANAGE),
  validateBody(createScorecardBody, 'warn'),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);
    const card = await scorecardService.create(req.body, 'subaccount', subaccountId, req.orgId!);
    res.status(201).json(card);
  }),
);

export default router;
