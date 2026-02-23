/**
 * Portal routes — accessed by subaccount members.
 *
 * These endpoints are scoped to a specific subaccount and require the caller
 * to have been assigned to that subaccount via subaccount_user_assignments.
 * All routes use requireSubaccountPermission to enforce this.
 */
import { Router } from 'express';
import { authenticate, requireSubaccountPermission } from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import {
  subaccounts,
  subaccountTaskLinks,
  subaccountCategories,
  subaccountUserAssignments,
  permissionSetItems,
  tasks,
  executions,
  workflowEngines,
} from '../db/schema/index.js';
import { eq, and, isNull, desc, gte, lte } from 'drizzle-orm';
import { queueService } from '../services/queueService.js';

const router = Router();

// ─── Portal: list my subaccounts ─────────────────────────────────────────────

/**
 * GET /api/portal/my-subaccounts
 * Returns all subaccounts the authenticated user is assigned to (as a member).
 * Used by the portal landing page to let users pick which subaccount to access.
 */
router.get('/api/portal/my-subaccounts', authenticate, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: subaccounts.id,
        name: subaccounts.name,
        slug: subaccounts.slug,
        status: subaccounts.status,
      })
      .from(subaccountUserAssignments)
      .innerJoin(subaccounts, eq(subaccounts.id, subaccountUserAssignments.subaccountId))
      .where(
        and(
          eq(subaccountUserAssignments.userId, req.user!.id),
          eq(subaccounts.status, 'active'),
          isNull(subaccounts.deletedAt)
        )
      );
    res.json(rows);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

// ─── Helper: resolve subaccount (not deleted) ─────────────────────────────────

async function resolveSubaccount(subaccountId: string) {
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.id, subaccountId), isNull(subaccounts.deletedAt)));
  if (!sa) throw { statusCode: 404, message: 'Subaccount not found' };
  return sa;
}

// ─── Helper: check if user has a specific subaccount permission ───────────────

async function hasSubaccountPerm(userId: string, subaccountId: string, key: string): Promise<boolean> {
  const [row] = await db
    .select({ key: permissionSetItems.permissionKey })
    .from(subaccountUserAssignments)
    .innerJoin(permissionSetItems, eq(permissionSetItems.permissionSetId, subaccountUserAssignments.permissionSetId))
    .where(
      and(
        eq(subaccountUserAssignments.userId, userId),
        eq(subaccountUserAssignments.subaccountId, subaccountId),
        eq(permissionSetItems.permissionKey, key)
      )
    );
  return !!row;
}

// ─── Portal: list tasks ───────────────────────────────────────────────────────

/**
 * GET /api/portal/:subaccountId/tasks
 * Returns tasks visible to this subaccount member, grouped by category.
 */
router.get(
  '/api/portal/:subaccountId/tasks',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.TASKS_VIEW),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId);

      if (sa.status !== 'active') {
        res.status(403).json({ error: 'This subaccount is not currently active' });
        return;
      }

      // Org tasks linked (active link + active task)
      const linkedRows = await db
        .select({
          taskId: subaccountTaskLinks.taskId,
          subaccountCategoryId: subaccountTaskLinks.subaccountCategoryId,
          taskName: tasks.name,
          taskDescription: tasks.description,
          taskInputSchema: tasks.inputSchema,
          taskOutputSchema: tasks.outputSchema,
        })
        .from(subaccountTaskLinks)
        .innerJoin(tasks, eq(tasks.id, subaccountTaskLinks.taskId))
        .where(
          and(
            eq(subaccountTaskLinks.subaccountId, req.params.subaccountId),
            eq(subaccountTaskLinks.isActive, true),
            eq(tasks.status, 'active'),
            isNull(tasks.deletedAt)
          )
        );

      // Subaccount-native tasks
      const nativeRows = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.subaccountId, req.params.subaccountId),
            eq(tasks.status, 'active'),
            isNull(tasks.deletedAt)
          )
        );

      // Categories for grouping
      const categories = await db
        .select()
        .from(subaccountCategories)
        .where(
          and(
            eq(subaccountCategories.subaccountId, req.params.subaccountId),
            isNull(subaccountCategories.deletedAt)
          )
        );

      const catMap = Object.fromEntries(
        categories.map((c) => [c.id, { id: c.id, name: c.name, colour: c.colour }])
      );

      const allTasks = [
        ...linkedRows.map((row) => ({
          id: row.taskId,
          name: row.taskName,
          description: row.taskDescription,
          inputSchema: row.taskInputSchema,
          outputSchema: row.taskOutputSchema,
          category: row.subaccountCategoryId ? catMap[row.subaccountCategoryId] : null,
          source: 'linked' as const,
        })),
        ...nativeRows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          category: t.subaccountCategoryId ? catMap[t.subaccountCategoryId] : null,
          source: 'native' as const,
        })),
      ];

      res.json({
        subaccount: { id: sa.id, name: sa.name },
        tasks: allTasks,
        categories,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Portal: execute a task ───────────────────────────────────────────────────

/**
 * POST /api/portal/:subaccountId/executions
 * Execute a task as a subaccount member.
 * Body: { taskId, inputData?, notifyOnComplete? }
 */
router.post(
  '/api/portal/:subaccountId/executions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.TASKS_EXECUTE),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId);

      if (sa.status !== 'active') {
        res.status(403).json({ error: 'This subaccount is not currently active' });
        return;
      }

      const { taskId, inputData, notifyOnComplete } = req.body as {
        taskId?: string;
        inputData?: unknown;
        notifyOnComplete?: boolean;
      };

      if (!taskId) {
        res.status(400).json({ error: 'Validation failed', details: 'taskId is required' });
        return;
      }

      // Verify the task is accessible to this subaccount (linked or native)
      const linkedResult = await db
        .select({ taskId: subaccountTaskLinks.taskId })
        .from(subaccountTaskLinks)
        .where(
          and(
            eq(subaccountTaskLinks.subaccountId, req.params.subaccountId),
            eq(subaccountTaskLinks.taskId, taskId),
            eq(subaccountTaskLinks.isActive, true)
          )
        );

      const nativeResult = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.subaccountId, req.params.subaccountId),
            eq(tasks.status, 'active'),
            isNull(tasks.deletedAt)
          )
        );

      if (linkedResult.length === 0 && nativeResult.length === 0) {
        res.status(404).json({ error: 'Task not found or not accessible in this subaccount' });
        return;
      }

      // Fetch task and engine
      const [task] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.status, 'active'), isNull(tasks.deletedAt)));

      if (!task || !task.workflowEngineId) {
        res.status(400).json({ error: 'Task not available' });
        return;
      }

      const [engine] = await db
        .select()
        .from(workflowEngines)
        .where(eq(workflowEngines.id, task.workflowEngineId));

      if (!engine) {
        res.status(400).json({ error: 'Workflow engine not found' });
        return;
      }

      // 5-minute duplicate prevention
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentExec = await db
        .select({ id: executions.id, createdAt: executions.createdAt, isTestExecution: executions.isTestExecution })
        .from(executions)
        .where(
          and(
            eq(executions.triggeredByUserId, req.user!.id),
            eq(executions.taskId, taskId),
            gte(executions.createdAt, fiveMinutesAgo)
          )
        );

      const nonTestRecent = recentExec.filter((e) => !e.isTestExecution);
      if (nonTestRecent.length > 0) {
        const oldest = nonTestRecent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        const waitSec = Math.ceil((oldest.createdAt.getTime() + 5 * 60 * 1000 - Date.now()) / 1000);
        res.status(429).json({
          error: `Duplicate execution: this task was already triggered recently. Please wait ${waitSec} seconds before retrying.`,
        });
        return;
      }

      const [execution] = await db
        .insert(executions)
        .values({
          organisationId: task.organisationId,
          taskId,
          triggeredByUserId: req.user!.id,
          subaccountId: req.params.subaccountId,
          status: 'pending',
          inputData: inputData ?? null,
          engineType: engine.engineType,
          taskSnapshot: task as unknown as Record<string, unknown>,
          isTestExecution: false,
          notifyOnComplete: notifyOnComplete ?? false,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      try {
        await queueService.enqueueExecution(execution.id);
      } catch {
        // Queue failure should not fail the API response
      }

      res.status(201).json({ id: execution.id, status: execution.status, taskId: execution.taskId });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Portal: list executions ──────────────────────────────────────────────────

/**
 * GET /api/portal/:subaccountId/executions
 * Members with subaccount.executions.view_all see everyone's; others see only their own.
 */
router.get(
  '/api/portal/:subaccountId/executions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId);

      const canViewAll = await hasSubaccountPerm(
        req.user!.id,
        req.params.subaccountId,
        SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL
      );

      const { from, to, taskId, limit: limitRaw, offset: offsetRaw } = req.query;
      const limit = Math.min(parseInt(limitRaw as string) || 50, 200);
      const offset = parseInt(offsetRaw as string) || 0;

      const conditions = [eq(executions.subaccountId, req.params.subaccountId)];
      if (!canViewAll) conditions.push(eq(executions.triggeredByUserId, req.user!.id));
      if (taskId) conditions.push(eq(executions.taskId, taskId as string));
      if (from) conditions.push(gte(executions.createdAt, new Date(from as string)));
      if (to) conditions.push(lte(executions.createdAt, new Date(to as string)));

      const rows = await db
        .select()
        .from(executions)
        .where(and(...conditions))
        .orderBy(desc(executions.createdAt))
        .limit(limit)
        .offset(offset);

      res.json(
        rows.map((e) => ({
          id: e.id,
          taskId: e.taskId,
          status: e.status,
          inputData: e.inputData,
          outputData: e.outputData,
          errorMessage: e.errorMessage,
          isTestExecution: e.isTestExecution,
          startedAt: e.startedAt,
          completedAt: e.completedAt,
          durationMs: e.durationMs,
          createdAt: e.createdAt,
        }))
      );
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

/**
 * GET /api/portal/:subaccountId/executions/:executionId
 * Get a single execution detail.
 */
router.get(
  '/api/portal/:subaccountId/executions/:executionId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId);

      const [execution] = await db
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.id, req.params.executionId),
            eq(executions.subaccountId, req.params.subaccountId)
          )
        );

      if (!execution) {
        res.status(404).json({ error: 'Execution not found' });
        return;
      }

      // Check ownership unless user has view_all
      if (execution.triggeredByUserId !== req.user!.id) {
        const canViewAll = await hasSubaccountPerm(
          req.user!.id,
          req.params.subaccountId,
          SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW_ALL
        );
        if (!canViewAll) {
          res.status(404).json({ error: 'Execution not found' });
          return;
        }
      }

      res.json({
        id: execution.id,
        taskId: execution.taskId,
        status: execution.status,
        inputData: execution.inputData,
        outputData: execution.outputData,
        errorMessage: execution.errorMessage,
        isTestExecution: execution.isTestExecution,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        durationMs: execution.durationMs,
        createdAt: execution.createdAt,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
