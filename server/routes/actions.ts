import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { actionService } from '../services/actionService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

// ─── List actions for a subaccount ────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/actions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { status } = req.query;
    const items = await actionService.listActions(
      req.orgId!,
      subaccount.id,
      typeof status === 'string' ? status : undefined
    );
    res.json(items);
  })
);

// ─── Get action events (audit trail) ──────────────────────────────────────────

router.get(
  '/api/actions/:id/events',
  authenticate,
  asyncHandler(async (req, res) => {
    const events = await actionService.getActionEvents(req.params.id, req.orgId!);
    res.json(events);
  })
);

// ─── Get single action ───────────────────────────────────────────────────────

router.get(
  '/api/actions/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const action = await actionService.getAction(req.params.id, req.orgId!);
    res.json(action);
  })
);

export default router;
