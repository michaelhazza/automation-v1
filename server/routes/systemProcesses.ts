/**
 * System-level process management routes.
 * All endpoints require system_admin role.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processes } from '../db/schema/index.js';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// List all system processes
router.get('/api/system/processes', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await db.select()
    .from(processes)
    .where(and(eq(processes.scope, 'system'), isNull(processes.deletedAt)))
    .orderBy(desc(processes.createdAt));
  res.json(rows);
}));

// Create system process
router.post('/api/system/processes', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, description, webhookPath, inputSchema, outputSchema, configSchema, defaultConfig, requiredConnections, workflowEngineId } = req.body;

  if (!name || !webhookPath) {
    throw { statusCode: 400, message: 'name and webhookPath are required' };
  }

  const [process] = await db.insert(processes).values({
    organisationId: null,
    workflowEngineId: workflowEngineId ?? null,
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
  }).returning();

  res.status(201).json(process);
}));

// Get system process
router.get('/api/system/processes/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [process] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), eq(processes.scope, 'system'), isNull(processes.deletedAt)));

  if (!process) throw { statusCode: 404, message: 'System process not found' };
  res.json(process);
}));

// Update system process
router.patch('/api/system/processes/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), eq(processes.scope, 'system'), isNull(processes.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const allowed = ['name', 'description', 'webhookPath', 'inputSchema', 'outputSchema', 'configSchema', 'defaultConfig', 'requiredConnections', 'workflowEngineId'] as const;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const [updated] = await db.update(processes)
    .set(updates)
    .where(eq(processes.id, req.params.id))
    .returning();

  res.json(updated);
}));

// Delete system process (soft)
router.delete('/api/system/processes/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), eq(processes.scope, 'system'), isNull(processes.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  await db.update(processes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(processes.id, req.params.id));

  res.json({ success: true });
}));

// Activate system process
router.post('/api/system/processes/:id/activate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), eq(processes.scope, 'system'), isNull(processes.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const [updated] = await db.update(processes)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(processes.id, req.params.id))
    .returning();

  res.json(updated);
}));

// Deactivate system process
router.post('/api/system/processes/:id/deactivate', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(processes)
    .where(and(eq(processes.id, req.params.id), eq(processes.scope, 'system'), isNull(processes.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System process not found' };

  const [updated] = await db.update(processes)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(processes.id, req.params.id))
    .returning();

  res.json(updated);
}));

export default router;
