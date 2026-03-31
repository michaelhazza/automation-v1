import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { projects, agentRuns } from '../db/schema/index.js';
import { eq, and, isNull, desc, count } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/projects
 * List all projects for a subaccount.
 */
router.get(
  '/api/subaccounts/:subaccountId/projects',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const rows = await db
      .select()
      .from(projects)
      .where(and(
        eq(projects.subaccountId, subaccountId),
        isNull(projects.deletedAt),
      ))
      .orderBy(desc(projects.createdAt));

    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/projects
 * Create a project.
 */
router.post(
  '/api/subaccounts/:subaccountId/projects',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { name, description, color } = req.body as {
      name?: string;
      description?: string;
      color?: string;
    };

    if (!name?.trim()) throw { statusCode: 400, message: 'name is required' };

    const [project] = await db.insert(projects).values({
      organisationId: req.orgId!,
      subaccountId,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || '#6366f1',
      createdBy: req.user?.id ?? null,
    }).returning();

    res.status(201).json(project);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/projects/:projectId
 * Update a project.
 */
router.patch(
  '/api/subaccounts/:subaccountId/projects/:projectId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.subaccountId, subaccountId), isNull(projects.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Project not found' };

    const { name, description, status, color } = req.body as {
      name?: string;
      description?: string;
      status?: 'active' | 'completed' | 'archived';
      color?: string;
    };

    const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (status !== undefined) updates.status = status;
    if (color !== undefined) updates.color = color;

    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, projectId))
      .returning();

    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/projects/:projectId
 * Soft-delete a project.
 */
router.delete(
  '/api/subaccounts/:subaccountId/projects/:projectId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.subaccountId, subaccountId), isNull(projects.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'Project not found' };

    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, projectId));

    res.json({ success: true });
  })
);

/**
 * GET /api/subaccounts/:subaccountId/live-status
 * Returns count of currently running agent runs for the sidebar badge.
 */
router.get(
  '/api/subaccounts/:subaccountId/live-status',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const [result] = await db
      .select({ count: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.subaccountId, subaccountId),
        eq(agentRuns.status, 'running'),
        eq(agentRuns.isSubAgent, false),
      ));

    res.json({ runningAgents: Number(result?.count ?? 0) });
  })
);

export default router;
