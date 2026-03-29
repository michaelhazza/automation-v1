/**
 * System-level engine management routes.
 * All endpoints require system_admin role.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowEngines } from '../db/schema/index.js';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

function sanitizeEngine(engine: typeof workflowEngines.$inferSelect) {
  const { hmacSecret, apiKey, ...rest } = engine;
  return rest;
}

// List all system engines
router.get('/api/system/engines', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const rows = await db.select()
    .from(workflowEngines)
    .where(and(eq(workflowEngines.scope, 'system'), isNull(workflowEngines.deletedAt)))
    .orderBy(desc(workflowEngines.createdAt));
  res.json(rows.map(sanitizeEngine));
}));

// Create system engine
router.post('/api/system/engines', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, engineType, baseUrl, apiKey } = req.body;

  if (!name || !engineType || !baseUrl) {
    throw { statusCode: 400, message: 'name, engineType, and baseUrl are required' };
  }

  const hmacSecret = crypto.randomBytes(32).toString('hex');

  const [engine] = await db.insert(workflowEngines).values({
    organisationId: null,
    name,
    engineType,
    baseUrl,
    apiKey: apiKey ?? null,
    scope: 'system',
    subaccountId: null,
    hmacSecret,
    status: 'inactive',
  }).returning();

  res.status(201).json(sanitizeEngine(engine));
}));

// Get system engine
router.get('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [engine] = await db.select()
    .from(workflowEngines)
    .where(and(eq(workflowEngines.id, req.params.id), eq(workflowEngines.scope, 'system'), isNull(workflowEngines.deletedAt)));

  if (!engine) throw { statusCode: 404, message: 'System engine not found' };
  res.json(sanitizeEngine(engine));
}));

// Update system engine
router.patch('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(workflowEngines)
    .where(and(eq(workflowEngines.id, req.params.id), eq(workflowEngines.scope, 'system'), isNull(workflowEngines.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System engine not found' };

  const allowed = ['name', 'engineType', 'baseUrl', 'apiKey', 'status', 'metadata'] as const;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const [updated] = await db.update(workflowEngines)
    .set(updates)
    .where(eq(workflowEngines.id, req.params.id))
    .returning();

  res.json(sanitizeEngine(updated));
}));

// Delete system engine (soft)
router.delete('/api/system/engines/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const [existing] = await db.select()
    .from(workflowEngines)
    .where(and(eq(workflowEngines.id, req.params.id), eq(workflowEngines.scope, 'system'), isNull(workflowEngines.deletedAt)));

  if (!existing) throw { statusCode: 404, message: 'System engine not found' };

  await db.update(workflowEngines)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(workflowEngines.id, req.params.id));

  res.json({ success: true });
}));

export default router;
