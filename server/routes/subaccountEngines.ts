/**
 * Subaccount-scoped engine routes.
 * Allows subaccounts to bring their own execution engines (e.g. own n8n instance).
 */

import crypto from 'crypto';
import { Router } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowEngines } from '../db/schema/index.js';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

function sanitizeEngine(engine: typeof workflowEngines.$inferSelect) {
  const { hmacSecret, apiKey, ...rest } = engine;
  return rest;
}

// List subaccount engines
router.get(
  '/api/subaccounts/:subaccountId/engines',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const rows = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.subaccountId, subaccount.id),
        eq(workflowEngines.scope, 'subaccount'),
        isNull(workflowEngines.deletedAt)
      ))
      .orderBy(desc(workflowEngines.createdAt));
    res.json(rows.map(sanitizeEngine));
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

    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const [engine] = await db.insert(workflowEngines).values({
      organisationId: req.orgId!,
      name,
      engineType,
      baseUrl,
      apiKey: apiKey ?? null,
      scope: 'subaccount',
      subaccountId: subaccount.id,
      hmacSecret,
      status: 'inactive',
    }).returning();

    res.status(201).json(sanitizeEngine(engine));
  })
);

// Update subaccount engine
router.patch(
  '/api/subaccounts/:subaccountId/engines/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [existing] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.id, req.params.id),
        eq(workflowEngines.subaccountId, subaccount.id),
        isNull(workflowEngines.deletedAt)
      ));

    if (!existing) throw { statusCode: 404, message: 'Engine not found' };

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
  })
);

// Delete subaccount engine (soft)
router.delete(
  '/api/subaccounts/:subaccountId/engines/:id',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const [existing] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.id, req.params.id),
        eq(workflowEngines.subaccountId, subaccount.id),
        isNull(workflowEngines.deletedAt)
      ));

    if (!existing) throw { statusCode: 404, message: 'Engine not found' };

    await db.update(workflowEngines)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflowEngines.id, req.params.id));

    res.json({ success: true });
  })
);

export default router;
