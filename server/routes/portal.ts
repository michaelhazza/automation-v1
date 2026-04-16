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
  scheduledTasks,
} from '../db/schema/index.js';
import { eq, and, isNull, desc, gte, lte, inArray } from 'drizzle-orm';
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
    const sa = await resolveSubaccount(subaccountId);

    // Load visible runs newest-first.
    const runs = await db
      .select()
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.subaccountId, subaccountId),
          eq(playbookRuns.organisationId, sa.organisationId),
          eq(playbookRuns.isPortalVisible, true),
        ),
      )
      .orderBy(desc(playbookRuns.createdAt));

    if (runs.length === 0) {
      res.json({ runs: [] });
      return;
    }

    // Batch-load portalPresentation: one query per version table instead of
    // one query per run (avoids N+1 when the portal has many visible runs).
    const versionIds = runs.map((r) => r.templateVersionId);

    const orgVersions = await db
      .select({ id: playbookTemplateVersions.id, definitionJson: playbookTemplateVersions.definitionJson })
      .from(playbookTemplateVersions)
      .where(inArray(playbookTemplateVersions.id, versionIds));
    const orgVersionMap = new Map(orgVersions.map((v) => [v.id, v.definitionJson]));

    // For IDs not found in org versions, fall back to system template versions.
    const missingIds = versionIds.filter((id) => !orgVersionMap.has(id));
    const sysVersionMap = new Map<string, unknown>();
    if (missingIds.length > 0) {
      const sysVersions = await db
        .select({ id: systemPlaybookTemplateVersions.id, definitionJson: systemPlaybookTemplateVersions.definitionJson })
        .from(systemPlaybookTemplateVersions)
        .where(inArray(systemPlaybookTemplateVersions.id, missingIds));
      for (const v of sysVersions) sysVersionMap.set(v.id, v.definitionJson);
    }

    const enriched = runs.map((run) => {
      const defJson = (orgVersionMap.get(run.templateVersionId) ?? sysVersionMap.get(run.templateVersionId)) as Record<string, unknown> | undefined;
      return { ...run, portalPresentation: defJson?.portalPresentation ?? null };
    });

    res.json({ runs: enriched });
  }),
);

// ─── Portal: Intelligence Briefing card (spec §G10.4, renamed in S18) ─────

/**
 * GET /api/portal/:subaccountId/intelligence-briefing-card
 *
 * Drives the dedicated Intelligence Briefing hero card on the portal dashboard.
 * Per spec §G10.4, the card shows iff the subaccount has BOTH a completed
 * Intelligence Briefing run AND a currently-active scheduled task producing
 * briefings. Returning { active: false } from either side keeps the card off
 * the dashboard so stale schedules don't advertise a broken card.
 *
 * Memory & Briefings S18: renamed from /daily-brief-card. The old path is
 * 301-redirected below for existing external consumers.
 *
 * Response shape:
 *   {
 *     active: boolean,
 *     latestRun: { id, completedAt } | null,
 *     nextRunAt: string | null,
 *     scheduledTaskId: string | null,
 *   }
 */
router.get(
  '/api/portal/:subaccountId/intelligence-briefing-card',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.PLAYBOOK_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const sa = await resolveSubaccount(subaccountId);

    const DAILY_BRIEF_SLUG = 'intelligence-briefing';

    const [latestRun] = await db
      .select({
        id: playbookRuns.id,
        completedAt: playbookRuns.completedAt,
      })
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.subaccountId, subaccountId),
          eq(playbookRuns.organisationId, sa.organisationId),
          eq(playbookRuns.playbookSlug, DAILY_BRIEF_SLUG),
          eq(playbookRuns.status, 'completed'),
        ),
      )
      .orderBy(desc(playbookRuns.completedAt))
      .limit(1);

    const [activeSchedule] = await db
      .select({
        id: scheduledTasks.id,
        nextRunAt: scheduledTasks.nextRunAt,
      })
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.subaccountId, subaccountId),
          eq(scheduledTasks.createdByPlaybookSlug, DAILY_BRIEF_SLUG),
          eq(scheduledTasks.isActive, true),
        ),
      )
      .orderBy(desc(scheduledTasks.nextRunAt))
      .limit(1);

    const active = Boolean(latestRun && activeSchedule);

    res.json({
      active,
      latestRun: latestRun
        ? { id: latestRun.id, completedAt: latestRun.completedAt }
        : null,
      nextRunAt: activeSchedule?.nextRunAt ?? null,
      scheduledTaskId: activeSchedule?.id ?? null,
    });
  }),
);

// Memory & Briefings S18 — 301 tombstone for the pre-rename path so external
// consumers (bookmarks, API clients) stop on the new canonical route.
router.get('/api/portal/:subaccountId/daily-brief-card', (req, res) => {
  res.redirect(301, `/api/portal/${req.params.subaccountId}/intelligence-briefing-card`);
});

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
    const sa = await resolveSubaccount(subaccountId);

    // Load the source run to extract orgId + templateVersionId.
    const [sourceRun] = await db
      .select()
      .from(playbookRuns)
      .where(
        and(
          eq(playbookRuns.id, runId),
          eq(playbookRuns.subaccountId, subaccountId),
          eq(playbookRuns.organisationId, sa.organisationId),
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
