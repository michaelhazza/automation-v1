import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import * as pulseService from '../services/pulseService.js';

const router = Router();

// ── Attention ──────────────────────────────────────────────────────

router.get(
  '/api/pulse/attention',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const data = await pulseService.getAttention({
      type: 'org',
      orgId: req.orgId!,
      userId: req.user!.id,
    });
    res.json({ data, serverTimestamp: new Date().toISOString() });
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/pulse/attention',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const sub = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const data = await pulseService.getAttention({
      type: 'subaccount',
      orgId: req.orgId!,
      subaccountId: sub.id,
      userId: req.user!.id,
    });
    res.json(data);
  }),
);

// ── Counts (nav badge) ──────────────────────────────────────────────

router.get(
  '/api/pulse/counts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const data = await pulseService.getCounts({
      type: 'org',
      orgId: req.orgId!,
      userId: req.user!.id,
    });
    res.json(data);
  }),
);

router.get(
  '/api/subaccounts/:subaccountId/pulse/counts',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const sub = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const data = await pulseService.getCounts({
      type: 'subaccount',
      orgId: req.orgId!,
      subaccountId: sub.id,
      userId: req.user!.id,
    });
    res.json(data);
  }),
);

// ── Item lookup (WebSocket follow-up) ───────────────────────────────

router.get(
  '/api/pulse/item/:kind/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.REVIEW_VIEW),
  asyncHandler(async (req, res) => {
    const kind = req.params.kind as pulseService.PulseItem['kind'];
    const item = await pulseService.getItem(
      { type: 'org', orgId: req.orgId!, userId: req.user!.id },
      kind,
      req.params.id,
    );
    if (!item) {
      throw { statusCode: 404, message: 'Item not found', errorCode: 'PULSE_ITEM_NOT_FOUND' };
    }
    res.json(item);
  }),
);

export default router;
