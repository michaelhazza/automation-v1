/**
 * Subaccount-scoped engine routes.
 * Allows subaccounts to bring their own execution engines (e.g. own n8n instance).
 */

import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { engineService } from '../services/engineService.js';

const router = Router();

// List subaccount engines
router.get(
  '/api/subaccounts/:subaccountId/engines',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const engines = await engineService.listSubaccountEngines(subaccount.id);
    res.json(engines);
  })
);

// Create subaccount engine
router.post(
  '/api/subaccounts/:subaccountId/engines',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, engineType, baseUrl, apiKey } = req.body;

    if (!name || !engineType || !baseUrl) {
      throw { statusCode: 400, message: 'name, engineType, and baseUrl are required' };
    }

    const engine = await engineService.createSubaccountEngine(req.orgId!, subaccount.id, {
      name,
      engineType,
      baseUrl,
      apiKey: apiKey ?? null,
    });

    res.status(201).json(engine);
  })
);

// Update subaccount engine
router.patch(
  '/api/subaccounts/:subaccountId/engines/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const engine = await engineService.updateSubaccountEngine(req.params.id, subaccount.id, req.body);
    res.json(engine);
  })
);

// Delete subaccount engine (soft)
router.delete(
  '/api/subaccounts/:subaccountId/engines/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await engineService.deleteSubaccountEngine(req.params.id, subaccount.id);
    res.json({ success: true });
  })
);

export default router;
