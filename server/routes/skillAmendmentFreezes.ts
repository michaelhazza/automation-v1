import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { skillAmendmentService } from '../services/skillAmendmentService.js';
import type { FreezeScope, FreezeType } from '../../shared/types/skillAmendments.js';

const router = Router();

// GET /api/subaccounts/:subaccountId/skill-amendment-freezes
router.get(
  '/api/subaccounts/:subaccountId/skill-amendment-freezes',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const items = await skillAmendmentService.freezes.list(req.orgId!, req.params.subaccountId);
    res.json(items);
  }),
);

// POST /api/subaccounts/:subaccountId/skill-amendment-freezes
router.post(
  '/api/subaccounts/:subaccountId/skill-amendment-freezes',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { scope, scopeId, freezeType, reason } = req.body as {
      scope?: FreezeScope;
      scopeId?: string;
      freezeType?: FreezeType;
      reason?: string;
    };
    if (!scope || !freezeType || !reason) {
      res.status(400).json({ error: 'scope, freezeType, and reason are required' });
      return;
    }
    const result = await skillAmendmentService.freezes.create({
      scope,
      scopeId,
      freezeType,
      reason,
      orgId: req.orgId!,
      subaccountId: req.params.subaccountId,
      userId: req.user!.id,
      role: req.user!.role,
    });
    res.status(201).json(result);
  }),
);

// DELETE /api/subaccounts/:subaccountId/skill-amendment-freezes/:id
router.delete(
  '/api/subaccounts/:subaccountId/skill-amendment-freezes/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SKILL_AMENDMENTS_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await skillAmendmentService.freezes.thaw(req.params.id, req.user!.id, req.orgId!);
    res.status(204).end();
  }),
);

export default router;
