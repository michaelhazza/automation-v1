/**
 * Process connection mapping routes — subaccount-scoped.
 * Wires a process's required connection slots to actual integration connections.
 */

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processConnectionMappings, integrationConnections } from '../db/schema/index.js';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// Get connection mappings for a process in a subaccount
router.get(
  '/api/subaccounts/:subaccountId/processes/:processId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PROCESSES_CONFIGURE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const mappings = await db.select()
      .from(processConnectionMappings)
      .where(and(
        eq(processConnectionMappings.subaccountId, subaccount.id),
        eq(processConnectionMappings.processId, req.params.processId)
      ));

    res.json(mappings);
  })
);

// Set/update all connection mappings for a process in a subaccount
// Body: { mappings: [{ connectionKey: string, connectionId: string }] }
router.put(
  '/api/subaccounts/:subaccountId/processes/:processId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PROCESSES_CONFIGURE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { mappings } = req.body as { mappings: Array<{ connectionKey: string; connectionId: string }> };

    if (!Array.isArray(mappings)) {
      throw { statusCode: 400, message: 'mappings must be an array of { connectionKey, connectionId }' };
    }

    // Validate all connections belong to this subaccount
    for (const m of mappings) {
      const [conn] = await db.select()
        .from(integrationConnections)
        .where(and(
          eq(integrationConnections.id, m.connectionId),
          eq(integrationConnections.subaccountId, subaccount.id)
        ));
      if (!conn) {
        throw { statusCode: 400, message: `Connection ${m.connectionId} not found in this subaccount` };
      }
      if (conn.connectionStatus !== 'active') {
        throw { statusCode: 400, message: `Connection ${m.connectionId} is not active (status: ${conn.connectionStatus})` };
      }
    }

    // Delete existing mappings and insert new ones (atomic replace)
    await db.delete(processConnectionMappings)
      .where(and(
        eq(processConnectionMappings.subaccountId, subaccount.id),
        eq(processConnectionMappings.processId, req.params.processId)
      ));

    if (mappings.length > 0) {
      await db.insert(processConnectionMappings).values(
        mappings.map(m => ({
          organisationId: req.orgId!,
          subaccountId: subaccount.id,
          processId: req.params.processId,
          connectionKey: m.connectionKey,
          connectionId: m.connectionId,
        }))
      );
    }

    // Return the new mappings
    const result = await db.select()
      .from(processConnectionMappings)
      .where(and(
        eq(processConnectionMappings.subaccountId, subaccount.id),
        eq(processConnectionMappings.processId, req.params.processId)
      ));

    res.json(result);
  })
);

export default router;
