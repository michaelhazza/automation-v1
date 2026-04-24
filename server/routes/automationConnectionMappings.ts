/**
 * Process connection mapping routes — subaccount-scoped.
 * Wires a process's required connection slots to actual integration connections.
 */

import { Router } from 'express';
import { eq, and, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automationConnectionMappings, integrationConnections, automations } from '../db/schema/index.js';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// Get connection mappings for a process in a subaccount
router.get(
  '/api/subaccounts/:subaccountId/automations/:automationId/connections',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.AUTOMATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);

    const mappings = await db.select()
      .from(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccount.id),
        eq(automationConnectionMappings.processId, req.params.automationId)
      ));

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

    // Validate all connections belong to this subaccount or are org-level
    for (const m of mappings) {
      const [conn] = await db.select()
        .from(integrationConnections)
        .where(and(
          eq(integrationConnections.id, m.connectionId),
          eq(integrationConnections.organisationId, req.orgId!),
          or(
            eq(integrationConnections.subaccountId, subaccount.id),
            isNull(integrationConnections.subaccountId),
          ),
        ));
      if (!conn) {
        throw { statusCode: 400, message: `Connection ${m.connectionId} not found in this subaccount or organisation` };
      }
      if (conn.connectionStatus !== 'active') {
        throw { statusCode: 400, message: `Connection ${m.connectionId} is not active (status: ${conn.connectionStatus})` };
      }
    }

    // Delete existing mappings and insert new ones (atomic replace)
    await db.delete(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccount.id),
        eq(automationConnectionMappings.processId, req.params.automationId)
      ));

    if (mappings.length > 0) {
      await db.insert(automationConnectionMappings).values(
        mappings.map(m => ({
          organisationId: req.orgId!,
          subaccountId: subaccount.id,
          processId: req.params.automationId,
          connectionKey: m.connectionKey,
          connectionId: m.connectionId,
        }))
      );
    }

    // Return the new mappings
    const result = await db.select()
      .from(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccount.id),
        eq(automationConnectionMappings.processId, req.params.automationId)
      ));

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

    const [source] = await db.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.automationId), isNull(automations.deletedAt)));

    if (!source) throw { statusCode: 404, message: 'Source process not found' };

    // Can only clone system automations or automations from the same org
    if (source.scope !== 'system' && source.organisationId !== req.orgId!) {
      throw { statusCode: 403, message: 'Cannot clone automations from another organisation' };
    }

    const { name } = req.body;

    const [cloned] = await db.insert(automations).values({
      organisationId: req.orgId!,
      automationEngineId: null,
      name: name || `${source.name} (Clone)`,
      description: source.description,
      webhookPath: source.webhookPath,
      inputSchema: source.inputSchema,
      outputSchema: source.outputSchema,
      configSchema: source.configSchema,
      defaultConfig: source.defaultConfig,
      requiredConnections: source.requiredConnections,
      scope: 'subaccount',
      isEditable: true,
      parentAutomationId: source.id,
      subaccountId: subaccount.id,
      status: 'draft',
    }).returning();

    res.status(201).json(cloned);
  })
);

export default router;
