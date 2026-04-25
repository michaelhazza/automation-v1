/**
 * Process connection mapping routes — subaccount-scoped.
 * Wires a process's required connection slots to actual integration connections.
 */

import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { automationConnectionMappingService } from '../services/automationConnectionMappingService.js';

const router = Router();

// Get connection mappings for a process in a subaccount
router.get(
  '/api/subaccounts/:subaccountId/automations/:automationId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const mappings = await automationConnectionMappingService.getConnectionMappings(
      subaccount.id,
      req.params.automationId,
    );
    res.json(mappings);
  })
);

// Set/update all connection mappings for a process in a subaccount
// Body: { mappings: [{ connectionKey: string, connectionId: string }] }
router.put(
  '/api/subaccounts/:subaccountId/automations/:automationId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    // guard-ignore-next-line: input-validation reason="manual validation enforced: Array.isArray check, per-item connection ownership and status validation"
    const { mappings } = req.body as { mappings: Array<{ connectionKey: string; connectionId: string }> };

    if (!Array.isArray(mappings)) {
      throw { statusCode: 400, message: 'mappings must be an array of { connectionKey, connectionId }' };
    }

    const result = await automationConnectionMappingService.setConnectionMappings(
      req.orgId!,
      subaccount.id,
      req.params.automationId,
      mappings,
    );
    res.json(result);
  })
);

// Clone a process into this subaccount (from system or org scope)
router.post(
  '/api/subaccounts/:subaccountId/automations/:processId/clone',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CLONE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const cloned = await automationConnectionMappingService.cloneAutomationToSubaccount(
      req.orgId!,
      subaccount.id,
      req.params.processId,
      req.body?.name,
    );
    res.status(201).json(cloned);
  })
);

export default router;
