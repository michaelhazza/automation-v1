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
import { asyncHandler } from '../lib/asyncHandler.js';
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
  playbookRuns,
  playbookTemplateVersions,
  systemPlaybookTemplateVersions,
} from '../db/schema/index.js';
import { eq, and, isNull, desc, gte, lte } from 'drizzle-orm';
import { playbookRunService } from '../services/playbookRunService.js';
import { queueService } from '../services/queueService.js';
import { agentActivityService } from '../services/agentActivityService.js';

const router = Router();

// ─── Portal: list my subaccounts ─────────────────────────────────────────────

/**
 * GET /api/portal/my-subaccounts
 * Returns all subaccounts the authenticated user is assigned to (as a member).
 * Used by the portal landing page to let users pick which subaccount to access.
 */
router.get('/api/portal/my-subaccounts', authenticate, asyncHandler(async (req, res) => {
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
}));

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
  asyncHandler(async (req, res) => {
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
  })
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
  asyncHandler(async (req, res) => {
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
  })
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
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * GET /api/portal/:subaccountId/executions/:executionId
 * Get a single execution detail.
 */
router.get(
  '/api/portal/:subaccountId/executions/:executionId',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
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
  })
);

// ─── Portal: agent activity for a subaccount ────────────────────────────────

router.get(
  '/api/portal/:subaccountId/agent-activity',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
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
  })
);

router.get(
  '/api/portal/:subaccountId/agent-activity/stats',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId);

    const { sinceDays } = req.query;
    const stats = await agentActivityService.getStats({
      subaccountId: req.params.subaccountId,
      sinceDays: sinceDays ? Number(sinceDays) : undefined,
    });

    res.json(stats);
  })
);

// ─── Portal: portal-visible playbook runs (spec §9.4) ────────────────────────

/**
 * GET /api/portal/:subaccountId/playbook-runs
 *
 * Returns runs where `isPortalVisible = true` for this subaccount, ordered by
 * most-recently started.  Each entry includes the portalPresentation metadata
 * from the locked template version's definition so the UI can render the card
 * title and headline extraction path without a second round-trip.
 */
router.get(
  '/api/portal/:subaccountId/playbook-runs',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId);

    // Load visible runs newest-first.
    const runs = await db
      .select()
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.subaccountId, subaccountId),
          eq(playbookRuns.isPortalVisible, true),
        ),
      )
      .orderBy(desc(playbookRuns.createdAt));

    if (runs.length === 0) {
      res.json({ runs: [] });
      return;
    }

    // Load portalPresentation from each run's locked template version.
    // We do it per-run rather than batched to keep the code simple; the list
    // is expected to be short (most portals show 1–3 playbooks at a time).
    const enriched = await Promise.all(
      runs.map(async (run) => {
        let portalPresentation: unknown = null;

        // Try org template version first.
        const [orgVer] = await db
          .select({ definitionJson: playbookTemplateVersions.definitionJson })
          .from(playbookTemplateVersions)
          .where(eq(playbookTemplateVersions.id, run.templateVersionId));
        if (orgVer) {
          const def = orgVer.definitionJson as Record<string, unknown>;
          portalPresentation = def?.portalPresentation ?? null;
        } else {
          // Fall back to system template version.
          const [sysVer] = await db
            .select({ definitionJson: systemPlaybookTemplateVersions.definitionJson })
            .from(systemPlaybookTemplateVersions)
            .where(eq(systemPlaybookTemplateVersions.id, run.templateVersionId));
          if (sysVer) {
            const def = sysVer.definitionJson as Record<string, unknown>;
            portalPresentation = def?.portalPresentation ?? null;
          }
        }

        return { ...run, portalPresentation };
      }),
    );

    res.json({ runs: enriched });
  }),
);

/**
 * POST /api/portal/:subaccountId/playbook-runs/:runId/run-now
 *
 * Starts a fresh run of the same playbook template as `runId` (spec §9.4
 * "Run now" button). Idempotent via the §10.5.1 DB-level unique guard.
 * Returns the new runId (or the existing active runId if one is in flight).
 */
router.post(
  '/api/portal/:subaccountId/playbook-runs/:runId/run-now',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_START),
  asyncHandler(async (req, res) => {
    const { subaccountId, runId } = req.params;
    await resolveSubaccount(subaccountId);

    // Load the source run to extract orgId + templateVersionId.
    const [sourceRun] = await db
      .select()
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.id, runId),
          eq(playbookRuns.subaccountId, subaccountId),
          eq(playbookRuns.isPortalVisible, true),
        ),
      );
    if (!sourceRun) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Determine whether this was a system or org template so we can pass the
    // right identifier to startRun.
    const [orgVer] = await db
      .select({ templateId: playbookTemplateVersions.templateId })
      .from(playbookTemplateVersions)
      .where(eq(playbookTemplateVersions.id, sourceRun.templateVersionId));

    let startResult: { runId: string; status: string };
    if (orgVer) {
      startResult = await playbookRunService.startRun({
        organisationId: sourceRun.organisationId,
        subaccountId,
        templateId: orgVer.templateId,
        initialInput: {},
        startedByUserId: req.user!.id,
        runMode: 'auto',
        isPortalVisible: true,
      });
    } else {
      if (!sourceRun.playbookSlug) {
        res.status(422).json({ error: 'Cannot replay: playbookSlug not set on source run' });
        return;
      }
      startResult = await playbookRunService.startRun({
        organisationId: sourceRun.organisationId,
        subaccountId,
        systemTemplateSlug: sourceRun.playbookSlug,
        initialInput: {},
        startedByUserId: req.user!.id,
        runMode: 'auto',
        isPortalVisible: true,
      });
    }

    res.status(201).json({ runId: startResult.runId });
  }),
);

export default router;
