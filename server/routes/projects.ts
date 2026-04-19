import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { projects, agentRuns } from '../db/schema/index.js';
import { eq, and, isNull, desc, count, inArray } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';

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

    const { name, description, color, repoUrl, githubConnectionId, targetDate, budgetCents, budgetWarningPercent, goalId } = req.body as {
      name?: string;
      description?: string;
      color?: string;
      repoUrl?: string;
      githubConnectionId?: string;
      targetDate?: string;
      budgetCents?: number;
      budgetWarningPercent?: number;
      goalId?: string;
    };

    if (!name?.trim()) throw { statusCode: 400, message: 'name is required' };

    const [project] = await db.insert(projects).values({
      organisationId: req.orgId!,
      subaccountId,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || '#6366f1',
      repoUrl: repoUrl?.trim() || null,
      githubConnectionId: githubConnectionId || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      budgetCents: budgetCents ?? null,
      budgetWarningPercent: budgetWarningPercent ?? 75,
      goalId: goalId || null,
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

    const { name, description, status, color, repoUrl, githubConnectionId, targetDate, budgetCents, budgetWarningPercent, goalId } = req.body as {
      name?: string;
      description?: string;
      status?: 'active' | 'completed' | 'archived';
      color?: string;
      repoUrl?: string;
      githubConnectionId?: string | null;
      targetDate?: string | null;
      budgetCents?: number | null;
      budgetWarningPercent?: number | null;
      goalId?: string | null;
    };

    const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (status !== undefined) updates.status = status;
    if (color !== undefined) updates.color = color;
    if (repoUrl !== undefined) updates.repoUrl = repoUrl?.trim() || null;
    if (githubConnectionId !== undefined) updates.githubConnectionId = githubConnectionId || null;
    if (targetDate !== undefined) updates.targetDate = targetDate ? new Date(targetDate) : null;
    if (budgetCents !== undefined) updates.budgetCents = budgetCents;
    if (budgetWarningPercent !== undefined) updates.budgetWarningPercent = budgetWarningPercent;
    if (goalId !== undefined) updates.goalId = goalId || null;

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
 * Returns count of currently in-flight agent runs for the sidebar badge.
 *
 * Codex dual-review finding #2: this count must include IEE-delegated runs
 * so that live-badge resyncs (initial load, socket reconnect) don't drop
 * to zero while a delegated run is waiting on the worker. The
 * 'live:agent_started' socket event fires unconditionally in
 * agentExecutionService before the delegated branch; if this endpoint only
 * counted 'running', every full refresh would desync the badge.
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
        inArray(agentRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
        eq(agentRuns.isSubAgent, false),
      ));

    res.json({ runningAgents: Number(result?.count ?? 0) });
  })
);

export default router;
