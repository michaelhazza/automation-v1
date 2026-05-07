import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { projects, agentRuns } from '../db/schema/index.js';
import { eq, and, isNull, desc, count, inArray } from 'drizzle-orm';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';
import { projectService } from '../services/projectService.js';

const router = Router();

/**
 * GET /api/projects/:id
 * Get a single project by ID (org-scoped).
 */
router.get(
  '/api/projects/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const project = await projectService.getById(req.orgId!, req.params.id);
    res.json(project);
  })
);

/**
 * PATCH /api/projects/:id
 * Update a project (org-scoped). Supports spec fields including linkedAgents.
 */
router.patch(
  '/api/projects/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const project = await projectService.patch(req.orgId!, req.params.id, req.body);
    res.json(project);
  })
);

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
 * Update a project (legacy route — delegates to projectService).
 *
 * Legacy callers may send: githubConnectionId, goalId, budgetCents (raw cents),
 * budgetWarningPercent. These are normalised in projectService.fromApiPatch.
 * budgetWarningPercent is mapped to budgetWarnThresholdPct before delegation.
 */
router.patch(
  '/api/subaccounts/:subaccountId/projects/:projectId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { subaccountId, projectId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    // Map legacy field name to service field name, keeping all others as-is
    const { budgetWarningPercent, repoUrl, ...rest } = req.body as Record<string, unknown>;
    const serviceBody: Record<string, unknown> = { ...rest };
    if (budgetWarningPercent !== undefined) serviceBody.budgetWarnThresholdPct = budgetWarningPercent;
    if (repoUrl !== undefined) serviceBody.repositoryUrl = repoUrl;

    const project = await projectService.patch(req.orgId!, projectId, serviceBody as Parameters<typeof projectService.patch>[2]);
    res.json(project);
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
