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
  subaccountProcessLinks,
  subaccountCategories,
  subaccountUserAssignments,
  permissionSetItems,
  processes,
  executions,
  executionPayloads,
  workflowEngines,
} from '../db/schema/index.js';
import { eq, and, isNull, desc, gte, lte } from 'drizzle-orm';
import { queueService } from '../services/queueService.js';
import { agentActivityService } from '../services/agentActivityService.js';

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

// ─── Portal: list processes ───────────────────────────────────────────────────

/**
 * GET /api/portal/:subaccountId/processes
 * Returns processes visible to this subaccount member, grouped by category.
 */
router.get(
  '/api/portal/:subaccountId/processes',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PROCESSES_VIEW),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId);

      if (sa.status !== 'active') {
        res.status(403).json({ error: 'This subaccount is not currently active' });
        return;
      }

      // Org processes linked (active link + active process)
      const linkedRows = await db
        .select({
          processId: subaccountProcessLinks.processId,
          subaccountCategoryId: subaccountProcessLinks.subaccountCategoryId,
          processName: processes.name,
          processDescription: processes.description,
          processInputSchema: processes.inputSchema,
          processOutputSchema: processes.outputSchema,
        })
        .from(subaccountProcessLinks)
        .innerJoin(processes, eq(processes.id, subaccountProcessLinks.processId))
        .where(
          and(
            eq(subaccountProcessLinks.subaccountId, req.params.subaccountId),
            eq(subaccountProcessLinks.isActive, true),
            eq(processes.status, 'active'),
            isNull(processes.deletedAt)
          )
        );

      // Subaccount-native processes
      const nativeRows = await db
        .select()
        .from(processes)
        .where(
          and(
            eq(processes.subaccountId, req.params.subaccountId),
            eq(processes.status, 'active'),
            isNull(processes.deletedAt)
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

      const allProcesses = [
        ...linkedRows.map((row) => ({
          id: row.processId,
          name: row.processName,
          description: row.processDescription,
          inputSchema: row.processInputSchema,
          outputSchema: row.processOutputSchema,
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
        processes: allProcesses,
        categories,
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

// ─── Portal: execute a process ──────────────────────────────────────────────

/**
 * POST /api/portal/:subaccountId/executions
 * Execute a process as a subaccount member.
 * Body: { processId, inputData?, notifyOnComplete? }
 */
router.post(
  '/api/portal/:subaccountId/executions',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PROCESSES_EXECUTE),
  async (req, res) => {
    try {
      const sa = await resolveSubaccount(req.params.subaccountId);

      if (sa.status !== 'active') {
        res.status(403).json({ error: 'This subaccount is not currently active' });
        return;
      }

      const { processId, inputData, notifyOnComplete } = req.body as {
        processId?: string;
        inputData?: unknown;
        notifyOnComplete?: boolean;
      };

      if (!processId) {
        res.status(400).json({ error: 'Validation failed', details: 'processId is required' });
        return;
      }

      // Verify the process is accessible to this subaccount (linked or native)
      const linkedResult = await db
        .select({ processId: subaccountProcessLinks.processId })
        .from(subaccountProcessLinks)
        .where(
          and(
            eq(subaccountProcessLinks.subaccountId, req.params.subaccountId),
            eq(subaccountProcessLinks.processId, processId),
            eq(subaccountProcessLinks.isActive, true)
          )
        );

      const nativeResult = await db
        .select({ id: processes.id })
        .from(processes)
        .where(
          and(
            eq(processes.id, processId),
            eq(processes.subaccountId, req.params.subaccountId),
            eq(processes.status, 'active'),
            isNull(processes.deletedAt)
          )
        );

      if (linkedResult.length === 0 && nativeResult.length === 0) {
        res.status(404).json({ error: 'Process not found or not accessible in this subaccount' });
        return;
      }

      // Fetch process and engine
      const [process] = await db
        .select()
        .from(processes)
        .where(and(eq(processes.id, processId), eq(processes.status, 'active'), isNull(processes.deletedAt)));

      if (!process || !process.workflowEngineId) {
        res.status(400).json({ error: 'Process not available' });
        return;
      }

      const [engine] = await db
        .select()
        .from(workflowEngines)
        .where(eq(workflowEngines.id, process.workflowEngineId));

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
            eq(executions.processId, processId),
            gte(executions.createdAt, fiveMinutesAgo)
          )
        );

      const nonTestRecent = recentExec.filter((e) => !e.isTestExecution);
      if (nonTestRecent.length > 0) {
        const oldest = nonTestRecent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        const waitSec = Math.ceil((oldest.createdAt.getTime() + 5 * 60 * 1000 - Date.now()) / 1000);
        res.status(429).json({
          error: `Duplicate execution: this process was already triggered recently. Please wait ${waitSec} seconds before retrying.`,
        });
        return;
      }

      const [execution] = await db.transaction(async (tx) => {
        const [exec] = await tx
          .insert(executions)
          .values({
            organisationId: process.organisationId ?? req.orgId!,
            processId,
            triggeredByUserId: req.user!.id,
            subaccountId: req.params.subaccountId,
            status: 'pending',
            inputData: inputData ?? null,
            engineType: engine.engineType,
            isTestExecution: false,
            notifyOnComplete: notifyOnComplete ?? false,
            retryCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        await tx.insert(executionPayloads)
          .values({ executionId: exec.id, processSnapshot: process as unknown as Record<string, unknown> })
          .onConflictDoNothing();
        return [exec];
      });

      try {
        await queueService.enqueueExecution(execution.id);
      } catch {
        // Queue failure should not fail the API response
      }

      res.status(201).json({ id: execution.id, status: execution.status, processId: execution.processId });
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

      const { from, to, processId, limit: limitRaw, offset: offsetRaw } = req.query;
      const limit = Math.min(parseInt(limitRaw as string) || 50, 200);
      const offset = parseInt(offsetRaw as string) || 0;

      const conditions = [eq(executions.subaccountId, req.params.subaccountId)];
      if (!canViewAll) conditions.push(eq(executions.triggeredByUserId, req.user!.id));
      if (processId) conditions.push(eq(executions.processId, processId as string));
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
          processId: e.processId,
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
        processId: execution.processId,
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

// ─── Portal: agent activity for a subaccount ────────────────────────────────

router.get(
  '/api/portal/:subaccountId/agent-activity',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId);

      const { agentId, status, limit, offset } = req.query;

      const runs = await agentActivityService.listRuns({
        subaccountId: req.params.subaccountId,
        agentId: agentId as string | undefined,
        status: status as string | undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      res.json(runs);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

router.get(
  '/api/portal/:subaccountId/agent-activity/stats',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  async (req, res) => {
    try {
      await resolveSubaccount(req.params.subaccountId);

      const { sinceDays } = req.query;
      const stats = await agentActivityService.getStats({
        subaccountId: req.params.subaccountId,
        sinceDays: sinceDays ? Number(sinceDays) : undefined,
      });

      res.json(stats);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    }
  }
);

export default router;
