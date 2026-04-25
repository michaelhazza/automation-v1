/**
 * System-level process management routes.
 * All endpoints require system_admin role.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { automations } from '../db/schema/index.js';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// List all system automations
router.get('/api/system/automations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await withAdminConnection({ source: 'systemAutomations.list' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.scope, 'system'), isNull(automations.deletedAt)))
      .orderBy(desc(automations.createdAt)),
  );
  res.json(rows);
}));

// Create system process
router.post('/api/system/automations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, description, webhookPath, inputSchema, outputSchema, configSchema, defaultConfig, requiredConnections, automationEngineId } = req.body;

  if (!name || !webhookPath) {
    throw { statusCode: 400, message: 'name and webhookPath are required' };
  }

  const [process] = await withAdminConnection({ source: 'systemAutomations.create' }, (tx) =>
    tx.insert(automations).values({
      organisationId: null,
      automationEngineId: automationEngineId ?? null,
      name,
      description: description ?? null,
      webhookPath,
      inputSchema: inputSchema ?? null,
      outputSchema: outputSchema ?? null,
      configSchema: configSchema ?? null,
      defaultConfig: defaultConfig ?? null,
      requiredConnections: requiredConnections ?? null,
      scope: 'system',
      isEditable: false,
      status: 'draft',
    }).returning(),
  );

  res.status(201).json(process);
}));

// Get system process
router.get('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [process] = await withAdminConnection({ source: 'systemAutomations.get' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.id), eq(automations.scope, 'system'), isNull(automations.deletedAt))),
  );

  if (!process) throw { statusCode: 404, message: 'System process not found' };
  res.json(process);
}));

// Update system process
router.patch('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await withAdminConnection({ source: 'systemAutomations.patch.check' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.id), eq(automations.scope, 'system'), isNull(automations.deletedAt))),
  );

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const allowed = ['name', 'description', 'webhookPath', 'inputSchema', 'outputSchema', 'configSchema', 'defaultConfig', 'requiredConnections', 'automationEngineId'] as const;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const [updated] = await withAdminConnection({ source: 'systemAutomations.patch.update' }, (tx) =>
    tx.update(automations)
      .set(updates)
      .where(eq(automations.id, req.params.id))
      .returning(),
  );

  res.json(updated);
}));

// Delete system process (soft)
router.delete('/api/system/automations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await withAdminConnection({ source: 'systemAutomations.delete.check' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.id), eq(automations.scope, 'system'), isNull(automations.deletedAt))),
  );

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  await withAdminConnection({ source: 'systemAutomations.delete' }, (tx) =>
    tx.update(automations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(automations.id, req.params.id)),
  );

  res.json({ success: true });
}));

// Activate system process
router.post('/api/system/automations/:id/activate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await withAdminConnection({ source: 'systemAutomations.activate.check' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.id), eq(automations.scope, 'system'), isNull(automations.deletedAt))),
  );

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const [updated] = await withAdminConnection({ source: 'systemAutomations.activate' }, (tx) =>
    tx.update(automations)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(automations.id, req.params.id))
      .returning(),
  );

  res.json(updated);
}));

// Deactivate system process
router.post('/api/system/automations/:id/deactivate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await withAdminConnection({ source: 'systemAutomations.deactivate.check' }, (tx) =>
    tx.select()
      .from(automations)
      .where(and(eq(automations.id, req.params.id), eq(automations.scope, 'system'), isNull(automations.deletedAt))),
  );

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const [updated] = await withAdminConnection({ source: 'systemAutomations.deactivate' }, (tx) =>
    tx.update(automations)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(automations.id, req.params.id))
      .returning(),
  );

  res.json(updated);
}));

export default router;
